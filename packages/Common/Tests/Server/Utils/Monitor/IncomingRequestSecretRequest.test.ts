import IncomingRequestSecretRequest, {
  MAX_PRESENTED_SECRETS,
  PresentedIncomingRequestSecrets,
} from "../../../../Server/Utils/Monitor/IncomingRequestSecretRequest";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import Dictionary from "../../../../Types/Dictionary";
import { createHash } from "crypto";
import { describe, expect, test } from "@jest/globals";

/*
 * The secrets an incoming request presents for its project's secret
 * requirement (issue #7526), read off its headers.
 *
 * What matters:
 *   - X-OneUptime-Secret is always taken off the request, whatever its case,
 *     so the secret is never queued, kept, logged or evaluated;
 *   - a bearer token is read too, but the Authorization header stays - it is
 *     the sender's, and a criteria may read it - until the worker knows it is
 *     one of the project's secrets and masks it;
 *   - only hashes travel, and they are compared in constant time.
 */

const SECRET: string = "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99";
const OTHER_SECRET: string = "0123456789abcdef0123456789abcdef";

const sha256: (value: string) => string = (value: string): string => {
  return createHash("sha256").update(value, "utf8").digest("hex");
};

describe("IncomingRequestSecretRequest.hashSecret", () => {
  test("is the SHA-256 of the value as it is sent", () => {
    expect(IncomingRequestSecretRequest.hashSecret(SECRET)).toBe(
      sha256(SECRET),
    );
  });

  test("ignores the spaces around a value, as a header value does", () => {
    expect(IncomingRequestSecretRequest.hashSecret(`  ${SECRET}\t`)).toBe(
      sha256(SECRET),
    );
  });
});

describe("IncomingRequestSecretRequest.takePresentedSecrets", () => {
  test("takes X-OneUptime-Secret off the request and hashes it", () => {
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        "x-oneuptime-secret": SECRET,
        "content-type": "application/json",
      });

    expect(presented.requestHeaders).toEqual({
      "content-type": "application/json",
    });
    expect(presented.secretHashes).toEqual([sha256(SECRET)]);
    expect(JSON.stringify(presented)).not.toContain(SECRET);
  });

  test.each(["X-OneUptime-Secret", "X-ONEUPTIME-SECRET", "x-OneUptime-secret"])(
    "takes the header off whatever its case: %s",
    (name: string) => {
      const presented: PresentedIncomingRequestSecrets =
        IncomingRequestSecretRequest.takePresentedSecrets({
          [name]: SECRET,
        });

      expect(presented.requestHeaders).toEqual({});
      expect(presented.secretHashes).toEqual([sha256(SECRET)]);
    },
  );

  test("reads a bearer token but leaves the Authorization header in place", () => {
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        authorization: `Bearer ${SECRET}`,
      });

    expect(presented.requestHeaders).toEqual({
      authorization: `Bearer ${SECRET}`,
    });
    expect(presented.secretHashes).toEqual([sha256(SECRET)]);
  });

  test("presents nothing for an Authorization header that is not a bearer token", () => {
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        authorization: "Basic dXNlcjpwYXNzd29yZA==",
      });

    expect(presented.secretHashes).toEqual([]);
    expect(presented.requestHeaders).toEqual({
      authorization: "Basic dXNlcjpwYXNzd29yZA==",
    });
  });

  test("presents both a header and a bearer token, once each", () => {
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        "x-oneuptime-secret": SECRET,
        authorization: `Bearer ${OTHER_SECRET}`,
      });

    expect(presented.secretHashes).toEqual([
      sha256(SECRET),
      sha256(OTHER_SECRET),
    ]);
  });

  test("does not repeat a secret sent in both places", () => {
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        "x-oneuptime-secret": SECRET,
        authorization: `Bearer ${SECRET}`,
      });

    expect(presented.secretHashes).toEqual([sha256(SECRET)]);
  });

  test("reads a header a proxy repeated: joined, whole and split at its commas", () => {
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        "x-oneuptime-secret": [SECRET, OTHER_SECRET],
      });

    expect(presented.secretHashes).toContain(sha256(SECRET));
    expect(presented.secretHashes).toContain(sha256(OTHER_SECRET));
  });

  test("a secret with a comma in it is still tried whole", () => {
    const withComma: string = "abc,defghijklmnopqrstu";

    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        "x-oneuptime-secret": withComma,
      });

    expect(presented.secretHashes[0]).toBe(sha256(withComma));
  });

  test("hashes at most MAX_PRESENTED_SECRETS, however many commas a header has", () => {
    const many: string = Array.from({ length: 1000 }, (_v: unknown, i: number) => {
      return `secret-number-${i}`;
    }).join(",");

    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        "x-oneuptime-secret": many,
      });

    expect(presented.secretHashes.length).toBe(MAX_PRESENTED_SECRETS);
  });

  test("presents nothing for an empty header, and still takes it off", () => {
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        "x-oneuptime-secret": "   ",
        accept: "*/*",
      });

    expect(presented.secretHashes).toEqual([]);
    expect(presented.requestHeaders).toEqual({ accept: "*/*" });
  });

  test("keeps every other header as it came, and skips undefined ones", () => {
    const presented: PresentedIncomingRequestSecrets =
      IncomingRequestSecretRequest.takePresentedSecrets({
        "x-forwarded-for": ["10.0.0.1", "10.0.0.2"],
        "user-agent": "curl/8.0",
        "x-empty": undefined,
      });

    expect(presented.requestHeaders).toEqual({
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
      "user-agent": "curl/8.0",
    });
  });

  test("answers an empty request when there are no headers", () => {
    expect(IncomingRequestSecretRequest.takePresentedSecrets(undefined)).toEqual(
      { requestHeaders: {}, secretHashes: [] },
    );
  });
});

