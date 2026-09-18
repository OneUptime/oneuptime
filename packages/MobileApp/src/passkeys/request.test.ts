import * as Crypto from "expo-crypto";
import {
  createPasskeyRequest,
  parsePasskeyCallback,
  passkeyServerOrigin,
  PasskeyRequest,
} from "./request";

jest.mock("expo-crypto", () => {
  return {
    getRandomBytesAsync: jest.fn(),
    digestStringAsync: jest.fn(),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { BASE64: "base64" },
  };
});

const request: PasskeyRequest = {
  state: "a".repeat(64),
  codeVerifier: "b".repeat(64),
  serverOrigin: "https://status.example.com:8443",
  url: "unused",
};
const code: string = "c".repeat(43);
function callback(
  query: string = `code=${code}&state=${request.state}&serverOrigin=${encodeURIComponent(request.serverOrigin)}`,
): string {
  return `oneuptime://passkey?${query}`;
}

describe("A passkey request stays bound to its selected HTTPS server", () => {
  test.each([
    ["https://EXAMPLE.com/", "https://example.com"],
    ["https://example.com:443", "https://example.com"],
    ["https://example.com:8443", "https://example.com:8443"],
    ["https://[::1]:8443", "https://[::1]:8443"],
  ])("normalizes %s", (input: string, expected: string) => {
    expect(passkeyServerOrigin(input)).toBe(expected);
  });
  test.each([
    "http://example.com",
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com?next=other",
    "https://example.com#fragment",
    "https://example.com:65536",
    "https://example.com:0",
    "https://example.com\\@evil.com",
    "https://example.com\n",
    "https://example.com/\r\n",
    "https://example.com\t",
  ])("rejects unsafe server %s before opening the browser", (url: string) => {
    expect(() => {
      return passkeyServerOrigin(url);
    }).toThrow(/HTTPS/);
  });
  test("uses independent secure entropy and a SHA256 proof without exposing the verifier", async () => {
    jest
      .mocked(Crypto.getRandomBytesAsync)
      .mockResolvedValueOnce(new Uint8Array(32).fill(170))
      .mockResolvedValueOnce(new Uint8Array(32).fill(187));
    jest
      .mocked(Crypto.digestStringAsync)
      .mockResolvedValue(`${"+".repeat(21)}${"/".repeat(22)}=`);
    const created: PasskeyRequest = await createPasskeyRequest(
      "https://status.example.com:8443",
    );
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledTimes(2);
    expect(Crypto.getRandomBytesAsync).toHaveBeenNthCalledWith(1, 32);
    expect(Crypto.getRandomBytesAsync).toHaveBeenNthCalledWith(2, 32);
    expect(created.codeVerifier).toBe("aa".repeat(32));
    expect(created.state).toBe("bb".repeat(32));
    expect(Crypto.digestStringAsync).toHaveBeenCalledWith(
      "SHA-256",
      created.codeVerifier,
      { encoding: "base64" },
    );
    expect(created.url).toBe(
      `https://status.example.com:8443/accounts/mobile-passkey?state=${created.state}&codeChallenge=${"-".repeat(21)}${"_".repeat(22)}&codeChallengeMethod=S256`,
    );
    expect(created.url).not.toContain(created.codeVerifier);
  });
});

describe("Only the exact in-flight passkey callback is accepted", () => {
  test("accepts the one-time code and preserves it for exchange", () => {
    expect(parsePasskeyCallback(callback(), request)).toEqual({
      status: "success",
      code,
    });
  });
  test("accepts a state-bound cancellation from the selected server", () => {
    expect(
      parsePasskeyCallback(
        callback(
          `error=access_denied&state=${request.state}&serverOrigin=${encodeURIComponent(request.serverOrigin)}`,
        ),
        request,
      ),
    ).toEqual({ status: "cancelled" });
  });
  test.each([
    callback().replace("oneuptime://", "https://"),
    callback().replace("passkey?", "passkey-evil?"),
    callback().replace("passkey?", "evil@passkey?"),
    callback().replace("passkey?", "passkey/path?"),
    `${callback()}#fragment`,
    `${callback()}\n`,
    `${callback()}\r\n`,
    callback().replace(code, `${code}\n`),
    callback().replace(code, `${code}%0A`),
    callback().replace(code, `${code}%0D%0A`),
    callback().replace(request.state, "d".repeat(64)),
    callback().replace(
      encodeURIComponent(request.serverOrigin),
      "https%3A%2F%2Fevil.example",
    ),
    `${callback()}&state=${request.state}`,
    `${callback()}&%73tate=${request.state}`,
    `${callback()}&accessToken=forged`,
    `${callback()}&error=access_denied`,
    callback().replace(code, "short"),
    callback().replace(code, "a%2Bb"),
    `${callback()}&broken`,
    `${callback()}&%ZZ=value`,
    `oneuptime://passkey?code=${code}&state=${request.state}`,
  ])("rejects an unbound or ambiguous callback %#", (url: string) => {
    expect(() => {
      return parsePasskeyCallback(url, request);
    }).toThrow(/could not be verified/);
  });
});
