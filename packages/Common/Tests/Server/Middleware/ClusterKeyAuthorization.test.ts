import {
  ClusterKeyConfiguration,
  OPERATOR_CLUSTER_KEYS,
  SHIPPED_CLUSTER_KEYS,
  readExampleEnvPlaceholders,
  restoreClusterKey,
  setClusterKey,
} from "../TestingUtils/ShippedClusterKeys";
import {
  OPERATOR_ENCRYPTION_SECRET,
  restoreEncryptionSecret,
  setEncryptionSecret,
} from "../TestingUtils/ShippedEncryptionSecrets";
import type ClusterKeyAuthorizationType from "../../../Server/Middleware/ClusterKeyAuthorization";
import type TokenSigningKeyType from "../../../Server/Utils/TokenSigningKey";
import { JSONObject } from "../../../Types/JSON";
import { afterAll, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import type { Mock } from "jest-mock";

/*
 * Which cluster key an installation's services present to each other, and
 * which keys the routes that take one accept.
 *
 * Those routes send an email, an SMS, a call or a message with the
 * installation's own accounts, run workflows and write telemetry for any
 * project. Only OneUptime's own services may ask for that, and a value this
 * repository ships is never their key.
 *
 * Each installation below is a fresh module registry: EnvironmentConfig reads
 * the ONEUPTIME_SECRET it names, and the real middleware runs on requests
 * carrying a key in every place a request can carry one. The rule:
 *
 *   - every route is handed the one check, isAuthorizedServiceMiddleware: no
 *     Runner registers with the cluster key any more;
 *   - the key is taken from a request header (clusterkey, or x-clusterkey
 *     as KEDA sends it) and nowhere else: a request whose URL names the key
 *     is refused whatever else it carries, and a key in the body is not
 *     read;
 *   - a value this repository ships is refused, from any caller, as it is
 *     or URI-encoded, whatever the installation's own key;
 *   - an installation that kept such a value presents a key of its own,
 *     derived from its token signing key, which every app and worker process
 *     loads at boot, so its services keep calling each other - and only
 *     processes holding the same installation key accept each other;
 *   - an installation whose operator set ONEUPTIME_SECRET presents and
 *     accepts exactly that, byte for byte, as before.
 */

jest.mock("../../../Server/Utils/Logger");

type ClusterKeyAuthorizationClass = typeof ClusterKeyAuthorizationType;
type TokenSigningKeyClass = typeof TokenSigningKeyType;

interface Installation {
  configured: string | undefined;
  ClusterKeyAuthorization: ClusterKeyAuthorizationClass;
  TokenSigningKey: TokenSigningKeyClass;
  label: string;
  messages: {
    notFound: string;
    invalid: string;
    shipped: string;
    inUrl: string;
  };
  config: {
    IsClusterKeyShipped: boolean;
    ClusterKeyWarning: string | null;
    isShippedSecretValue: (value: string | null | undefined) => boolean;
  };
}

// Two installations' own token signing keys, as InstanceTokenSigningKey holds.
const INSTALLATION_KEY: string = "a".repeat(32) + "0123456789abcdef".repeat(2);
const OTHER_INSTALLATION_KEY: string =
  "fedcba9876543210".repeat(2) + "b".repeat(32);

/*
 * A fresh installation (one process of it) configured with this
 * ONEUPTIME_SECRET. ENCRYPTION_SECRET is a shipped value unless given, so the
 * token signing key is the installation's own - as InstanceTokenSigningKey
 * hands it to every app and worker process at boot - when one is given.
 */
function loadInstallation(
  configured: string | undefined,
  options: {
    installationKey?: string | undefined;
    encryptionSecret?: string | undefined;
  } = {},
): Installation {
  setClusterKey(configured);
  setEncryptionSecret(options.encryptionSecret ?? "secret");

  let loaded: Installation | null = null;

  try {
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const TokenSigningKey: TokenSigningKeyClass =
        require("../../../Server/Utils/TokenSigningKey").default;
      const middlewareModule: JSONObject = require("../../../Server/Middleware/ClusterKeyAuthorization");
      const config: Installation["config"] = require("../../../Server/EnvironmentConfig");
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

      if (options.installationKey) {
        TokenSigningKey.useInstallationKey(options.installationKey);
      }

      loaded = {
        configured: configured,
        label: String(configured),
        ClusterKeyAuthorization: middlewareModule[
          "default"
        ] as unknown as ClusterKeyAuthorizationClass,
        TokenSigningKey: TokenSigningKey,
        messages: {
          notFound: middlewareModule["CLUSTER_KEY_NOT_FOUND_MESSAGE"] as string,
          invalid: middlewareModule["INVALID_CLUSTER_KEY_MESSAGE"] as string,
          shipped: middlewareModule["SHIPPED_CLUSTER_KEY_MESSAGE"] as string,
          inUrl: middlewareModule["CLUSTER_KEY_IN_URL_MESSAGE"] as string,
        },
        config: config,
      };
    });
  } finally {
    restoreClusterKey();
    restoreEncryptionSecret();
  }

  return loaded!;
}

