# Candide Guardian Recovery Example

This example demonstrates integrating Candide Guardian service for simplified Safe account recovery with email and SMS verification.

## Running the Example

```bash
# From examples directory
yarn dev:candide-guardian-recovery
```

## Configuration

Ensure your `.env` file is configured with:
- `CHAIN_ID`: Network chain ID (11155111 for Sepolia)
- `NODE_URL`: RPC endpoint
- `BUNDLER_URL` & `PAYMASTER_URL`: For sponsored transactions
- `RECOVERY_SERVICE_URL`: Recovery service endpoint
- `USER_EMAIL`: Your email address for guardian registration
- `USER_PHONE`: Your phone number for SMS registration (include country code, e.g., +1234567890)

## Workflow

### 1. Safe Account Setup
Create a Safe account with Social Recovery Module enabled.

### 2. Choose Recovery Methods
Select your preferred verification channels during setup:
- Email only
- SMS only  
- Both email and SMS (recommended for security)

### 3. Candide Guardian Registration
- Register selected channel(s) with SIWE signature and OTP verification
- Add Candide Guardian address to Safe's guardian list

### 4. Recovery Process
- Request recovery signature from Candide Guardian service
- **Verify ALL registered channels** (majority threshold security)
- Submit OTP codes for each registered verification method
- Service automatically executes recovery after grace period
