import crypto, { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import {
  MarketplaceHttpRequest,
  MarketplaceHttpResponse,
} from "../../../../Server/Utils/Marketplace/MarketplaceHttp";

/*
 * Shared by the marketplace suites: real RSA keys (generated once per test
 * file, never committed), the documents their public halves are published in
 * (a JWKS, or Google's key-ID-to-certificate map), tokens signed with them, and
 * a fake HTTP client that records every request and answers from a list.
 */

export interface TestSigningKey {
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
  jwk: Record<string, unknown>;
}

export const createSigningKey: (keyId: string) => TestSigningKey = (
  keyId: string,
): TestSigningKey => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const jwk: Record<string, unknown> = crypto
    .createPublicKey(publicKey)
    .export({ format: "jwk" }) as Record<string, unknown>;

  return {
    keyId: keyId,
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    jwk: { ...jwk, kid: keyId, use: "sig", alg: "RS256" },
  };
};

export const jwksDocument: (keys: Array<TestSigningKey>) => string = (
  keys: Array<TestSigningKey>,
): string => {
  return JSON.stringify({
    keys: keys.map((key: TestSigningKey) => {
      return key.jwk;
    }),
  });
};

/*
 * Google publishes the sign-up token's keys as key ID -> X.509 certificate.
 * A certificate's public key is read exactly like a bare public key PEM, so a
 * test key's SPKI PEM stands in for a certificate it has no way to mint.
 */
export const x509Document: (keys: Array<TestSigningKey>) => string = (
  keys: Array<TestSigningKey>,
): string => {
  const document: Record<string, string> = {};

  for (const key of keys) {
    document[key.keyId] = key.publicKeyPem;
  }

  return JSON.stringify(document);
};

export const signToken: (data: {
  key: TestSigningKey;
  claims: Record<string, unknown>;
  expiresInSeconds?: number | undefined;
  algorithm?: jwt.Algorithm | undefined;
  keyIdOverride?: string | undefined;
}) => string = (data: {
  key: TestSigningKey;
  claims: Record<string, unknown>;
  expiresInSeconds?: number | undefined;
  algorithm?: jwt.Algorithm | undefined;
  keyIdOverride?: string | undefined;
}): string => {
  return jwt.sign(data.claims, data.key.privateKeyPem, {
    algorithm: data.algorithm || "RS256",
    keyid: data.keyIdOverride ?? data.key.keyId,
    ...(data.expiresInSeconds !== undefined
      ? { expiresIn: data.expiresInSeconds }
      : {}),
  });
};

export interface FakeHttpClient {
  requests: Array<MarketplaceHttpRequest>;
  client: (request: MarketplaceHttpRequest) => Promise<MarketplaceHttpResponse>;
}

export type FakeAnswer =
  | { status: number; body: string | Record<string, unknown> }
  | ((request: MarketplaceHttpRequest) => {
      status: number;
      body: string | Record<string, unknown>;
    })
  | Error;

/*
 * Answers requests in order from `answers`; a function answer is asked about
 * the request. Every request is recorded, headers and body included.
 */
export const createFakeHttpClient: (
  answers: Array<FakeAnswer>,
) => FakeHttpClient = (answers: Array<FakeAnswer>): FakeHttpClient => {
  const requests: Array<MarketplaceHttpRequest> = [];
  const queue: Array<FakeAnswer> = [...answers];

  return {
    requests: requests,
    client: async (
      request: MarketplaceHttpRequest,
    ): Promise<MarketplaceHttpResponse> => {
      requests.push(request);

      const answer: FakeAnswer | undefined = queue.shift();

      if (!answer) {
        throw new Error(`Unexpected request: ${request.method} ${request.url}`);
      }

      if (answer instanceof Error) {
        throw answer;
      }

      const resolved: {
        status: number;
        body: string | Record<string, unknown>;
      } = typeof answer === "function" ? answer(request) : answer;

      return {
        status: resolved.status,
        getHeader: (): string | null => {
          return null;
        },
        body:
          typeof resolved.body === "string"
            ? resolved.body
            : JSON.stringify(resolved.body),
      };
    },
  };
};

// A real self-signed certificate (public part only - its key was discarded).
export const PUBLIC_TEST_CERTIFICATE: string = `-----BEGIN CERTIFICATE-----
MIIDLTCCAhWgAwIBAgIUIxFE3zfDNxXMf+fTghPHvWGPHe0wDQYJKoZIhvcNAQEL
BQAwJTEjMCEGA1UEAwwab25ldXB0aW1lLW1hcmtldHBsYWNlLXRlc3QwIBcNMjYx
MDE2MDkwNjM5WhgPMjEyNjA5MjIwOTA2MzlaMCUxIzAhBgNVBAMMGm9uZXVwdGlt
ZS1tYXJrZXRwbGFjZS10ZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEAllQPbV1gS9wYehefI78H7YGeSEcrLtGyt55yHHKopGZaSoVKfSStgEPwA4eM
YUiM1Nh6aCP/y2uCwvzjk95+0E6fPI/rmZdXowABUwLanpqyXCK2aEj/5nVZE9SA
52CJbRNR8wZST3eVJSs1rfm4DP+GJwlKXIeH41EmNYqocT3F66foTPy+b6GKYwCJ
i+Dujiqoc5R0p0KXCt/OhXBSgxTnEOjIGMx760ocb1zHMacums5tKIUFBq0QzIrx
G/LM/jGPFDspE4QS8uWmeM6BeZmWzQ1Vcz91J75uVIXRUa7L+b9tjp/+JZlUldgT
kslNXOnxLyxDR5Pfp9g1qWN+8wIDAQABo1MwUTAdBgNVHQ4EFgQU73OpTul2sDNc
uFVnopA+Ph477ckwHwYDVR0jBBgwFoAU73OpTul2sDNcuFVnopA+Ph477ckwDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAaj24DiyM5nHYU9rk+hFz
MS6W1QQKoGnLz8p8n6477h9y1X1mlC8FBw8+q4Awx6SHD7H25biJWzE1LN4gVYOJ
WFq25CWhh8cH93rgGFZGa4C1bz5CJAaer5o/7YZB8Y1jdF2YMdbWBY7vgm38bB+P
xBg1Q8e3xY/WRRqrZkzJdYGx0vPfFWud488jxF6ONPIYRAcOOioKSIb12TIz3rcN
OAZvu1+WZvnlN+EDZsKXxUrYNx1zJjTWdvk+ShlgIYg5DiDRBv6slpTYmWyJLb3F
yKgKcEanSaLv3hp2QOvvcWajQrvV0SPSStX1oxemyvqGKkYpXPuiRcP6HYERChfR
MQ==
-----END CERTIFICATE-----`;
