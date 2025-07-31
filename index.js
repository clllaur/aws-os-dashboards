#!/usr/bin/env node

const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");
const { SignatureV4 } = require("@aws-sdk/signature-v4");
const { Sha256 } = require("@aws-crypto/sha256-js");
const { fromNodeProviderChain } = require("@aws-sdk/credential-providers");
const http = require("http");
const httpProxy = require("http-proxy");
const express = require("express");
const bodyParser = require("body-parser");
const stream = require("stream");
const figlet = require("figlet");
const basicAuth = require("express-basic-auth");
const compress = require("compression");
const fs = require("fs");
const homedir = require("os").homedir();
const { URL } = require("url");

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const argv = yargs(hideBin(process.argv))
  .usage("usage: $0 [options] <aws-es-cluster-endpoint>")
  .option("b", {
    alias: "bind-address",
    default: process.env.BIND_ADDRESS || "127.0.0.1",
    describe: "the ip address to bind to",
    type: "string",
  })
  .option("p", {
    alias: "port",
    default: process.env.PORT || 9200,
    describe: "the port to bind to",
    type: "number",
  })
  .option("r", {
    alias: "region",
    default: process.env.REGION,
    describe: "the region of the Elasticsearch cluster",
    type: "string",
  })
  .option("u", {
    alias: "user",
    default: process.env.AUTH_USER || process.env.USER,
    describe: "the username to access the proxy",
  })
  .option("a", {
    alias: "password",
    default: process.env.AUTH_PASSWORD || process.env.PASSWORD,
    describe: "the password to access the proxy",
  })
  .option("s", {
    alias: "silent",
    default: false,
    describe: "remove figlet banner",
  })
  .option("H", {
    alias: "health-path",
    default: process.env.HEALTH_PATH,
    describe: "URI path for health check",
    type: "string",
  })
  .option("l", {
    alias: "limit",
    default: process.env.LIMIT || "10000kb",
    describe: "request limit",
  })
  .help()
  .version().argv;

var ENDPOINT = process.env.ENDPOINT || argv._[0];

if (!ENDPOINT) {
  yargs.showHelp();
  process.exit(1);
}

// Try to infer the region if it is not provided as an argument.
var REGION = argv.r;
if (!REGION) {
  var m = ENDPOINT.match(/\.([^.]+)\.es\.amazonaws\.com\.?(?=.*$)/);
  if (m) {
    REGION = m[1];
  } else {
    console.error(
      "region cannot be parsed from endpoint address, either the endpoint must end " +
        "in .<region>.es.amazonaws.com or --region should be provided as an argument"
    );
    yargs.showHelp();
    process.exit(1);
  }
}

