# Alerts Subscription Example

This example demonstrates setting up email and SMS alert subscriptions for Safe Recovery Service to monitor recovery events on your Safe account.

## Running the Example

```bash
# From examples directory
yarn dev:alerts-subscription
```

## Configuration

Ensure your `.env` file is configured with:
- `CHAIN_ID`: Network chain ID (11155111 for Sepolia)
- `NODE_URL`: RPC endpoint
- `BUNDLER_URL` & `PAYMASTER_URL`: For sponsored transactions
- `RECOVERY_SERVICE_URL`: Recovery service endpoint
- `USER_EMAIL`: Your email address for receiving alerts
- `USER_PHONE`: Your phone number for receiving SMS alerts (include country code, e.g., +1234567890)

## Workflow

### 1. Safe Account Setup
Create a Safe account with Social Recovery Module and add a guardian.

### 2. Alert Service Configuration
Initialize the Alerts service client with the recovery service endpoint and chain ID.

### 3. Email Subscription Creation
- Generate a SIWE (Sign-In With Ethereum) message for email subscription
- Sign the message with the Safe owner's private key
- Submit the subscription request to the recovery service
- Receive a unique subscription ID

### 4. Email Activation
- Check your email for an OTP (One-Time Password) activation code
- Enter the OTP when prompted by the terminal
- Activate the subscription to start receiving alerts

### 5. SMS Subscription Creation
- Generate a SIWE message for SMS subscription
- Sign the message with the Safe owner's private key
- Submit the SMS subscription request to the recovery service
- Receive a unique SMS subscription ID

### 6. SMS Activation
- Check your phone for an SMS with OTP activation code
- Enter the SMS OTP when prompted by the terminal
- Activate the SMS subscription to start receiving SMS alerts

### 7. Subscription Verification
- Retrieve and display all active subscriptions for the Safe account
- Verify both email and SMS subscriptions are properly configured

## Alert Types

Once activated, you'll receive email and SMS notifications for:

- **Recovery Request Initiated**: When a guardian starts a recovery process
- **Recovery Request Executed**: When a recovery request is submitted on-chain
- **Recovery Request Finalized**: When a recovery is completed after the grace period
- **Guardian Configuration Changes**: When guardians are added, removed, or thresholds change

## Key Features

- **SIWE Authentication**: Secure authentication using Sign-In With Ethereum standard
- **OTP Verification**: Email and SMS verification ensures you own both contact methods
- **Real-time Monitoring**: Immediate notifications for all recovery-related events
- **Multi-Chain Support**: Works across different EVM-compatible networks (Note: While the alert service is initialized with a specific chain ID, users are subscribed to receive alerts for recovery events across all supported chains)
- **Privacy Focused**: Only the Safe owner can subscribe and manage their alerts for their account

## Next Steps

After setting up alerts, you can:
- Manage existing subscriptions (unsubscribe, view status)
- Test the complete recovery flow to see alerts in action