afterAll(() => {
  restoreClusterKey();
  restoreEncryptionSecret();
});

// The places a request can carry the key.
type Channel = "params" | "query" | "header" | "prefixed header" | "body";

const CHANNELS: Array<Channel> = [
  "params",
  "query",
  "header",
  "prefixed header",
  "body",
];

// Where the key is taken from: a request header.
const HEADER_CHANNELS: Array<Channel> = ["header", "prefixed header"];

// Where a request's URL carries it: refused, whatever it is.
const URL_CHANNELS: Array<Channel> = ["query", "params"];

// The checks: one, every route's. The Runner's registration has none of its own.
type Check = "isAuthorizedServiceMiddleware";

const CHECKS: Array<Check> = ["isAuthorizedServiceMiddleware"];

// A request as the middleware reads it: any value in any place.
type FakeRequest = Record<string, Record<string, unknown>>;

function requestWith(channel: Channel, key: unknown): FakeRequest {
  switch (channel) {
    case "params":
      return { params: { clusterKey: key }, headers: {} };
    case "query":
      return { query: { clusterKey: key }, headers: {} };
    case "header":
      return { headers: { clusterkey: key } };
    case "prefixed header":
      return { headers: { "x-clusterkey": key } };
    case "body":
      return { body: { clusterKey: key }, headers: {} };
  }
}

interface Outcome {
  passed: boolean;
  status: number | null;
  message: string | null;
}

async function present(
  installation: Installation,
  request: FakeRequest,
  check: Check = "isAuthorizedServiceMiddleware",
): Promise<Outcome> {
  const next: Mock<() => void> = jest.fn();
  const status: Mock<(code: number) => unknown> = jest.fn();
  const send: Mock<(body: JSONObject) => unknown> = jest.fn();
  const res: JSONObject = {};

  status.mockImplementation(() => {
    return res;
  });
  res["status"] = status as unknown as JSONObject;
  res["send"] = send as unknown as JSONObject;

  await installation.ClusterKeyAuthorization[check](
    request as never,
    res as never,
    next,
  );

  const sent: JSONObject | undefined = send.mock.calls[0]?.[0];

  return {
    passed: next.mock.calls.length === 1,
    status: (status.mock.calls[0]?.[0] as number | undefined) ?? null,
    message: (sent?.["message"] as string | undefined) ?? null,
  };
}

// The key derived for the cluster from a token signing key, recomputed here.
function derivedClusterKey(signingKey: string): string {
  return crypto
    .createHmac("sha256", signingKey)
    .update("oneuptime-installation-cluster-key")
    .digest("hex");
}

/*
 * The values everybody knows: every shipped value, as it is, trimmed,
 * and URI-encoded the way a service sends a key.
 */
function shippedValuesAStrangerWouldTry(): Array<string> {
  const values: Set<string> = new Set<string>(["secret"]);

  for (const configuration of SHIPPED_CLUSTER_KEYS) {
    if (configuration.value && configuration.value.trim()) {
      values.add(configuration.value);
      values.add(configuration.value.trim());
      values.add(encodeURIComponent(configuration.value));
    }
  }

  for (const placeholder of readExampleEnvPlaceholders()) {
    values.add(placeholder);
  }

  return Array.from(values);
}

