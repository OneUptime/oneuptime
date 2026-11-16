import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncomingRequestSignature, {
  MAX_DIGESTS_PER_SIGNATURE,
  PresentedSignature,
  SignatureProblem,
  SignatureVerification,
  SigningSecret,
} from "../../../../Server/Utils/Monitor/IncomingRequestSignature";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import Dictionary from "../../../../Types/Dictionary";
import {
  INCOMING_REQUEST_SIGNATURE_FORMATS,
  INCOMING_REQUEST_SIGNATURE_HEADER,
  INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS,
  INCOMING_REQUEST_UNTIMED_SIGNATURE_MEMORY_SECONDS,
  IncomingRequestSignatureScheme,
} from "../../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A request signed with one of the project's incoming request secrets
 * (issue #8500): which signatures are read, what each is made over, which
 * secret made one, and that a signature is accepted once.
 *
 * The negative cases are the point: a wrong secret, a body changed on the
 * way, a time too far from the clock either way, a replayed request, and
 * every header that only looks like a signature.
 */

jest.mock("../../../../Server/Utils/Logger");

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
const NOW_SECONDS: number = Math.floor(NOW.getTime() / 1000);

const SECRET: SigningSecret = {
  secretId: "5ec2e700-0000-4000-8000-000000000001",
  value: "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99",
};

const OTHER_SECRET: SigningSecret = {
  secretId: "5ec2e700-0000-4000-8000-000000000002",
  value: "0123456789abcdef0123456789abcdef",
};

const BODY: string = '{"status":"healthy","version":"1.2.3"}';

const headerOf: (scheme: IncomingRequestSignatureScheme) => string = (
  scheme: IncomingRequestSignatureScheme,
): string => {
  return IncomingRequestSignature.formatOf(scheme).header;
};

// The request's headers, signed as its sender would sign them.
const signedHeaders: (data: {
  scheme: IncomingRequestSignatureScheme;
  secret?: string | undefined;
  body?: string | undefined;
  timestampSeconds?: number | undefined;
}) => Dictionary<string> = (data: {
  scheme: IncomingRequestSignatureScheme;
  secret?: string | undefined;
  body?: string | undefined;
  timestampSeconds?: number | undefined;
}): Dictionary<string> => {
  const timestampSeconds: number = data.timestampSeconds ?? NOW_SECONDS;

  const signature: string = IncomingRequestSignature.sign({
    scheme: data.scheme,
    secret: data.secret || SECRET.value,
    body: data.body ?? BODY,
    timestampSeconds,
  });

  const headers: Dictionary<string> = {
    "content-type": "application/json",
    [headerOf(data.scheme).toLowerCase()]: signature,
  };

  if (data.scheme === IncomingRequestSignatureScheme.Slack) {
    headers["x-slack-request-timestamp"] = String(timestampSeconds);
  }

  return headers;
};

const verify: (data: {
  headers: Dictionary<string>;
  body?: string | undefined;
  secrets?: Array<SigningSecret> | undefined;
  now?: Date | undefined;
}) => SignatureVerification = (data: {
  headers: Dictionary<string>;
  body?: string | undefined;
  secrets?: Array<SigningSecret> | undefined;
  now?: Date | undefined;
}): SignatureVerification => {
  return IncomingRequestSignature.verify({
    signatures: IncomingRequestSignature.readPresentedSignatures(data.headers),
    body: Buffer.from(data.body ?? BODY, "utf8"),
    secrets: data.secrets || [OTHER_SECRET, SECRET],
    now: data.now || NOW,
  });
};

const ALL_SCHEMES: Array<IncomingRequestSignatureScheme> = Object.values(
  IncomingRequestSignatureScheme,
);

const TIMED_SCHEMES: Array<IncomingRequestSignatureScheme> = [
  IncomingRequestSignatureScheme.OneUptime,
  IncomingRequestSignatureScheme.Slack,
  IncomingRequestSignatureScheme.Stripe,
];

describe("the signatures OneUptime checks", () => {
  test("are OneUptime's own, GitHub's, Slack's and Stripe's, in their own headers", () => {
    expect(
      INCOMING_REQUEST_SIGNATURE_FORMATS.map(
        (format: { header: string }): string => {
          return format.header;
        },
      ),
    ).toEqual([
      INCOMING_REQUEST_SIGNATURE_HEADER,
      "X-Hub-Signature-256",
      "X-Slack-Signature",
      "Stripe-Signature",
    ]);
    expect(INCOMING_REQUEST_SIGNATURE_HEADER).toBe("X-OneUptime-Signature");
  });

  test("a signature with a time is accepted within five minutes of the clock; GitHub's, which has none, is remembered for a day", () => {
    expect(INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
    expect(INCOMING_REQUEST_UNTIMED_SIGNATURE_MEMORY_SECONDS).toBe(86400);
    expect(
      IncomingRequestSignature.formatOf(IncomingRequestSignatureScheme.GitHub)
        .hasTimestamp,
    ).toBe(false);
  });
});

describe("the services' own examples", () => {
  /*
   * GitHub's documented test values: "Validating webhook deliveries",
   * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
   */
  test("GitHub's", () => {
    expect(
      IncomingRequestSignature.sign({
        scheme: IncomingRequestSignatureScheme.GitHub,
        secret: "It's a Secret to Everybody",
        body: "Hello, World!",
      }),
    ).toBe(
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    );
  });

  /*
   * Slack's documented example: "Verifying requests from Slack",
   * https://api.slack.com/authentication/verifying-requests-from-slack
   */
  test("Slack's", () => {
    const body: string =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";

    expect(
      IncomingRequestSignature.sign({
        scheme: IncomingRequestSignatureScheme.Slack,
        secret: "8f742231b10e8888abcd99yyyzzz85a5",
        body,
        timestampSeconds: 1531420618,
      }),
    ).toBe(
      "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
    );
  });
});

describe("verify", () => {
  test.each(ALL_SCHEMES)(
    "a %s signature made with one of the secrets names that secret",
    (scheme: IncomingRequestSignatureScheme) => {
      const verification: SignatureVerification = verify({
        headers: signedHeaders({ scheme }),
      });

      expect(verification.matchedSecretId).toBe(SECRET.secretId);
      expect(verification.problem).toBeUndefined();
      expect(verification.wrongDigests).toEqual([]);
      expect(verification.matchedSignature).toEqual(
        expect.objectContaining({
          scheme,
          hasTimestamp: scheme !== IncomingRequestSignatureScheme.GitHub,
        }),
      );
    },
  );

  test.each(ALL_SCHEMES)(
    "a %s signature made with a wrong secret matches nothing, and is a wrong guess",
    (scheme: IncomingRequestSignatureScheme) => {
      const headers: Dictionary<string> = signedHeaders({
        scheme,
        secret: "a-secret-that-is-not-the-projects",
      });

      const verification: SignatureVerification = verify({ headers });

      expect(verification.matchedSecretId).toBeUndefined();
      expect(verification.problem).toBe(SignatureProblem.NoMatch);
      expect(verification.wrongDigests).toHaveLength(1);
    },
  );

  test.each(ALL_SCHEMES)(
    "a %s signature of a body changed on the way matches nothing",
    (scheme: IncomingRequestSignatureScheme) => {
      const verification: SignatureVerification = verify({
        headers: signedHeaders({ scheme }),
        body: '{"status":"down","version":"1.2.3"}',
      });

      expect(verification.matchedSecretId).toBeUndefined();
      expect(verification.problem).toBe(SignatureProblem.NoMatch);
    },
  );

  test.each(TIMED_SCHEMES)(
    "a %s signature more than five minutes old, or ahead, is refused as expired, and nothing is checked",
    (scheme: IncomingRequestSignatureScheme) => {
      for (const offset of [
        -(INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS + 1),
        INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS + 1,
        -86400,
      ]) {
        const verification: SignatureVerification = verify({
          headers: signedHeaders({
            scheme,
            timestampSeconds: NOW_SECONDS + offset,
          }),
        });

        expect({ offset, matched: verification.matchedSecretId }).toEqual({
          offset,
          matched: undefined,
        });
        expect(verification.problem).toBe(SignatureProblem.Expired);
        // Not checked: not a guess either.
        expect(verification.wrongDigests).toEqual([]);
      }
    },
  );

  test.each(TIMED_SCHEMES)(
    "a %s signature exactly five minutes from the clock is still accepted",
    (scheme: IncomingRequestSignatureScheme) => {
      for (const offset of [
        -INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS,
        INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS,
      ]) {
        expect(
          verify({
            headers: signedHeaders({
              scheme,
              timestampSeconds: NOW_SECONDS + offset,
            }),
          }).matchedSecretId,
        ).toBe(SECRET.secretId);
      }
    },
  );

  test("a time changed after signing matches nothing: the time is signed too", () => {
    for (const scheme of [
      IncomingRequestSignatureScheme.OneUptime,
      IncomingRequestSignatureScheme.Stripe,
    ]) {
      const headers: Dictionary<string> = signedHeaders({ scheme });
      const name: string = headerOf(scheme).toLowerCase();

      headers[name] = headers[name]!.replace(
        `t=${NOW_SECONDS}`,
        `t=${NOW_SECONDS + 1}`,
      );

      expect(verify({ headers }).problem).toBe(SignatureProblem.NoMatch);
    }

    const slack: Dictionary<string> = signedHeaders({
      scheme: IncomingRequestSignatureScheme.Slack,
    });

    slack["x-slack-request-timestamp"] = String(NOW_SECONDS + 1);

    expect(verify({ headers: slack }).problem).toBe(SignatureProblem.NoMatch);
  });

  test("a GitHub signature has no time, so an old delivery is checked as any other", () => {
    expect(
      verify({
        headers: signedHeaders({
          scheme: IncomingRequestSignatureScheme.GitHub,
        }),
        now: new Date("2030-01-01T00:00:00.000Z"),
      }).matchedSecretId,
    ).toBe(SECRET.secretId);
  });

  test("a Stripe signature for each of two secrets is accepted with the one the project has", () => {
    const old: string = IncomingRequestSignature.sign({
      scheme: IncomingRequestSignatureScheme.Stripe,
      secret: "whsec_a-secret-the-project-deleted",
      body: BODY,
      timestampSeconds: NOW_SECONDS,
    });

    const current: string = IncomingRequestSignature.sign({
      scheme: IncomingRequestSignatureScheme.Stripe,
      secret: OTHER_SECRET.value,
      body: BODY,
      timestampSeconds: NOW_SECONDS,
    });

    const verification: SignatureVerification = verify({
      headers: {
        "stripe-signature": `${old},${current.replace(`t=${NOW_SECONDS},`, "")}`,
      },
    });

    expect(verification.matchedSecretId).toBe(OTHER_SECRET.secretId);
  });

  test("a body-less request is signed over nothing", () => {
    const headers: Dictionary<string> = signedHeaders({
      scheme: IncomingRequestSignatureScheme.OneUptime,
      body: "",
    });

    expect(verify({ headers, body: "" }).matchedSecretId).toBe(SECRET.secretId);
    expect(verify({ headers, body: "{}" }).problem).toBe(
      SignatureProblem.NoMatch,
    );
  });

  test("with no secret to check against, every signature is wrong", () => {
    expect(
      verify({
        headers: signedHeaders({
          scheme: IncomingRequestSignatureScheme.OneUptime,
        }),
        secrets: [],
      }).problem,
    ).toBe(SignatureProblem.NoMatch);
  });

  test("a request with no signature has nothing to say", () => {
    expect(
      IncomingRequestSignature.verify({
        signatures: [],
        body: Buffer.from(BODY),
        secrets: [SECRET],
        now: NOW,
      }),
    ).toEqual({ wrongDigests: [] });
  });
});

describe("readPresentedSignatures", () => {
  test("reads each scheme's header, whatever its case, and a header a proxy repeated", () => {
    const signatures: Array<PresentedSignature> =
      IncomingRequestSignature.readPresentedSignatures({
        "X-ONEUPTIME-SIGNATURE": `t=${NOW_SECONDS},v1=${"a".repeat(64)}`,
        "x-hub-signature-256": [`sha256=${"B".repeat(64)}`],
      });

    expect(signatures).toEqual([
      {
        scheme: IncomingRequestSignatureScheme.OneUptime,
        timestampSeconds: NOW_SECONDS,
        digests: ["a".repeat(64)],
      },
      {
        scheme: IncomingRequestSignatureScheme.GitHub,
        digests: ["b".repeat(64)],
      },
    ]);
  });

  test.each([
    ["a SHA-1 signature", { "x-hub-signature-256": `sha1=${"a".repeat(40)}` }],
    ["a short digest", { "x-hub-signature-256": `sha256=${"a".repeat(63)}` }],
    [
      "a digest that is not hex",
      { "x-hub-signature-256": `sha256=${"g".repeat(64)}` },
    ],
    [
      "GitHub's header joined with another",
      {
        "x-hub-signature-256": `sha256=${"a".repeat(64)}, sha256=${"b".repeat(64)}`,
      },
    ],
    [
      "Slack's signature without its time",
      { "x-slack-signature": `v0=${"a".repeat(64)}` },
    ],
    [
      "Slack's signature with a time that is not one",
      {
        "x-slack-signature": `v0=${"a".repeat(64)}`,
        "x-slack-request-timestamp": "yesterday",
      },
    ],
    [
      "OneUptime's signature without a time",
      { "x-oneuptime-signature": `v1=${"a".repeat(64)}` },
    ],
    [
      "OneUptime's signature without a digest",
      { "x-oneuptime-signature": `t=${NOW_SECONDS}` },
    ],
    [
      "OneUptime's signature with two times",
      {
        "x-oneuptime-signature": `t=${NOW_SECONDS},t=${NOW_SECONDS},v1=${"a".repeat(64)}`,
      },
    ],
    [
      "OneUptime's signature with a broken part",
      {
        "x-oneuptime-signature": `t=${NOW_SECONDS},v1=${"a".repeat(64)},nonsense`,
      },
    ],
    [
      "Stripe's test-mode signature alone",
      { "stripe-signature": `t=${NOW_SECONDS},v0=${"a".repeat(64)}` },
    ],
    ["an empty header", { "x-oneuptime-signature": "" }],
  ])(
    "reads no signature from %s",
    (_name: string, headers: Dictionary<string>) => {
      expect(IncomingRequestSignature.readPresentedSignatures(headers)).toEqual(
        [],
      );
    },
  );

  test("keeps at most a few signatures from one header, each once", () => {
    const digests: Array<string> = [];

    for (let index: number = 0; index < 20; index++) {
      digests.push(`v1=${index.toString(16).padStart(64, "0")}`);
    }

    const signatures: Array<PresentedSignature> =
      IncomingRequestSignature.readPresentedSignatures({
        "x-oneuptime-signature": [
          `t=${NOW_SECONDS}`,
          `v1=${"a".repeat(64)}`,
          `v1=${"A".repeat(64)}`,
          ...digests,
        ].join(","),
      });

    expect(signatures).toHaveLength(1);
    expect(signatures[0]!.digests).toHaveLength(MAX_DIGESTS_PER_SIGNATURE);
    expect(new Set(signatures[0]!.digests).size).toBe(
      MAX_DIGESTS_PER_SIGNATURE,
    );
  });
});

describe("rememberAccepted", () => {
  let kept: Map<string, number>;
  let fails: boolean;

  beforeEach(() => {
    kept = new Map<string, number>();
    fails = false;

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          _value: string,
          options?: { expiresInSeconds?: number | undefined },
        ) => {
          if (fails) {
            throw new Error("Redis is down");
          }

          const name: string = `${namespace}-${key}`;

          if (kept.has(name)) {
            return false;
          }

          kept.set(name, options?.expiresInSeconds || 0);
          return true;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts a signature once: the same request sent again is a replay", async () => {
    const signature: {
      scheme: IncomingRequestSignatureScheme;
      digest: string;
      hasTimestamp: boolean;
    } = {
      scheme: IncomingRequestSignatureScheme.OneUptime,
      digest: "a".repeat(64),
      hasTimestamp: true,
    };

    expect(await IncomingRequestSignature.rememberAccepted(signature)).toBe(
      true,
    );
    expect(await IncomingRequestSignature.rememberAccepted(signature)).toBe(
      false,
    );
    expect(
      await IncomingRequestSignature.rememberAccepted({
        ...signature,
        digest: "A".repeat(64),
      }),
    ).toBe(false);

    // Another signature is its own.
    expect(
      await IncomingRequestSignature.rememberAccepted({
        ...signature,
        digest: "b".repeat(64),
      }),
    ).toBe(true);
  });

  test("remembers a timed signature for as long as it could be accepted again, an untimed one for a day", async () => {
    await IncomingRequestSignature.rememberAccepted({
      scheme: IncomingRequestSignatureScheme.Slack,
      digest: "c".repeat(64),
      hasTimestamp: true,
    });
    await IncomingRequestSignature.rememberAccepted({
      scheme: IncomingRequestSignatureScheme.GitHub,
      digest: "d".repeat(64),
      hasTimestamp: false,
    });

    expect(Array.from(kept.values())).toEqual([
      INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS * 2,
      INCOMING_REQUEST_UNTIMED_SIGNATURE_MEMORY_SECONDS,
    ]);

    // A hash of the signature is kept, never the signature.
    for (const name of kept.keys()) {
      expect(name).not.toContain("c".repeat(64));
      expect(name).not.toContain("d".repeat(64));
    }
  });

  test("a Redis that fails remembers nothing, and the request is accepted", async () => {
    fails = true;

    expect(
      await IncomingRequestSignature.rememberAccepted({
        scheme: IncomingRequestSignatureScheme.OneUptime,
        digest: "e".repeat(64),
        hasTimestamp: true,
      }),
    ).toBe(true);
  });
});

describe("withoutSignatures", () => {
  test("takes OneUptime's own off, masks a service's, and leaves the rest", () => {
    expect(
      IncomingRequestSignature.withoutSignatures({
        "X-OneUptime-Signature": `t=${NOW_SECONDS},v1=${"a".repeat(64)}`,
        "x-hub-signature-256": `sha256=${"b".repeat(64)}`,
        "X-Hub-Signature": `sha1=${"c".repeat(40)}`,
        "x-slack-signature": `v0=${"d".repeat(64)}`,
        "stripe-signature": `t=${NOW_SECONDS},v1=${"e".repeat(64)}`,
        "x-slack-request-timestamp": String(NOW_SECONDS),
        "x-github-event": "push",
        "content-type": "application/json",
      }),
    ).toEqual({
      "x-hub-signature-256": REDACTED,
      "X-Hub-Signature": REDACTED,
      "x-slack-signature": REDACTED,
      "stripe-signature": REDACTED,
      "x-slack-request-timestamp": String(NOW_SECONDS),
      "x-github-event": "push",
      "content-type": "application/json",
    });
  });
});

describe("getSignedBody", () => {
  test("is the bytes as they came, wherever a parser kept them", () => {
    const bytes: Buffer = Buffer.from("café", "latin1");

    expect(
      IncomingRequestSignature.getSignedBody({
        rawBodyBytes: bytes,
        rawBody: "something else",
        body: { parsed: true },
      }),
    ).toBe(bytes);

    const inflated: Buffer = Buffer.from(BODY);

    expect(IncomingRequestSignature.getSignedBody({ body: inflated })).toBe(
      inflated,
    );

    expect(
      IncomingRequestSignature.getSignedBody({
        rawBody: BODY,
        body: JSON.parse(BODY),
      }).toString("utf8"),
    ).toBe(BODY);

    expect(IncomingRequestSignature.getSignedBody({ body: {} }).length).toBe(0);
  });
});
