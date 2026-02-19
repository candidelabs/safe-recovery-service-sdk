# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Safe Recovery Service SDK by Candidelabs, a TypeScript SDK for interacting with Safe's social recovery module. The SDK enables account recovery through guardian-based mechanisms and custodial guardian services, with support for alert subscriptions and SIWE (Sign-In With Ethereum) authentication.

## Commands

### Build and Development
- **Build**: `yarn build` - Compiles TypeScript to JavaScript using microbundle, outputs to `dist/`
- **Clean**: `yarn clean` - Removes the `dist/` directory
- **Test**: `yarn test` - Runs Jest tests with verbose output

### Package Management
- Uses Yarn as the package manager
- Main dependencies: `abstractionkit`, `isomorphic-unfetch`, `siwe`
- Dev dependencies include TypeScript, Jest, and microbundle

## Architecture and Core Components

### Main Services

1. **RecoveryByGuardian** (`src/recoveryByGuardian.ts`)
   - Handles recovery requests through guardian signatures
   - Supports different grace periods (3 minutes, 3 days, 7 days, 14 days)
   - Manages recovery request lifecycle: PENDING → EXECUTED → FINALIZED
   - Key methods: `createRecoveryRequest()`, `getRecoveryRequestsForLatestNonce()`

2. **RecoveryByCustodialGuardian** (`src/recoveryByCustodialGuardian.ts`)
   - Manages custodial guardian authentication and recovery
   - Handles registration/authentication via multiple channels (email, SMS)
   - Uses SIWE for secure authentication
   - Key methods: `getRegistrations()`, `requestCustodialGuardianSignatureChallenge()`, `createAndExecuteRecoveryRequest()`

3. **Alerts** (`src/alerts.ts`)
   - Manages alert subscriptions for recovery events
   - Supports email and SMS notifications
   - Uses off-chain EOA signatures (plain `signMessage()` on a SIWE message) for authentication
   - Key methods: `createEmailSubscription()`, `activateSubscription()`, `getActiveSubscriptions()`

### Utility Components

- **Error Handling** (`src/errors.ts`): Custom `SafeRecoveryServiceSdkError` class with structured error codes
- **Utils** (`src/utils.ts`): SIWE message generation, network configuration, module address resolution
- **Social Recovery Module Variants**: Pre-defined addresses for different grace periods

### Network Configuration

The SDK supports multiple networks with different configurations:
- Each network has a specific Social Recovery Module address
- Grace periods: 3 minutes (testing), 3 days, 7 days, 14 days
- Sponsorship settings for execution and finalization
- Configurable alert channels per network

## Key Patterns

### Authentication Patterns

Two distinct signature patterns are used across the SDK:

**Off-chain EOA signature** (used by `Alerts`):
- Plain `signMessage()` on a SIWE statement string
- Simpler — no EIP-712 envelope needed
- Used by: `createEmailSubscription()`, `createSubscription()`, `getActiveSubscriptions()`

**EIP-1271 contract signature** (used by `RecoveryByCustodialGuardian`):
- The Safe contract validates off-chain messages via its own EIP-712-based scheme
- Flow: `getSafeMessageEip712Data()` → `signTypedData()` → `buildSignaturesFromSingerSignaturePairs()`
- Required because the service verifies the signature against the Safe contract (not just the EOA)
- Used by: `createRegistrationToEmailRecovery()`, `createRegistrationToSmsRecovery()`, `getRegistrations()`

### Recovery Process
1. Create recovery request with new owners/threshold
2. Collect required guardian signatures
3. Execute recovery (optionally sponsored)
4. Wait for grace period (security window for original owner to cancel)
5. Finalize recovery (optionally sponsored)

### Error Handling
- All service methods throw `SafeRecoveryServiceSdkError` with structured error codes
- Common error codes: `SIWE_ERROR`, `HTTP_ERROR`, `BAD_DATA`, `TIMEOUT`
- Errors include context for debugging

## Examples Overview

| # | Directory | Purpose | Prerequisites |
|---|---|---|---|
| 01 | `01-enable-email-sms-recovery/` | Deploy Safe, register email/SMS, add guardian on-chain | No prior setup — generates `OWNER_PRIVATE_KEY` automatically |
| 02 | `02-alerts-setup/` | Subscribe email/SMS to recovery event notifications | Example 01 complete; `SAFE_ACCOUNT_ADDRESS` in `.env` |
| 03 | `03-recovery-flow/` | Trigger, wait grace period, finalize recovery | Example 01 complete; `SAFE_ACCOUNT_ADDRESS` in `.env` |

### Developer Flow (ASCII)

```
Setup (Example 01):                    Recovery (Example 03):
  Deploy Safe                            requestCustodialGuardianSignatureChallenge()
      ↓                                           ↓
  Register email/SMS (OTP verify)        Verify channels via OTP
      ↓                                           ↓
  Add guardian on-chain                  createAndExecuteRecoveryRequest()
      ↓                                           ↓
  [Example 02] Set up alerts             Wait grace period → finalizeRecoveryRequest()
                                                  ↓
                                         Verify new owners on-chain
```

### Running Examples

```bash
cd examples
yarn install
cp .env.example .env
# Fill in CHAIN_ID, RECOVERY_SERVICE_URL, NODE_URL, BUNDLER_URL, PAYMASTER_URL,
# SPONSORSHIP_POLICY_ID, USER_EMAIL (and USER_PHONE for SMS)

# Run in order:
yarn dev:enable-email-sms-recovery   # → generates and prints OWNER_PRIVATE_KEY + SAFE_ACCOUNT_ADDRESS; copy both into .env
yarn dev:alerts-setup
yarn dev:recovery-flow
```

### Environment Variables Reference

| Variable | Example 01 | Example 02 | Example 03 | Description |
|---|---|---|---|---|
| `CHAIN_ID` | required | required | required | Network chain ID |
| `RECOVERY_SERVICE_URL` | required | required | required | Candide Recovery Service URL |
| `NODE_URL` | required | — | required | RPC node URL |
| `BUNDLER_URL` | required | — | — | ERC-4337 bundler URL |
| `PAYMASTER_URL` | required | — | — | Paymaster URL |
| `SPONSORSHIP_POLICY_ID` | required | — | — | Gas sponsorship policy |
| `OWNER_PRIVATE_KEY` | optional (auto-generated) | required | — | Safe owner private key |
| `SAFE_ACCOUNT_ADDRESS` | — | required | required | From Example 01 output |
| `USER_EMAIL` | required | required | — | Email for recovery channels/alerts |
| `USER_PHONE` | optional (SMS only) | optional (SMS only) | — | Phone number for SMS |

## Key Types Quick Reference

| Type | Location | Description |
|---|---|---|
| `RecoveryByGuardianRequest` | `src/recoveryByGuardian.ts` | Recovery request with status, emoji, execute/finalize data |
| `Registration` | `src/recoveryByCustodialGuardian.ts` | A registered recovery channel (email or SMS) |
| `SignatureRequest` | `src/recoveryByCustodialGuardian.ts` | Custodial guardian signature challenge with auth list |
| `AlertsSubscription` | `src/alerts.ts` | An active alert subscription (channel, target, id) |

## Testing

- Uses Jest with TypeScript support
- Test files located in `test/` directory
- Covers core functionality of recovery services and alerts
- Run tests with `yarn test`