describe.each(SHIPPED_CLUSTER_KEYS)(
  "an installation whose ONEUPTIME_SECRET is $label",
  (configuration: ClusterKeyConfiguration) => {
    const installation: Installation = loadInstallation(configuration.value, {
      installationKey: INSTALLATION_KEY,
    });

    test("knows its cluster key is one this repository ships", () => {
      expect(installation.config.IsClusterKeyShipped).toBe(true);
      expect(
        installation.ClusterKeyAuthorization.isConfiguredClusterKeyShipped(),
      ).toBe(true);
      expect(installation.config.ClusterKeyWarning).toContain(
        "ONEUPTIME_SECRET is unset or still a value shipped",
      );
    });

    test("presents a key derived from its own token signing key, never the configured value", () => {
      const key: string =
        installation.ClusterKeyAuthorization.getInstallationClusterKey();

      expect(key).toBe(derivedClusterKey(INSTALLATION_KEY));
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toBe(configuration.value);
      expect(installation.ClusterKeyAuthorization.getClusterKey()).toBe(key);
      expect(
        installation.ClusterKeyAuthorization.getClusterKeyHeaders(),
      ).toStrictEqual({ clusterkey: key });
    });

    test("the key is not the token signing key itself", () => {
      expect(
        installation.ClusterKeyAuthorization.getInstallationClusterKey(),
      ).not.toBe(installation.TokenSigningKey.get());
    });

    describe.each(HEADER_CHANNELS)(
      "a request carrying the key in its %s",
      (channel: Channel) => {
        test.each(CHECKS)(
          "is refused with every shipped value (%s)",
          async (check: Check) => {
            for (const value of shippedValuesAStrangerWouldTry()) {
              const outcome: Outcome = await present(
                installation,
                requestWith(channel, value),
                check,
              );

              expect({ value, ...outcome }).toStrictEqual({
                value,
                passed: false,
                status: 400,
                message: installation.messages.shipped,
              });
            }
          },
        );

        test.each(CHECKS)(
          "is let through with the installation's own key (%s)",
          async (check: Check) => {
            const outcome: Outcome = await present(
              installation,
              requestWith(
                channel,
                installation.ClusterKeyAuthorization.getClusterKey(),
              ),
              check,
            );

            expect(outcome).toStrictEqual({
              passed: true,
              status: null,
              message: null,
            });
          },
        );

        test.each(CHECKS)(
          "is refused with another installation's key (%s)",
          async (check: Check) => {
            const outcome: Outcome = await present(
              installation,
              requestWith(channel, derivedClusterKey(OTHER_INSTALLATION_KEY)),
              check,
            );

            expect(outcome).toStrictEqual({
              passed: false,
              status: 400,
              message: installation.messages.invalid,
            });
          },
        );
      },
    );

    describe.each(URL_CHANNELS)(
      "a request carrying the key in its URL (%s)",
      (channel: Channel) => {
        test.each(CHECKS)(
          "is refused, the installation's own key and every shipped value alike (%s)",
          async (check: Check) => {
            for (const value of [
              installation.ClusterKeyAuthorization.getClusterKey(),
              ...shippedValuesAStrangerWouldTry(),
            ]) {
              const outcome: Outcome = await present(
                installation,
                requestWith(channel, value),
                check,
              );

              expect({ value, ...outcome }).toStrictEqual({
                value,
                passed: false,
                status: 400,
                message: installation.messages.inUrl,
              });
            }
          },
        );
      },
    );

    describe("a request carrying the key in its body", () => {
      test("is not read by the routes that take the key", async () => {
        for (const value of [
          installation.ClusterKeyAuthorization.getClusterKey(),
          ...shippedValuesAStrangerWouldTry(),
        ]) {
          const outcome: Outcome = await present(
            installation,
            requestWith("body", value),
          );

          expect({ value, ...outcome }).toStrictEqual({
            value,
            passed: false,
            status: 400,
            message: installation.messages.notFound,
          });
        }
      });
    });
  },
);