describe("IncomingRequestSecretRequest.getBearerToken", () => {
  test.each([
    [`Bearer ${SECRET}`, SECRET],
    [`bearer ${SECRET}`, SECRET],
    [`BEARER   ${SECRET}  `, SECRET],
    [`  Bearer\t${SECRET}`, SECRET],
  ])("reads %j", (value: string, token: string) => {
    expect(IncomingRequestSecretRequest.getBearerToken(value)).toBe(token);
  });

  test.each([
    ["Bearer"],
    ["Bearer "],
    [`Bearer${SECRET}`],
    [`Basic ${SECRET}`],
    [SECRET],
    [""],
  ])("reads no token from %j", (value: string) => {
    expect(IncomingRequestSecretRequest.getBearerToken(value)).toBeNull();
  });

  test("reads no token from no header", () => {
    expect(IncomingRequestSecretRequest.getBearerToken(undefined)).toBeNull();
    expect(IncomingRequestSecretRequest.getBearerToken(null)).toBeNull();
  });
});

describe("IncomingRequestSecretRequest.findMatchingHash", () => {
  test("answers the project's hash a presented one matches", () => {
    expect(
      IncomingRequestSecretRequest.findMatchingHash({
        presentedSecretHashes: [sha256(OTHER_SECRET), sha256(SECRET)],
        projectSecretHashes: [sha256("a-third-secret-value"), sha256(SECRET)],
      }),
    ).toBe(sha256(SECRET));
  });

  test("answers null when nothing matches", () => {
    expect(
      IncomingRequestSecretRequest.findMatchingHash({
        presentedSecretHashes: [sha256(OTHER_SECRET)],
        projectSecretHashes: [sha256(SECRET)],
      }),
    ).toBeNull();
  });

  test("answers null when either side is empty", () => {
    expect(
      IncomingRequestSecretRequest.findMatchingHash({
        presentedSecretHashes: [],
        projectSecretHashes: [sha256(SECRET)],
      }),
    ).toBeNull();
    expect(
      IncomingRequestSecretRequest.findMatchingHash({
        presentedSecretHashes: [sha256(SECRET)],
        projectSecretHashes: [],
      }),
    ).toBeNull();
  });

  test("never matches something that is not a SHA-256 digest", () => {
    expect(
      IncomingRequestSecretRequest.findMatchingHash({
        presentedSecretHashes: [SECRET, "", "zz".repeat(32)],
        projectSecretHashes: [SECRET, "", "zz".repeat(32)],
      }),
    ).toBeNull();
  });

  test("matches a digest whatever the case of its hex", () => {
    expect(
      IncomingRequestSecretRequest.findMatchingHash({
        presentedSecretHashes: [sha256(SECRET).toUpperCase()],
        projectSecretHashes: [sha256(SECRET)],
      }),
    ).toBe(sha256(SECRET));
  });
});

describe("IncomingRequestSecretRequest.withoutSecretInAuthorization", () => {
  test("masks a bearer token that is one of the project's secrets", () => {
    const headers: Dictionary<string> = {
      Authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    };

    const kept: Dictionary<string> | undefined =
      IncomingRequestSecretRequest.withoutSecretInAuthorization({
        requestHeaders: headers,
        projectSecretHashes: [sha256(SECRET)],
      });

    expect(kept).toEqual({
      Authorization: `Bearer ${REDACTED}`,
      "content-type": "application/json",
    });

    // The headers handed in are not changed.
    expect(headers["Authorization"]).toBe(`Bearer ${SECRET}`);
  });

  test("leaves the sender's own bearer token alone", () => {
    const headers: Dictionary<string> = {
      authorization: `Bearer ${OTHER_SECRET}`,
    };

    expect(
      IncomingRequestSecretRequest.withoutSecretInAuthorization({
        requestHeaders: headers,
        projectSecretHashes: [sha256(SECRET)],
      }),
    ).toBe(headers);
  });

  test("leaves a Basic Authorization header alone", () => {
    const headers: Dictionary<string> = {
      authorization: "Basic dXNlcjpwYXNzd29yZA==",
    };

    expect(
      IncomingRequestSecretRequest.withoutSecretInAuthorization({
        requestHeaders: headers,
        projectSecretHashes: [sha256(SECRET)],
      }),
    ).toBe(headers);
  });

  test("hands back no headers when there were none", () => {
    expect(
      IncomingRequestSecretRequest.withoutSecretInAuthorization({
        requestHeaders: undefined,
        projectSecretHashes: [sha256(SECRET)],
      }),
    ).toBeUndefined();
  });
});
