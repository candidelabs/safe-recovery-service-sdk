# Safe Recovery Service SDK Examples

This directory contains example code demonstrating how to use the Safe Recovery Service SDK.

## Setup

1. **Install dependencies:**
   ```bash
   cd examples
   yarn install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

## Examples

### 01-recovery-flow

Complete guardian-based recovery workflow demonstrating:
- Safe account creation with Social Recovery Module
- Guardian setup with threshold requirements
- Recovery request creation with emoji authentication
- Off-chain signature collection
- Service-managed execution and finalization

**Run:**
```bash
yarn dev:recovery-flow
```

### 02-alerts-subscription

Email and SMS alert subscription setup demonstrating:
- Safe account creation with Social Recovery Module
- Email and SMS alert subscriptions with SIWE (Sign in with Ethereum)
- OTP activation
- Active subscription verification

**Run:**
```bash
yarn dev:alerts-subscription
```

## Requirements

- Node.js 16+
- Valid RPC endpoints for your target network
- Recovery service URL

## Network Support

Examples are configured for Base Sepolia testnet by default. Update the `CHAIN_ID` and URLs in `.env` for other networks.