describe.each(OPERATOR_CLUSTER_KEYS)(
  "an installation whose operator set ONEUPTIME_SECRET to $label",
  (configuration: ClusterKeyConfiguration) => {
    const installation: Installation = loadInstallation(configuration.value, {
      installationKey: INSTALLATION_KEY,
    });
    const operatorKey: string = configuration.value!;

    test("presents and accepts exactly the operator's key, as earlier releases did", () => {
      expect(installation.config.IsClusterKeyShipped).toBe(false);
      expect(installation.config.ClusterKeyWarning).toBeNull();
      expect(
        installation.ClusterKeyAuthorization.getInstallationClusterKey(),
      ).toBe(operatorKey);
      expect(installation.ClusterKeyAuthorization.getClusterKey()).toBe(
        encodeURIComponent(operatorKey),
      );
      expect(
        installation.ClusterKeyAuthorization.getClusterKeyHeaders(),
      ).toStrictEqual({ clusterkey: encodeURIComponent(operatorKey) });
    });

    test("does not take the operator's key from a body", async () => {
      expect(
        await present(
          installation,
          requestWith("body", encodeURIComponent(operatorKey)),
        ),
      ).toStrictEqual({
        passed: false,
        status: 400,
        message: installation.messages.notFound,
      });
    });

    test.each(URL_CHANNELS)(
      "refuses the operator's key in a URL (%s), for every check",
      async (channel: Channel) => {
        for (const check of CHECKS) {
          expect(
            await present(
              installation,
              requestWith(channel, encodeURIComponent(operatorKey)),
              check,
            ),
          ).toStrictEqual({
            passed: false,
            status: 400,
            message: installation.messages.inUrl,
          });
        }
      },
    );

    describe.each(HEADER_CHANNELS)(
      "a request carrying the key in its %s",
      (channel: Channel) => {
        test("is let through with the operator's key as services send it", async () => {
          for (const check of CHECKS) {
            const outcome: Outcome = await present(
              installation,
              requestWith(channel, encodeURIComponent(operatorKey)),
              check,
            );

            expect(outcome.passed).toBe(true);
          }
        });

        test("is refused with every shipped value", async () => {
          for (const value of shippedValuesAStrangerWouldTry()) {
            const outcome: Outcome = await present(
              installation,
              requestWith(channel, value),
            );

            expect({ value, ...outcome }).toStrictEqual({
              value,
              passed: false,
              status: 400,
              message: installation.messages.shipped,
            });
          }
        });

        test("is refused with the key an installation that kept a shipped value derives", async () => {
          const outcome: Outcome = await present(
            installation,
            requestWith(channel, derivedClusterKey(INSTALLATION_KEY)),
          );

          expect(outcome).toStrictEqual({
            passed: false,
            status: 400,
            message: installation.messages.invalid,
          });
        });

        test("is refused with a near miss", async () => {
          for (const nearMiss of [
            encodeURIComponent(operatorKey) + "x",
            encodeURIComponent(operatorKey).slice(0, -1),
            encodeURIComponent(operatorKey).toUpperCase() ===
            encodeURIComponent(operatorKey)
              ? encodeURIComponent(operatorKey).toLowerCase()
              : encodeURIComponent(operatorKey).toUpperCase(),
          ]) {
            if (nearMiss === encodeURIComponent(operatorKey)) {
              continue;
            }

            const outcome: Outcome = await present(
              installation,
              requestWith(channel, nearMiss),
            );

            expect(outcome.passed).toBe(false);
          }
        });
      },
    );
  },
);

