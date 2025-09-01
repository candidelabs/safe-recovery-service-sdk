# Recovery Flow Example

This example demonstrates the complete Safe Recovery Service workflow using guardian-based social recovery.

## Running the Example

```bash
# From examples directory
yarn dev:recovery-flow
```

## Configuration

Ensure your `.env` file is configured with:
- `CHAIN_ID`: Network chain ID (11155111 for Sepolia)
- `NODE_URL`: RPC endpoint
- `BUNDLER_URL` & `PAYMASTER_URL`: For sponsored transactions
- `RECOVERY_SERVICE_URL`: Recovery service endpoint

## Workflow

### 1. Safe Account Setup
Create a Safe account with Social Recovery Module and configure guardians with threshold requirements.

### 2. Guardian Recovery Request
- First guardian signs EIP-712 recovery data with their private key
- Guardian submits the recovery request with their signature
- Service generates unique emoji for this specific recovery request

### 3. Emoji Authentication System
- Each recovery request gets a unique emoji sequence from the service
- The initiating guardian communicates these emojis to other guardians through secure channels
- Other guardians verify emojis match before signing to ensure they're helping with legitimate recovery
- This prevents malicious actors from tricking guardians into signing unauthorized recovery requests

### 4. Guardian Signature Collection
- Additional guardians sign the same EIP-712 recovery data after verifying emojis
- Submit signatures until threshold is met

### 5. Service-Handled Execution
- Service constructs and submits the recovery transaction on-chain
- Handles gas estimation, nonce management, and transaction monitoring

### 6. Service-Handled Finalization
- Service waits for grace period and submits finalization transaction
- Handles all blockchain complexity automatically

## Key Benefits

- **Guardians Sign Once**: Off-chain signature collection eliminates the need for guardians to share links with one another
- **Privacy Guaranteed**: Guardians sign only off-chain and do not need to maintain a balance in their accounts, allowing them to preserve their pseudonymity with fresh accounts
- **Social Engineering Protection**: A communication system using emojis that allows guardians to verify and approve legitimate recovery requests from their rightful owners
- **Finalization After Grace Period**: A built-in relayer that submits signed transactions on behalf of guardians for confirmation and finalization once the grace period has elapsed
- **Simple SDK Interface**: Secure recovery operations without manually managing gas, nonces, or transaction construction
