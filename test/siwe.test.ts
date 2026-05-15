import { SiweMessage } from "siwe";
import { getAddress } from "ethers";
import { generateSIWEMessage } from "../src/siwe";
import { SafeRecoveryServiceSdkError } from "../src/errors";

const ACCOUNT = "0x388c818ca8b9251b393131c08a736a67ccb19297"; // lowercase on purpose
const STATEMENT = "Sign in to Safe Recovery Service";
const DOMAIN = "service://safe-recovery-service";
const URI = "service://safe-recovery-service";

describe("generateSIWEMessage", () => {
  it("produces a string that the real SIWE parser accepts and round-trips", () => {
    const msg = generateSIWEMessage(ACCOUNT, STATEMENT, 11155111n, DOMAIN, URI);
    const parsed = new SiweMessage(msg); // throws if format is invalid

    expect(parsed.address).toBe(getAddress(ACCOUNT));
    expect(parsed.scheme).toBe("service");
    expect(parsed.domain).toBe("safe-recovery-service");
    expect(parsed.uri).toBe(URI);
    expect(parsed.version).toBe("1");
    expect(parsed.chainId).toBe(11155111);
    expect(parsed.statement).toBe(STATEMENT);
    expect(parsed.nonce).toMatch(/^[A-Za-z0-9]{17}$/);
    expect(typeof parsed.issuedAt).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.issuedAt as string))).toBe(false);
  });

  it("emits the exact EIP-4361 layout (no trailing newline, single blank-line separators)", () => {
    const msg = generateSIWEMessage(ACCOUNT, STATEMENT, 1n, DOMAIN, URI);
    const lines = msg.split("\n");
    expect(msg.endsWith("\n")).toBe(false);
    expect(lines[0]).toBe(`${DOMAIN} wants you to sign in with your Ethereum account:`);
    expect(lines[1]).toBe(getAddress(ACCOUNT));
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe(STATEMENT);
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe(`URI: ${URI}`);
    expect(lines[6]).toBe("Version: 1");
    expect(lines[7]).toBe("Chain ID: 1");
    expect(lines[8]).toMatch(/^Nonce: [A-Za-z0-9]{17}$/);
    expect(lines[9]).toMatch(/^Issued At: /);
    expect(lines.length).toBe(10);
  });

  it("matches siwe's own prepareMessage byte-for-byte for identical inputs", () => {
    const msg = generateSIWEMessage(ACCOUNT, STATEMENT, 1n, DOMAIN, URI);
    const parsed = new SiweMessage(msg);
    const reference = new SiweMessage({
      version: "1",
      address: getAddress(ACCOUNT),
      domain: DOMAIN,
      uri: URI,
      statement: STATEMENT,
      chainId: 1,
      nonce: parsed.nonce,
      issuedAt: parsed.issuedAt,
    }).prepareMessage();
    expect(msg).toBe(reference);
  });

  it("generates unique nonces across many calls", () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const parsed = new SiweMessage(
        generateSIWEMessage(ACCOUNT, STATEMENT, 1n, DOMAIN, URI),
      );
      nonces.add(parsed.nonce);
    }
    expect(nonces.size).toBe(500);
  });

  it("wraps invalid address in SafeRecoveryServiceSdkError SIWE_ERROR", () => {
    expect.assertions(3);
    try {
      generateSIWEMessage("not-an-address", STATEMENT, 1n, DOMAIN, URI);
    } catch (e) {
      const err = e as SafeRecoveryServiceSdkError;
      expect(err).toBeInstanceOf(SafeRecoveryServiceSdkError);
      expect(err.code).toBe("SIWE_ERROR");
      expect(err.context).toMatchObject({ accountAddress: "not-an-address", statement: STATEMENT });
    }
  });

  it.each([
    ["statement with newline", "hello\nworld", DOMAIN, URI],
    ["statement with tab", "hello\tworld", DOMAIN, URI],
    ["empty domain", STATEMENT, "", URI],
    ["domain with spaces", STATEMENT, "bad domain !!", URI],
    ["non-URI uri", STATEMENT, DOMAIN, "not a uri"],
  ])(
    "wraps invalid SIWE field (%s) as SafeRecoveryServiceSdkError SIWE_ERROR",
    (_label, statement, domain, uri) => {
      expect.assertions(2);
      try {
        generateSIWEMessage(ACCOUNT, statement, 1n, domain, uri);
      } catch (e) {
        const err = e as SafeRecoveryServiceSdkError;
        expect(err).toBeInstanceOf(SafeRecoveryServiceSdkError);
        expect(err.code).toBe("SIWE_ERROR");
      }
    },
  );

  it("still accepts the SDK's default service:// domain and URI", () => {
    const msg = generateSIWEMessage(
      ACCOUNT,
      STATEMENT,
      1n,
      "service://safe-recovery-service",
      "service://safe-recovery-service",
    );
    expect(msg).toContain("service://safe-recovery-service wants you to sign in");
  });
});