describe("the app and worker processes of one installation that kept a shipped value", () => {
  /*
   * InstanceTokenSigningKeyService.loadTokenSigningKey hands every process
   * the same stored key at boot (App/Index.ts), before any route or worker
   * starts. Each process here is its own module registry.
   */
  const api: Installation = loadInstallation(
    "please-change-this-to-random-value",
    { installationKey: INSTALLATION_KEY },
  );
  const worker: Installation = loadInstallation(
    "please-change-this-to-random-value",
    { installationKey: INSTALLATION_KEY },
  );
  const anotherInstallation: Installation = loadInstallation(
    "please-change-this-to-random-value",
    { installationKey: OTHER_INSTALLATION_KEY },
  );
  const notLoaded: Installation = loadInstallation(
    "please-change-this-to-random-value",
  );

  test("present the same key, and accept each other's calls", async () => {
    expect(worker.ClusterKeyAuthorization.getClusterKey()).toBe(
      api.ClusterKeyAuthorization.getClusterKey(),
    );

    for (const [caller, callee] of [
      [worker, api],
      [api, worker],
    ] as Array<[Installation, Installation]>) {
      const outcome: Outcome = await present(callee, {
        headers: caller.ClusterKeyAuthorization.getClusterKeyHeaders(),
      });

      expect(outcome.passed).toBe(true);
    }
  });

  test("refuse a call from another installation that kept the same shipped value", async () => {
    expect(
      anotherInstallation.ClusterKeyAuthorization.getClusterKey(),
    ).not.toBe(api.ClusterKeyAuthorization.getClusterKey());

    const outcome: Outcome = await present(api, {
      headers:
        anotherInstallation.ClusterKeyAuthorization.getClusterKeyHeaders(),
    });

    expect(outcome).toStrictEqual({
      passed: false,
      status: 400,
      message: api.messages.invalid,
    });
  });

  test("refuse a process that never loaded the installation's key (a key only that process holds)", async () => {
    const outcome: Outcome = await present(api, {
      headers: notLoaded.ClusterKeyAuthorization.getClusterKeyHeaders(),
    });

    expect(outcome.passed).toBe(false);
  });

  test("follow the installation's key the moment a process loads it", async () => {
    const process: Installation = loadInstallation(
      "please-change-this-to-random-value",
    );
    const before: string = process.ClusterKeyAuthorization.getClusterKey();

    process.TokenSigningKey.useInstallationKey(INSTALLATION_KEY);

    expect(process.ClusterKeyAuthorization.getClusterKey()).not.toBe(before);
    expect(process.ClusterKeyAuthorization.getClusterKey()).toBe(
      api.ClusterKeyAuthorization.getClusterKey(),
    );
  });
});

describe("an installation that kept a shipped ONEUPTIME_SECRET but set its own ENCRYPTION_SECRET", () => {
  /*
   * Its token signing key is ENCRYPTION_SECRET (TokenSigningKey), so every
   * process derives the same cluster key without reading the database.
   */
  const api: Installation = loadInstallation("secret", {
    encryptionSecret: OPERATOR_ENCRYPTION_SECRET,
  });
  const worker: Installation = loadInstallation(
    "please-change-this-to-random-value",
    { encryptionSecret: OPERATOR_ENCRYPTION_SECRET },
  );

  test("derives its cluster key from that secret, and never presents the secret itself", () => {
    expect(api.ClusterKeyAuthorization.getInstallationClusterKey()).toBe(
      derivedClusterKey(OPERATOR_ENCRYPTION_SECRET),
    );
    expect(api.ClusterKeyAuthorization.getClusterKey()).not.toContain(
      OPERATOR_ENCRYPTION_SECRET,
    );
  });

  test("its processes accept each other's calls", async () => {
    const outcome: Outcome = await present(api, {
      headers: worker.ClusterKeyAuthorization.getClusterKeyHeaders(),
    });

    expect(outcome.passed).toBe(true);
  });

  test("refuses the shipped value", async () => {
    const outcome: Outcome = await present(api, {
      headers: { clusterkey: "secret" },
    });

    expect(outcome.message).toBe(api.messages.shipped);
  });
});

