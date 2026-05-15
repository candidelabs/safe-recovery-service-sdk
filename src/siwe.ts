import { getAddress } from "ethers";
import { ensureError, SafeRecoveryServiceSdkError } from "./errors";

const NONCE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const NONCE_LENGTH = 17;

function generateNonce(): string {
  const out: string[] = [];
  const buf = new Uint8Array(1);
  // Rejection sampling to avoid modulo bias (256 % 62 != 0).
  const limit = 256 - (256 % NONCE_ALPHABET.length);
  while (out.length < NONCE_LENGTH) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      out.push(NONCE_ALPHABET[buf[0] % NONCE_ALPHABET.length]);
    }
  }
  return out.join("");
}

export function generateSIWEMessage(
  accountAddress: string,
  statement: string,
  chainId: bigint,
  siweDomain: string,
  siweUri: string,
): string {
  try {
    const address = getAddress(accountAddress);
    const issuedAt = new Date().toISOString();
    const nonce = generateNonce();
    return (
      `${siweDomain} wants you to sign in with your Ethereum account:\n` +
      `${address}\n` +
      `\n` +
      `${statement}\n` +
      `\n` +
      `URI: ${siweUri}\n` +
      `Version: 1\n` +
      `Chain ID: ${Number(chainId)}\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt}`
    );
  } catch (err) {
    const error = ensureError(err);
    throw new SafeRecoveryServiceSdkError("SIWE_ERROR", error.message, {
      cause: error,
      context: {
        accountAddress,
        statement,
      },
    });
  }
}