var TARGET = process.env.ENDPOINT || argv._[0];
if (!TARGET.match(/^https?:\/\//)) {
  TARGET = "https://" + TARGET;
}

var BIND_ADDRESS = argv.b;
var PORT = argv.p;
var REQ_LIMIT = argv.l;

var credentials;
var signer;

var PROFILE = process.env.AWS_PROFILE;

async function initializeCredentials() {
  try {
    if (PROFILE) {
      // Try SSO credentials first, then fall back to regular profile
      try {
        credentials = fromNodeProviderChain({ profile: PROFILE });
        // Test if it's an SSO profile by trying to get credentials
        const testCredentials = await credentials();
        console.log("AWS SSO credentials loaded successfully");
      } catch (ssoError) {
        // If SSO fails, try regular profile credentials
        console.log("SSO credentials not available, trying regular profile...");
        credentials = fromNodeProviderChain({ profile: PROFILE });
        const testCredentials = await credentials();
        console.log("AWS profile credentials loaded successfully");
      }
    } else {
      credentials = fromNodeProviderChain();
      const testCredentials = await credentials();
      console.log("AWS default credentials loaded successfully");
    }

    // Initialize the signer
    signer = new SignatureV4({
      credentials,
      region: REGION,
      service: "es",
      sha256: Sha256,
    });

    // Test credentials with STS
    const stsClient = new STSClient({
      region: REGION,
      credentials,
    });
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    console.log(
      `AWS credentials validated successfully for account: ${identity.Account}`
    );
  } catch (err) {
    console.error("Failed to load AWS credentials:", err.message);
    if (err.message.includes("SSO")) {
      console.error("\nTo authenticate with AWS SSO, run:");
      console.error(`aws sso login --profile ${PROFILE || "default"}`);
      console.error("\nOr if you need to configure SSO:");
      console.error("aws configure sso");
    }
    process.exit(1);
  }
}

async function getCredentials(req, res, next) {
  try {
    await credentials();
    return next();
  } catch (err) {
    return next(err);
  }
}

var options = {
  target: TARGET,
  changeOrigin: true,
  secure: true,
};

var proxy = httpProxy.createProxyServer(options);

var app = express();
app.use(compress());
app.use(
  bodyParser.raw({
    limit: REQ_LIMIT,
    type: function () {
      return true;
    },
  })
);
app.use(getCredentials);

if (argv.H) {
  app.get(argv.H, function (req, res) {
    res.setHeader("Content-Type", "text/plain");
    res.send("ok");
  });
}

if (argv.u && argv.a) {
  var users = {};
  var user = process.env.USER || process.env.AUTH_USER;
  var pass = process.env.PASSWORD || process.env.AUTH_PASSWORD;

  users[user] = pass;

  app.use(
    basicAuth({
      users: users,
      challenge: true,
    })
  );
}

app.use(async function (req, res) {
  try {
    // Sign the request before proxying
    const url = new URL(ENDPOINT);

    // Calculate content-sha256 hash
    const body = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body || "");
    const contentSha256 = require("crypto")
      .createHash("sha256")
      .update(body)
      .digest("hex");

    // Create the request object in the format expected by SignatureV4
    const request = {
      method: req.method,
      path: req.url,
      headers: {
        Host: url.hostname,
        "x-amz-content-sha256": contentSha256,
      },
      body: body,
    };

    // Add specific headers that AWS expects to be signed
    // Based on the canonical string from the error message
    const headersToInclude = [
      "accept",
      "accept-encoding",
      "accept-language",
      "content-type",
      "upgrade-insecure-requests",
    ];

    headersToInclude.forEach((headerName) => {
      const value = req.get(headerName);
      if (value !== undefined) {
        request.headers[headerName] = value;
      }
    });

    // Sign the request
    const signedRequest = await signer.sign(request);

    // Set the signed headers on the request
    req.headers.host = signedRequest.headers.host;
    req.headers["x-amz-date"] = signedRequest.headers["x-amz-date"];
    req.headers.authorization = signedRequest.headers.authorization;
    req.headers["x-amz-content-sha256"] =
      signedRequest.headers["x-amz-content-sha256"];
    if (signedRequest.headers["x-amz-security-token"]) {
      req.headers["x-amz-security-token"] =
        signedRequest.headers["x-amz-security-token"];
    }

    var bufferStream;
    if (Buffer.isBuffer(req.body)) {
      var bufferStream = new stream.PassThrough();
      await bufferStream.end(req.body);
    }
    proxy.web(req, res, { buffer: bufferStream });
  } catch (err) {
    console.error("Error signing request:", err);
    if (!res.headersSent) {
      res.status(500).send("Internal Server Error");
    }
  }
});

proxy.on("proxyRes", function (proxyReq, req, res) {
  if (req.url.match(/\.(css|js|img|font)/)) {
    res.setHeader("Cache-Control", "public, max-age=86400");
  }
});

proxy.on("error", function (err, req, res) {
  console.error("Proxy error:", err);
  if (res && !res.headersSent) {
    res.status(500).send("Proxy error occurred");
  }
});

// Initialize credentials before starting the server
initializeCredentials()
  .then(() => {
    http.createServer(app).listen(PORT, BIND_ADDRESS);

    if (!argv.s) {
      console.log(
        figlet.textSync("AWS ES Proxy!", {
          font: "Speed",
          horizontalLayout: "default",
          verticalLayout: "default",
        })
      );
    }

    console.log(
      "AWS ES cluster available at http://" + BIND_ADDRESS + ":" + PORT
    );
    console.log(
      "OpenSearch Dashboards available at http://" +
        BIND_ADDRESS +
        ":" +
        PORT +
        "/_dashboards"
    );
    if (argv.H) {
      console.log(
        "Health endpoint enabled at http://" +
          BIND_ADDRESS +
          ":" +
          PORT +
          argv.H
      );
    }
  })
  .catch((err) => {
    console.error("Failed to initialize:", err);
    process.exit(1);
  });