describe("what a request can carry", () => {
  const installation: Installation = loadInstallation(
    OPERATOR_CLUSTER_KEYS[0]!.value,
  );
  const key: string = installation.ClusterKeyAuthorization.getClusterKey();

  test("no key at all is answered as missing", async () => {
    for (const check of CHECKS) {
      for (const request of [
        { headers: {} },
        { params: {}, query: {}, headers: {}, body: {} },
        { headers: { clusterkey: "" } },
        { body: { clusterKey: "" }, headers: {} },
        { body: "clusterKey", headers: {} },
        { body: [key], headers: {} },
      ] as Array<FakeRequest>) {
        const outcome: Outcome = await present(installation, request, check);

        expect({ check, ...outcome }).toStrictEqual({
          check,
          passed: false,
          status: 400,
          message: installation.messages.notFound,
        });
      }
    }
  });

  test("a key that is not a string is refused without throwing", async () => {
    for (const value of [
      [key, key],
      [key],
      { key: key },
      12345,
      true,
    ] as Array<unknown>) {
      for (const channel of CHANNELS) {
        const outcome: Outcome = await present(
          installation,
          requestWith(channel, value),
        );

        // In a body it is no key at all: a body is not read.
        expect({ channel, value, ...outcome }).toStrictEqual({
          channel,
          value,
          passed: false,
          status: 400,
          message: URL_CHANNELS.includes(channel)
            ? installation.messages.inUrl
            : channel === "body"
              ? installation.messages.notFound
              : installation.messages.invalid,
        });
      }
    }
  });

  test("a key that is not valid URI encoding is refused without throwing", async () => {
    for (const value of ["%E0%A4%A", "%", "abc%zz"]) {
      const outcome: Outcome = await present(installation, {
        headers: { clusterkey: value },
      });

      expect(outcome).toStrictEqual({
        passed: false,
        status: 400,
        message: installation.messages.invalid,
      });
    }
  });

  test("a URL that names the key is refused beside the right header, under any spelling of its name", async () => {
    for (const name of [
      "clusterKey",
      "clusterkey",
      "CLUSTERKEY",
      "cluster_key",
      "cluster-key",
      "x-clusterkey",
      "X_ClusterKey",
    ]) {
      for (const part of ["query", "params"]) {
        for (const check of CHECKS) {
          const outcome: Outcome = await present(
            installation,
            { headers: { clusterkey: key }, [part]: { [name]: key } },
            check,
          );

          expect({ name, part, check, ...outcome }).toStrictEqual({
            name,
            part,
            check,
            passed: false,
            status: 400,
            message: installation.messages.inUrl,
          });
        }
      }
    }
  });

  test("a URL's other parameters are its own business", async () => {
    const outcome: Outcome = await present(installation, {
      headers: { clusterkey: key },
      query: { start: "0", end: "100", key: "value", clusters: "a" },
      params: { projectId: "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b" },
    });

    expect(outcome.passed).toBe(true);
  });

  test("the header decides, and a body never stands in for it on a route that takes the key", async () => {
    expect(
      (
        await present(installation, {
          headers: { clusterkey: key },
          body: { clusterKey: "secret" },
        })
      ).passed,
    ).toBe(true);
    expect(
      (
        await present(installation, {
          headers: { clusterkey: "wrong" },
          body: { clusterKey: key },
        })
      ).passed,
    ).toBe(false);
    expect(
      (
        await present(installation, {
          headers: {},
          body: { clusterKey: key },
        })
      ).message,
    ).toBe(installation.messages.notFound);
  });
});

describe("ClusterKeyAuthorization's checks", () => {
  const installation: Installation = loadInstallation(
    OPERATOR_CLUSTER_KEYS[0]!.value,
  );

  test("are the one every route is handed: the Runner's registration has none of its own", () => {
    expect(
      Object.getOwnPropertyNames(installation.ClusterKeyAuthorization).filter(
        (name: string): boolean => {
          return name.startsWith("isAuthorized");
        },
      ),
    ).toStrictEqual(CHECKS);
  });
});

describe("carriesClusterKeyInUrl", () => {
  const installation: Installation = loadInstallation(
    OPERATOR_CLUSTER_KEYS[0]!.value,
  );

  test("finds the key's name in the query string or a path parameter, any spelling", () => {
    for (const request of [
      { query: { clusterKey: "x" } },
      { query: { "x-clusterkey": "x" } },
      { query: { Cluster_Key: ["x", "y"] } },
      { params: { clusterKey: "x" } },
      { query: { a: "1", clusterkey: "" } },
    ]) {
      expect(
        installation.ClusterKeyAuthorization.carriesClusterKeyInUrl(
          request as never,
        ),
      ).toBe(true);
    }
  });

  test("finds nothing in a URL that does not name it, or a request with no URL parts", () => {
    for (const request of [
      {},
      { query: {}, params: {} },
      { query: { key: "x", cluster: "y", clusterKeys: "z" } },
      { params: { workflowId: "x", projectId: "y" } },
      { query: null, params: undefined },
    ]) {
      expect(
        installation.ClusterKeyAuthorization.carriesClusterKeyInUrl(
          request as never,
        ),
      ).toBe(false);
    }
  });
});

