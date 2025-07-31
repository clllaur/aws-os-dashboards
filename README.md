# AWS OpenSearch Dashboards Proxy

A Node.js proxy server that provides secure access to AWS OpenSearch clusters and OpenSearch Dashboards.

## Features

- **AWS SDK v3**: Updated to use the latest AWS SDK v3 for better performance and modular imports
- **AWS Signature V4**: Automatic request signing for AWS OpenSearch endpoints
- **Basic Authentication**: Optional username/password protection
- **Compression**: Built-in response compression
- **Health Check**: Optional health check endpoint
- **Credential Refresh**: Automatic credential refresh when AWS credentials file changes
- **Modern CLI**: Updated to use yargs v18+ for command-line argument parsing

## Installation

```bash
npm install
```

## Usage

### Basic Usage

```bash
node index.js your-opensearch-cluster.region.es.amazonaws.com
```

### With Options

```bash
node index.js your-opensearch-cluster.region.es.amazonaws.com \
  --port 9200 \
  --bind-address 127.0.0.1 \
  --region us-east-1 \
  --user myuser \
  --password mypassword
```

### Available Options

- `-b, --bind-address`: IP address to bind to (default: 127.0.0.1)
- `-p, --port`: Port to bind to (default: 9200)
- `-r, --region`: AWS region
- `-u, --user`: Username for basic auth
- `-a, --password`: Password for basic auth
- `-s, --silent`: Remove figlet banner
- `-H, --health-path`: URI path for health check
- `-l, --limit`: Request size limit (default: 10000kb)

### Environment Variables

- `ENDPOINT`: AWS OpenSearch cluster endpoint
- `PORT`: Port to bind to (default: 9200)
- `BIND_ADDRESS`: IP address to bind to (default: 127.0.0.1)
- `REGION`: AWS region
- `AUTH_USER`: Username for basic auth
- `AUTH_PASSWORD`: Password for basic auth
- `AWS_PROFILE`: AWS profile to use
- `HEALTH_PATH`: URI path for health check
- `LIMIT`: Request size limit (default: 10000kb)

## AWS Credentials

The proxy supports multiple credential sources:

1. **AWS Profile**: Set `AWS_PROFILE` environment variable
2. **AWS SSO**: Supports SSO profiles configured with `aws configure sso`
3. **Default Credential Chain**: Uses the standard AWS credential chain
4. **Environment Variables**: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN

### Using AWS SSO

If you're using AWS SSO, the proxy will automatically detect and use your SSO credentials:

```bash
# Configure SSO (if not already done)
aws configure sso

# Login to SSO
aws sso login --profile your-sso-profile

# Run the proxy with SSO profile
AWS_PROFILE=your-sso-profile node index.js your-opensearch-cluster.region.es.amazonaws.com
```

The proxy will:

- Automatically detect SSO profiles
- Fall back to regular profiles if SSO is not available
- Provide helpful error messages if SSO authentication is needed
- Watch for SSO configuration changes and refresh credentials automatically

## Access

- **OpenSearch**: `http://localhost:9200`
- **OpenSearch Dashboards**: `http://localhost:9200/_dashboards`
- **Health Check**: `http://localhost:9200/health` (if enabled)

## Changes from AWS SDK v2

This version has been updated to use AWS SDK v3, which provides:

- **Modular imports**: Only import the specific services you need
- **Better performance**: Reduced bundle size and improved runtime performance
- **TypeScript support**: Better type safety and IntelliSense
- **Modern async/await**: Cleaner asynchronous code patterns

### Key Changes

1. **Credential handling**: Now uses `@aws-sdk/credential-providers`
2. **Request signing**: Uses `@aws-sdk/signature-v4` for V4 request signing
3. **Crypto**: Uses `@aws-crypto/sha256-js` for SHA256 hashing
4. **STS client**: Uses `@aws-sdk/client-sts` for credential validation
5. **CLI parsing**: Updated to use yargs v18+ with modern syntax

## Requirements

- Node.js >= 14.0.0
- Valid AWS credentials configured

## License

Apache-2.0
