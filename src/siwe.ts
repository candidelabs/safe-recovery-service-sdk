import { getAddress } from "ethers";
import { ensureError, SafeRecoveryServiceSdkError } from "./errors";

const NONCE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const NONCE_LENGTH = 17;

// Control chars (C0 + DEL) break the single-line EIP-4361 grammar. The old
// `new SiweMessage(...)` path round-trip-parsed and threw on these; preserve
// that so invalid input fails fast as SIWE_ERROR rather than producing a
// message the backend parser rejects later.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function validateSiweFields(
  statement: string,
  siweDomain: string,
  siweUri: string,
): void {
  if (CONTROL_CHARS.test(statement)) {
    throw new Error("invalid SIWE statement: control characters not allowed");
  }
  if (siweDomain === "" || /\s/.test(siweDomain) || CONTROL_CHARS.test(siweDomain)) {
    throw new Error(`invalid SIWE domain: ${JSON.stringify(siweDomain)}`);
  }
  try {
    new URL(siweUri);
  } catch {
    throw new Error(`invalid SIWE URI: ${JSON.stringify(siweUri)}`);
  }
}

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
    validateSiweFields(statement, siweDomain, siweUri);
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