describe("withoutClusterKeyHeaders", () => {
  const installation: Installation = loadInstallation(
    OPERATOR_CLUSTER_KEYS[0]!.value,
  );

  test("keeps every header but the two the key travels in, whatever their case", () => {
    expect(
      installation.ClusterKeyAuthorization.withoutClusterKeyHeaders({
        clusterkey: "a",
        "x-clusterkey": "b",
        ClusterKey: "c",
        "X-ClusterKey": "d",
        "content-type": "application/json",
        authorization: "Bearer the-callers-own",
        "x-forwarded-for": ["10.0.0.1", "10.0.0.2"],
        "cluster-key": "a header of the caller's own",
      }),
    ).toStrictEqual({
      "content-type": "application/json",
      authorization: "Bearer the-callers-own",
      "x-forwarded-for": ["10.0.0.1", "10.0.0.2"],
      "cluster-key": "a header of the caller's own",
    });
  });

  test("hands back a copy, and an empty one for no headers", () => {
    const headers: Record<string, string> = {
      clusterkey: "a",
      accept: "*/*",
    };

    expect(
      installation.ClusterKeyAuthorization.withoutClusterKeyHeaders(headers),
    ).toStrictEqual({ accept: "*/*" });
    expect(headers).toStrictEqual({ clusterkey: "a", accept: "*/*" });
    expect(
      installation.ClusterKeyAuthorization.withoutClusterKeyHeaders(undefined),
    ).toStrictEqual({});
    expect(
      installation.ClusterKeyAuthorization.withoutClusterKeyHeaders(null),
    ).toStrictEqual({});
  });
});

describe("isAcceptedClusterKey", () => {
  test("never accepts a shipped value, even if an installation's own key were one", () => {
    const installation: Installation = loadInstallation("secret", {
      installationKey: INSTALLATION_KEY,
    });

    jest
      .spyOn(installation.ClusterKeyAuthorization, "getClusterKey")
      .mockReturnValue("please-change-this-to-random-value");

    expect(
      installation.ClusterKeyAuthorization.isAcceptedClusterKey(
        "please-change-this-to-random-value",
      ),
    ).toBe(false);
  });

  test("compares in constant time over digests, so keys of any length are compared without throwing", () => {
    const installation: Installation = loadInstallation(
      OPERATOR_CLUSTER_KEYS[0]!.value,
    );

    for (const presented of ["a", "k".repeat(5000), "🔑"]) {
      expect(
        installation.ClusterKeyAuthorization.isAcceptedClusterKey(presented),
      ).toBe(false);
    }
  });
});

describe("isShippedSecretValue", () => {
  const installation: Installation = loadInstallation(undefined);

  test.each(SHIPPED_CLUSTER_KEYS)(
    "$label is shipped",
    (configuration: ClusterKeyConfiguration) => {
      expect(
        installation.config.isShippedSecretValue(configuration.value),
      ).toBe(true);
    },
  );

  test.each(readExampleEnvPlaceholders())(
    "config.example.env's %s is shipped",
    (placeholder: string) => {
      expect(installation.config.isShippedSecretValue(placeholder)).toBe(true);
    },
  );

  test.each(OPERATOR_CLUSTER_KEYS)(
    "$label is not",
    (configuration: ClusterKeyConfiguration) => {
      expect(
        installation.config.isShippedSecretValue(configuration.value),
      ).toBe(false);
    },
  );

  test("a null is treated as unset", () => {
    expect(installation.config.isShippedSecretValue(null)).toBe(true);
  });

  test("only the exact values count, case and all", () => {
    for (const value of ["Secret", "SECRET", "PLEASE-CHANGE-THIS", "secret2"]) {
      expect(installation.config.isShippedSecretValue(value)).toBe(false);
    }
  });
});
