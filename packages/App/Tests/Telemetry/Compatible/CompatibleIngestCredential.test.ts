import { describe, expect, test } from "@jest/globals";
import { ExpressRequest } from "Common/Server/Utils/Express";
import CompatibleIngestCredential, {
  CompatibleCredentialScheme,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/CompatibleIngestCredential";

/*
 * The ingestion key, found where each tool's client puts its credential -
 * Bearer, Basic, Splunk, DD-API-KEY, X-Sentry-Auth, ?sentry_key - and
 * passed on as x-oneuptime-token for the shared guard; a key written as 32
 * hex digits without hyphens (Sentry's DSN, Datadog's key format) is put
 * back in UUID form; and an x-oneuptime-token the request carries wins.
 */

const KEY: string = "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11";
const UNDASHED: string = "6b4a1d5c0c5e4a8f9a301f1f2b7d1e11";

const ALL: Array<CompatibleCredentialScheme> = [
  CompatibleCredentialScheme.Bearer,
  CompatibleCredentialScheme.Basic,
  CompatibleCredentialScheme.Splunk,
  CompatibleCredentialScheme.DatadogApiKey,
  CompatibleCredentialScheme.SentryKey,
];

const basic: (credentials: string) => string = (
  credentials: string,
): string => {
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

const keyFrom: (
  headers: Record<string, string>,
  schemes?: Array<CompatibleCredentialScheme>,
  query?: Record<string, unknown>,
) => string | null = (
  headers: Record<string, string>,
  schemes: Array<CompatibleCredentialScheme> = ALL,
  query?: Record<string, unknown>,
): string | null => {
  return CompatibleIngestCredential.fromRequest(
    { headers: headers, query: query },
    schemes,
  );
};

describe("CompatibleIngestCredential.fromRequest", () => {
  test.each<[string, Record<string, string>]>([
    ["Bearer", { authorization: `Bearer ${KEY}` }],
    ["bearer in lower case", { authorization: `bearer ${KEY}` }],
    ["Splunk", { authorization: `Splunk ${KEY}` }],
    [
      "Basic with the key as the password",
      { authorization: basic(`12345:${KEY}`) },
    ],
    ["Basic with any username", { authorization: basic(`oneuptime:${KEY}`) }],
    [
      "Basic with the key as the username and no password",
      { authorization: basic(`${KEY}:`) },
    ],
    ["Basic with only a username", { authorization: basic(KEY) }],
    [
      "Basic with the key pasted into the username field",
      { authorization: basic(`${KEY}:not-a-key`) },
    ],
    ["DD-API-KEY", { "dd-api-key": KEY }],
    [
      "X-Sentry-Auth",
      {
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=sentry.python/2.18.0, sentry_key=${KEY}`,
      },
    ],
    [
      "X-Sentry-Auth without the Sentry prefix and with spaces",
      { "x-sentry-auth": `sentry_key = ${KEY} ,sentry_version=7` },
    ],
  ])("reads %s", (_name: string, headers: Record<string, string>) => {
    expect(keyFrom(headers)).toBe(KEY);
  });

  test("reads ?sentry_key, as browser SDKs send it", () => {
    expect(keyFrom({}, ALL, { sentry_key: KEY, sentry_version: "7" })).toBe(
      KEY,
    );
    expect(keyFrom({}, ALL, { sentry_key: [KEY, "other"] })).toBe(KEY);
  });

  test("puts a key written without hyphens back in UUID form", () => {
    expect(keyFrom({ "dd-api-key": UNDASHED })).toBe(KEY);
    expect(keyFrom({ authorization: `Bearer ${UNDASHED.toUpperCase()}` })).toBe(
      KEY,
    );
    expect(keyFrom({}, ALL, { sentry_key: UNDASHED })).toBe(KEY);
  });

  test("reads only the schemes the endpoint names", () => {
    expect(
      keyFrom({ "dd-api-key": KEY }, [CompatibleCredentialScheme.Bearer]),
    ).toBeNull();
    expect(
      keyFrom({ authorization: `Splunk ${KEY}` }, [
        CompatibleCredentialScheme.Bearer,
      ]),
    ).toBeNull();
    expect(
      keyFrom({}, [CompatibleCredentialScheme.Bearer], { sentry_key: KEY }),
    ).toBeNull();
  });

  test.each<[string, Record<string, string>]>([
    ["no credential", {}],
    ["an empty bearer token", { authorization: "Bearer   " }],
    ["a scheme with no token", { authorization: "Bearer" }],
    ["an empty basic credential", { authorization: basic(":") }],
    [
      "an X-Sentry-Auth with no key",
      { "x-sentry-auth": "Sentry sentry_version=7" },
    ],
    [
      "a key too long to be one",
      { authorization: `Bearer ${"a".repeat(300)}` },
    ],
  ])(
    "finds nothing in %s",
    (_name: string, headers: Record<string, string>) => {
      expect(keyFrom(headers)).toBeNull();
    },
  );

  test("a non-UUID value is passed on as it is, for the guard to refuse", () => {
    expect(keyFrom({ authorization: "Bearer not-a-real-key" })).toBe(
      "not-a-real-key",
    );
  });
});

describe("CompatibleIngestCredential.middleware", () => {
  const run: (
    headers: Record<string, string>,
    schemes: Array<CompatibleCredentialScheme>,
    query?: Record<string, unknown>,
  ) => Record<string, unknown> = (
    headers: Record<string, string>,
    schemes: Array<CompatibleCredentialScheme>,
    query?: Record<string, unknown>,
  ): Record<string, unknown> => {
    const req: ExpressRequest = {
      headers: { ...headers },
      query: query || {},
    } as unknown as ExpressRequest;
    const next: jest.Mock = jest.fn();

    CompatibleIngestCredential.middleware(schemes)(
      req,
      {} as never,
      next as never,
    );

    expect(next).toHaveBeenCalledTimes(1);

    return req.headers as Record<string, unknown>;
  };

  test("passes the key on as x-oneuptime-token", () => {
    expect(
      run({ authorization: `Splunk ${KEY}` }, [
        CompatibleCredentialScheme.Splunk,
      ])["x-oneuptime-token"],
    ).toBe(KEY);
  });

  test("an x-oneuptime-token the request already carries wins", () => {
    const other: string = "11111111-2222-4333-8444-555555555555";

    expect(
      run({ "x-oneuptime-token": other, authorization: `Bearer ${KEY}` }, [
        CompatibleCredentialScheme.Bearer,
      ])["x-oneuptime-token"],
    ).toBe(other);
  });

  test("an x-oneuptime-ingestion-key the request carries wins too, normalized", () => {
    expect(
      run({ "x-oneuptime-ingestion-key": UNDASHED, "dd-api-key": "other" }, [
        CompatibleCredentialScheme.DatadogApiKey,
      ])["x-oneuptime-token"],
    ).toBe(KEY);
  });

  test("with no credential, nothing is set and the guard answers 401", () => {
    expect(
      run({}, [CompatibleCredentialScheme.Bearer])["x-oneuptime-token"],
    ).toBeUndefined();
  });
});

describe("CompatibleIngestCredential.undashedKey", () => {
  test("writes a UUID key as 32 hex digits, for a Sentry DSN or a Datadog key", () => {
    expect(CompatibleIngestCredential.undashedKey(KEY)).toBe(UNDASHED);
    expect(CompatibleIngestCredential.normalizeKey(UNDASHED)).toBe(KEY);
  });

  test("leaves anything else as it is", () => {
    expect(CompatibleIngestCredential.undashedKey("<YOUR_KEY>")).toBe(
      "<YOUR_KEY>",
    );
  });
});
