import FakeCounterRedis from "../../TestingUtils/Redis/FakeCounterRedis";
import WrongComponentKeyLimit, {
  ComponentKeyKind,
  WRONG_AGENT_KEYS_MESSAGE,
  WRONG_COMPONENT_KEY_DIGEST_LABEL,
  WRONG_COMPONENT_KEYS_PER_ADDRESS,
  WRONG_COMPONENT_KEY_WINDOW_SECONDS,
  WRONG_PROBE_KEYS_MESSAGE,
  WRONG_PROBE_REGISTRATION_KEYS_MESSAGE,
} from "../../../../Server/Utils/RateLimit/WrongComponentKeyLimit";
import WrongKeyLimit, {
  WRONG_KEY_COUNT_TIMEOUT_MS,
  WrongKeyRefusal,
} from "../../../../Server/Utils/RateLimit/WrongKeyLimit";
import { getIpv6NetworkRateLimit } from "../../../../Server/Utils/ClientIp";
import Response from "../../../../Server/Utils/Response";
import TokenSigningKey from "../../../../Server/Utils/TokenSigningKey";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import Exception from "../../../../Types/Exception/Exception";
import ExceptionCode from "../../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import type { Mock } from "jest-mock";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * WRONG PROBE, RUNNER AND AI AGENT KEYS ARE COUNTED FOR THE CLIENT THAT
 * SENDS THEM.
 *
 * WrongComponentKeyLimit holds the keys OneUptime's components prove who they
 * are with to the rule the cluster key keeps (WrongKeyLimit), driven here
 * against a Redis that runs the counter's script as Valkey does
 * (FakeCounterRedis; WrongComponentKeyLimitValkey.test.ts runs it on a real
 * Valkey):
 *
 *   - a probe's, a Runner's or an AI agent's key is counted for that one
 *     component: ten different wrong keys for it from one client, then that
 *     client is refused for it, its right key too, until the window ends -
 *     and for nothing else;
 *   - a fleet behind one address, each component holding an old key of its
 *     own, never adds up to a refusal, and a component that keeps sending
 *     one old key is never refused for it;
 *   - a wrong key is counted only for a component there is, only when it is
 *     text the repository does not ship, and only while Valkey is there;
 *   - every spelling of one id is one component;
 *   - REGISTER_PROBE_KEY is counted for the client alone;
 *   - an IPv6 /64 is counted too, with room for ten addresses;
 *   - what Valkey keeps is an HMAC under a key of the installation's own,
 *     never the key;
 *   - a count Valkey does not answer is not waited for past
 *     WRONG_KEY_COUNT_TIMEOUT_MS: the key is compared as always;
 *   - a client over the limit for a component is refused before its key is
 *     looked up (checkBeforeLookup), and asking adds nothing to its count.
 */

const mockRedisState: { client: FakeCounterRedis | null; connected: boolean } =
  { client: null, connected: false };

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedisState.client;
      },
      isConnected: (): boolean => {
        return mockRedisState.connected;
      },
    },
  };
});

const mockWarnings: Array<string> = [];

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: (): void => {},
      info: (): void => {},
      warn: (message: unknown): void => {
        mockWarnings.push(
          message instanceof Error ? message.message : String(message),
        );
      },
      error: (): void => {},
    },
    getLogAttributesFromRequest: (): JSONObject => {
      return {};
    },
  };
});

jest.mock("../../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

const PROBE_A: string = "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const PROBE_B: string = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const RUNNER_A: string = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";

const CLIENT: string = "203.0.113.7";
const OTHER_CLIENT: string = "198.51.100.23";
const NETWORK_PREFIX: string = "2001:db8:51:7";

// The id of the index-th component of a fleet: a real id, the same every run.
function componentIdOf(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function hostOf(index: number): string {
  return `${NETWORK_PREFIX}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:c:d`;
}

// A request as it reaches the app through the bundled Nginx.
function requestFrom(address: string): ExpressRequest {
  return {
    headers: { "x-forwarded-for": address },
    socket: { remoteAddress: "10.0.0.2" },
    query: {},
    params: {},
    body: {},
  } as unknown as ExpressRequest;
}

interface ExistenceCheck {
  check: () => Promise<boolean>;
  asked: () => number;
}

// What a component lookup by id answers, and how often it was asked.
function exists(answer: boolean): ExistenceCheck {
  let asked: number = 0;

  return {
    check: async (): Promise<boolean> => {
      asked++;
      return answer;
    },
    asked: (): number => {
      return asked;
    },
  };
}

async function presentComponentKey(data: {
  from: string;
  kind?: ComponentKeyKind.Probe | ComponentKeyKind.Agent;
  componentId?: string;
  key: unknown;
  isKeyRight: boolean;
  existence?: ExistenceCheck;
}): Promise<WrongKeyRefusal | null> {
  return await WrongComponentKeyLimit.checkComponentKey({
    req: requestFrom(data.from),
    kind: data.kind ?? ComponentKeyKind.Probe,
    componentId: data.componentId ?? PROBE_A,
    presentedKey: data.key,
    isKeyRight: data.isKeyRight,
    componentExists: (data.existence ?? exists(true)).check,
  });
}

async function presentRegistrationKey(data: {
  from: string;
  key: unknown;
  isKeyRight: boolean;
}): Promise<WrongKeyRefusal | null> {
  return await WrongComponentKeyLimit.checkRegistrationKey({
    req: requestFrom(data.from),
    kind: ComponentKeyKind.ProbeRegistration,
    presentedKey: data.key,
    isKeyRight: data.isKeyRight,
  });
}

let redis: FakeCounterRedis;

beforeEach(() => {
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  mockWarnings.length = 0;
});

afterEach(() => {
  redis.reset();
  jest.useRealTimers();
});

describe("a probe's, a Runner's or an AI agent's own key, counted for that one component", () => {
  test.each([
    ["a probe", ComponentKeyKind.Probe as const],
    ["a Runner or an AI agent", ComponentKeyKind.Agent as const],
  ])(
    "ten different wrong keys for %s are let through to be answered as wrong; the next is refused, and so is its right key, from that client alone",
    async (
      _label: string,
      kind: ComponentKeyKind.Probe | ComponentKeyKind.Agent,
    ) => {
      for (
        let index: number = 0;
        index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
        index++
      ) {
        expect(
          await presentComponentKey({
            from: CLIENT,
            kind: kind,
            key: `guess-${index}`,
            isKeyRight: false,
          }),
        ).toBeNull();
      }

      const refused: WrongKeyRefusal | null = await presentComponentKey({
        from: CLIENT,
        kind: kind,
        key: "guess-eleven",
        isKeyRight: false,
      });

      expect(refused).not.toBeNull();
      expect(refused!.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(refused!.retryAfterSeconds).toBeLessThanOrEqual(
        WRONG_COMPONENT_KEY_WINDOW_SECONDS,
      );

      // The right key from that client, for that component: refused too.
      expect(
        await presentComponentKey({
          from: CLIENT,
          kind: kind,
          key: "the-right-key",
          isKeyRight: true,
        }),
      ).not.toBeNull();

      // The right key from another client: let through.
      expect(
        await presentComponentKey({
          from: OTHER_CLIENT,
          kind: kind,
          key: "the-right-key",
          isKeyRight: true,
        }),
      ).toBeNull();

      // Another component, from the same client: let through.
      expect(
        await presentComponentKey({
          from: CLIENT,
          kind: kind,
          componentId: PROBE_B,
          key: "another-guess",
          isKeyRight: false,
        }),
      ).toBeNull();
    },
  );

  test("a probe and a Runner with the same client are counted apart, even under one id", async () => {
    for (
      let index: number = 0;
      index <= WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await presentComponentKey({
        from: CLIENT,
        kind: ComponentKeyKind.Probe,
        key: `probe-guess-${index}`,
        isKeyRight: false,
      });
    }

    expect(
      await presentComponentKey({
        from: CLIENT,
        kind: ComponentKeyKind.Probe,
        key: "probe-guess-0",
        isKeyRight: false,
      }),
    ).not.toBeNull();
    expect(
      await presentComponentKey({
        from: CLIENT,
        kind: ComponentKeyKind.Agent,
        key: "agent-guess",
        isKeyRight: true,
      }),
    ).toBeNull();
  });

  test("a component that keeps sending one old key is never refused for it, and is let through the moment it has the right one", async () => {
    for (let call: number = 0; call < 500; call++) {
      expect(
        await presentComponentKey({
          from: CLIENT,
          key: "the-key-before-the-reset",
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    expect(
      await presentComponentKey({
        from: CLIENT,
        key: "the-key-after-the-reset",
        isKeyRight: true,
      }),
    ).toBeNull();

    // One value is all Valkey holds for it, however many calls.
    const sets: Array<string> = redis.keysHolding("probe-key:wrong-keys:");

    expect(sets).toHaveLength(1);
    expect(redis.membersOf(sets[0]!)).toHaveLength(1);
  });

  test("a fleet behind one address, each component holding an old key of its own, never adds up to a refusal", async () => {
    const fleet: Array<string> = [];

    for (let index: number = 0; index < 60; index++) {
      fleet.push(componentIdOf(index));
    }

    for (let round: number = 0; round < 5; round++) {
      for (const componentId of fleet) {
        expect(
          await presentComponentKey({
            from: CLIENT,
            componentId: componentId,
            key: `old-key-of-${componentId}`,
            isKeyRight: false,
          }),
        ).toBeNull();
      }
    }

    // And the right keys of the healthy ones there pass.
    for (const componentId of fleet.slice(0, 10)) {
      expect(
        await presentComponentKey({
          from: CLIENT,
          componentId: componentId,
          key: "right",
          isKeyRight: true,
        }),
      ).toBeNull();
    }
  });

  test("a right key is never counted, however many requests carry it", async () => {
    for (let call: number = 0; call < 1000; call++) {
      expect(
        await presentComponentKey({
          from: CLIENT,
          key: "the-right-key",
          isKeyRight: true,
        }),
      ).toBeNull();
    }

    expect(redis.sets.size).toBe(0);
    expect(redis.commandsSent("eval")).toHaveLength(1000);
  });

  test("every spelling of one id is one component: case, braces and hyphens buy no new count", async () => {
    const spellings: Array<string> = [
      PROBE_A,
      PROBE_A.toUpperCase(),
      `{${PROBE_A}}`,
      PROBE_A.split("-").join(""),
      ` ${PROBE_A} `,
      `${PROBE_A.slice(0, 4)}-${PROBE_A.slice(4).split("-").join("")}`,
    ];

    let sent: number = 0;

    for (const spelling of spellings) {
      for (let index: number = 0; index < 2; index++) {
        sent++;
        await presentComponentKey({
          from: CLIENT,
          componentId: spelling,
          key: `guess-${sent}`,
          isKeyRight: false,
        });
      }
    }

    // Twelve different wrong keys, under six spellings: one component, over its limit.
    expect(
      await presentComponentKey({
        from: CLIENT,
        componentId: PROBE_A.toUpperCase(),
        key: "the-right-key",
        isKeyRight: true,
      }),
    ).not.toBeNull();
    expect(redis.keysHolding(`{${PROBE_A}}`)).toHaveLength(1);
  });

  test("a wrong key for an id no component has is not counted, and nothing is kept for it", async () => {
    const none: ExistenceCheck = exists(false);

    for (let index: number = 0; index < 200; index++) {
      expect(
        await presentComponentKey({
          from: CLIENT,
          componentId: componentIdOf(1000 + index),
          key: `guess-${index}`,
          isKeyRight: false,
          existence: none,
        }),
      ).toBeNull();
    }

    expect(none.asked()).toBe(200);
    expect(redis.sets.size).toBe(0);
    expect(redis.commandsSent("eval")).toHaveLength(0);
  });

  test("the component is looked up only for a wrong key: never for the right one", async () => {
    const lookup: ExistenceCheck = exists(true);

    await presentComponentKey({
      from: CLIENT,
      key: "right",
      isKeyRight: true,
      existence: lookup,
    });

    expect(lookup.asked()).toBe(0);

    await presentComponentKey({
      from: CLIENT,
      key: "wrong",
      isKeyRight: false,
      existence: lookup,
    });

    expect(lookup.asked()).toBe(1);
  });

  test("a key the repository ships, or one that is not text, is never counted: it can never be right", async () => {
    const lookup: ExistenceCheck = exists(true);

    for (const key of [
      "secret",
      " secret ",
      "please-change-this-to-random-value",
      "probe-1-please-change-this-to-random-value",
      "please-change-this-1",
      "",
      "   ",
      12345,
      true,
      null,
      undefined,
      ["a", "b"],
      { key: "value" },
    ] as Array<unknown>) {
      expect(
        await presentComponentKey({
          from: CLIENT,
          key: key,
          isKeyRight: false,
          existence: lookup,
        }),
      ).toBeNull();
    }

    expect(lookup.asked()).toBe(0);
    expect(redis.sets.size).toBe(0);
  });

  test("an id that is not an id is never counted, nor looked up", async () => {
    const lookup: ExistenceCheck = exists(true);

    for (const componentId of [
      "",
      "not-an-id",
      "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5",
      `${PROBE_A}0`,
      "z".repeat(32),
      "x".repeat(100000),
    ]) {
      expect(
        await presentComponentKey({
          from: CLIENT,
          componentId: componentId,
          key: "guess",
          isKeyRight: false,
          existence: lookup,
        }),
      ).toBeNull();
    }

    expect(lookup.asked()).toBe(0);
    expect(redis.commandsSent("eval")).toHaveLength(0);
  });

  test("a client over the limit adds nothing more: the set holds one value past the limit", async () => {
    for (let index: number = 0; index < 40; index++) {
      await presentComponentKey({
        from: CLIENT,
        key: `guess-${index}`,
        isKeyRight: false,
      });
    }

    const sets: Array<string> = redis.keysHolding(CLIENT);

    expect(sets).toHaveLength(1);
    expect(redis.membersOf(sets[0]!)).toHaveLength(
      WRONG_COMPONENT_KEYS_PER_ADDRESS + 1,
    );
  });

  test("the first refusal of a window is logged once, naming the client and the component", async () => {
    for (let index: number = 0; index < 20; index++) {
      await presentComponentKey({
        from: CLIENT,
        key: `guess-${index}`,
        isKeyRight: false,
      });
    }

    expect(mockWarnings).toStrictEqual([
      `WrongComponentKeyLimit: ${CLIENT} sent more than ${WRONG_COMPONENT_KEYS_PER_ADDRESS} different wrong keys for probe ${PROBE_A} in ${
        WRONG_COMPONENT_KEY_WINDOW_SECONDS / 60
      } minutes, so its requests for it are refused until the window ends (wrong probe key limit)`,
    ]);
  });

  test("a new window starts the count again", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-19T08:00:00.000Z") });

    for (
      let index: number = 0;
      index <= WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      await presentComponentKey({
        from: CLIENT,
        key: `guess-${index}`,
        isKeyRight: false,
      });
    }

    expect(
      await presentComponentKey({ from: CLIENT, key: "r", isKeyRight: true }),
    ).not.toBeNull();

    jest.setSystemTime(
      new Date(
        Date.parse("2026-10-19T08:00:00.000Z") +
          WRONG_COMPONENT_KEY_WINDOW_SECONDS * 1000,
      ),
    );

    expect(
      await presentComponentKey({ from: CLIENT, key: "r", isKeyRight: true }),
    ).toBeNull();
  });
});

describe("an IPv6 host is counted for its /64 as well", () => {
  test("a host sending from address after address of its /64, about one probe, is held to ten addresses' worth", async () => {
    const perNetwork: number = getIpv6NetworkRateLimit(
      WRONG_COMPONENT_KEYS_PER_ADDRESS,
    );
    let refusedAt: number | null = null;

    for (let index: number = 0; index < perNetwork + 50; index++) {
      const refusal: WrongKeyRefusal | null = await presentComponentKey({
        from: hostOf(index),
        key: `guess-${index}`,
        isKeyRight: false,
      });

      if (refusal && refusedAt === null) {
        refusedAt = index;
      }
    }

    expect(refusedAt).toBe(perNetwork);

    // The right key from yet another address of that /64: refused.
    expect(
      await presentComponentKey({
        from: hostOf(100000),
        key: "right",
        isKeyRight: true,
      }),
    ).not.toBeNull();

    // An IPv4 client and another /64 are not.
    expect(
      await presentComponentKey({
        from: CLIENT,
        key: "right",
        isKeyRight: true,
      }),
    ).toBeNull();
    expect(
      await presentComponentKey({
        from: "2001:db8:99:1::5",
        key: "right",
        isKeyRight: true,
      }),
    ).toBeNull();
  });
});

describe("REGISTER_PROBE_KEY, counted for the client alone", () => {
  test("ten different wrong keys, then every registration from that client is refused, the right key too", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await presentRegistrationKey({
          from: CLIENT,
          key: `guess-${index}`,
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    expect(
      await presentRegistrationKey({
        from: CLIENT,
        key: "guess-eleven",
        isKeyRight: false,
      }),
    ).not.toBeNull();
    expect(
      await presentRegistrationKey({
        from: CLIENT,
        key: "right",
        isKeyRight: true,
      }),
    ).not.toBeNull();
    expect(
      await presentRegistrationKey({
        from: OTHER_CLIENT,
        key: "right",
        isKeyRight: true,
      }),
    ).toBeNull();

    expect(
      redis.keysHolding("probe-registration-key:wrong-keys:").length,
    ).toBeGreaterThan(0);
  });

  test("the right key is never counted, however many registrations carry it, and leaves the client all ten of its wrong keys", async () => {
    for (let call: number = 0; call < 1000; call++) {
      expect(
        await presentRegistrationKey({
          from: CLIENT,
          key: "the-right-key",
          isKeyRight: true,
        }),
      ).toBeNull();
    }

    expect(redis.sets.size).toBe(0);

    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await presentRegistrationKey({
          from: CLIENT,
          key: `guess-${index}`,
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    // Ten wrong ones, and no more: the right key is still let through.
    expect(
      await presentRegistrationKey({
        from: CLIENT,
        key: "the-right-key",
        isKeyRight: true,
      }),
    ).toBeNull();
  });

  test("probes that all hold one old registration key send one value, and are never refused for it", async () => {
    for (let call: number = 0; call < 300; call++) {
      expect(
        await presentRegistrationKey({
          from: CLIENT,
          key: "the-registration-key-before-it-changed",
          isKeyRight: false,
        }),
      ).toBeNull();
    }
  });

  test("a shipped or non-text registration key is never counted", async () => {
    for (const key of [
      "secret",
      "please-change-this-to-random-value",
      "",
      7,
      null,
    ] as Array<unknown>) {
      expect(
        await presentRegistrationKey({ from: CLIENT, key, isKeyRight: false }),
      ).toBeNull();
    }

    expect(redis.sets.size).toBe(0);
  });
});

describe("what Valkey keeps of a wrong key", () => {
  test("an HMAC of it under a key derived from the installation's token signing key - never the key", async () => {
    const key: string = "a-near-miss-of-the-real-key-0123456789";

    await presentComponentKey({ from: CLIENT, key: key, isKeyRight: false });

    const sets: Array<string> = redis.keysHolding("probe-key:wrong-keys:");
    const members: Array<string> = redis.membersOf(sets[0]!);

    const expected: string = crypto
      .createHmac(
        "sha256",
        TokenSigningKey.deriveKey(WRONG_COMPONENT_KEY_DIGEST_LABEL),
      )
      .update(`probe\n${PROBE_A}\n${key}`, "utf8")
      .digest("hex");

    expect(members).toStrictEqual([expected]);
    expect(JSON.stringify(Array.from(redis.sets.entries()))).not.toContain(key);
  });

  test("the same key is another value for another kind or another component", () => {
    const key: string = "same-key";

    const values: Set<string> = new Set<string>([
      WrongComponentKeyLimit.digestOf(ComponentKeyKind.Probe, PROBE_A, key),
      WrongComponentKeyLimit.digestOf(ComponentKeyKind.Probe, PROBE_B, key),
      WrongComponentKeyLimit.digestOf(ComponentKeyKind.Agent, PROBE_A, key),
      WrongComponentKeyLimit.digestOf(
        ComponentKeyKind.ProbeRegistration,
        "",
        key,
      ),
    ]);

    expect(values.size).toBe(4);
  });

  test("a component's sets carry its id in a hash tag, and live two windows", async () => {
    await presentComponentKey({
      from: hostOf(1),
      kind: ComponentKeyKind.Agent,
      componentId: RUNNER_A,
      key: "wrong",
      isKeyRight: false,
    });

    const sets: Array<string> = redis.keysHolding("agent-key:wrong-keys:");

    // The address's and its /64's, both tagged with the component.
    expect(sets).toHaveLength(2);

    for (const set of sets) {
      expect(set.startsWith(`agent-key:wrong-keys:{${RUNNER_A}}:`)).toBe(true);
      expect(redis.expiries.get(set)).toStrictEqual([
        WRONG_COMPONENT_KEY_WINDOW_SECONDS * 2,
      ]);
    }
  });
});

/*
 * OneUptime's own probes, its global Runner and the agents beside it call
 * from private network addresses, which a proxy, a load balancer or a
 * container network can show many callers as. A client over the limit is
 * refused whichever key it carries, so a key from such an address is never
 * counted: nobody beside a probe can stop it.
 */
describe("a key from a private network address is never counted", () => {
  // An address a container network's gateway has, as the bundled Nginx sees it.
  const SHARED_PRIVATE_ADDRESS: string = "172.18.0.1";

  test.each([
    ["a probe", ComponentKeyKind.Probe as const, PROBE_A],
    ["a Runner or an AI agent", ComponentKeyKind.Agent as const, RUNNER_A],
  ])(
    "%s: wrong key after wrong key from one, and the component's right key from the same address is still let through; nothing is read or kept",
    async (
      _label: string,
      kind: ComponentKeyKind.Probe | ComponentKeyKind.Agent,
      componentId: string,
    ) => {
      const lookup: ExistenceCheck = exists(true);

      for (
        let index: number = 0;
        index < WRONG_COMPONENT_KEYS_PER_ADDRESS * 3;
        index++
      ) {
        expect(
          await presentComponentKey({
            from: SHARED_PRIVATE_ADDRESS,
            kind: kind,
            componentId: componentId,
            key: `guess-${index}`,
            isKeyRight: false,
            existence: lookup,
          }),
        ).toBeNull();
      }

      expect(
        await presentComponentKey({
          from: SHARED_PRIVATE_ADDRESS,
          kind: kind,
          componentId: componentId,
          key: "the-right-key",
          isKeyRight: true,
          existence: lookup,
        }),
      ).toBeNull();

      expect(lookup.asked()).toBe(0);
      expect(redis.sent).toHaveLength(0);
      expect(redis.keys()).toStrictEqual([]);
      expect(mockWarnings).toStrictEqual([]);
    },
  );

  test("REGISTER_PROBE_KEY: wrong value after wrong value from one, and the right one from the same address still registers; nothing is kept", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS * 3;
      index++
    ) {
      expect(
        await presentRegistrationKey({
          from: SHARED_PRIVATE_ADDRESS,
          key: `guess-${index}`,
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    expect(
      await presentRegistrationKey({
        from: SHARED_PRIVATE_ADDRESS,
        key: "the-right-key",
        isKeyRight: true,
      }),
    ).toBeNull();

    expect(redis.sent).toHaveLength(0);
    expect(redis.keys()).toStrictEqual([]);
  });

  test.each([
    ["10.0.0.0/8", "10.0.0.1"],
    ["10.0.0.0/8, its last address", "10.255.255.254"],
    ["172.16.0.0/12", "172.16.0.1"],
    ["172.16.0.0/12, its last address", "172.31.255.254"],
    ["192.168.0.0/16", "192.168.1.20"],
    ["loopback", "127.0.0.1"],
    ["loopback, anywhere in 127.0.0.0/8", "127.10.0.3"],
    ["IPv4 link-local", "169.254.12.7"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unique local, fc00::/7", "fd12:3456:789a::5"],
    ["IPv6 unique local, its fc half", "fc00::7"],
    ["IPv6 link-local", "fe80::1"],
    ["a private IPv4 address written as IPv6", "::ffff:10.1.2.3"],
  ])("%s (%s): never counted", async (_label: string, address: string) => {
    expect(WrongComponentKeyLimit.isPrivateNetworkAddress(address)).toBe(true);

    for (
      let index: number = 0;
      index <= WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await presentComponentKey({
          from: address,
          key: `guess-${index}`,
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    expect(redis.sent).toHaveLength(0);
  });

  test.each([
    ["just below 10.0.0.0/8", "9.255.255.255"],
    ["just above 10.0.0.0/8", "11.0.0.1"],
    ["just below 172.16.0.0/12", "172.15.255.254"],
    ["just above 172.16.0.0/12", "172.32.0.1"],
    ["just above 192.168.0.0/16", "192.169.0.1"],
    ["shared address space, 100.64.0.0/10", "100.64.0.1"],
    ["just above 169.254.0.0/16", "169.255.0.1"],
    ["documentation, on the internet's side", "203.0.113.9"],
    ["a public IPv4 address written as IPv6", "::ffff:203.0.113.9"],
    ["a global IPv6 address", "2001:db8:1:2::9"],
    ["IPv6 just below fc00::/7", "fbff::1"],
    ["the retired IPv6 site-local prefix", "fec0::1"],
    ["6to4, written over a private IPv4 address", "2002:a00:1::1"],
    ["the translation prefix, over a private IPv4 address", "64:ff9b::a00:1"],
  ])(
    "%s (%s): counted like any client",
    async (_label: string, address: string) => {
      expect(WrongComponentKeyLimit.isPrivateNetworkAddress(address)).toBe(
        false,
      );

      for (
        let index: number = 0;
        index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
        index++
      ) {
        expect(
          await presentComponentKey({
            from: address,
            key: `guess-${index}`,
            isKeyRight: false,
          }),
        ).toBeNull();
      }

      expect(
        await presentComponentKey({
          from: address,
          key: "guess-eleven",
          isKeyRight: false,
        }),
      ).not.toBeNull();
    },
  );

  test("a client that cannot be placed is counted, as every such caller is one client", async () => {
    expect(WrongComponentKeyLimit.isPrivateNetworkAddress("unknown")).toBe(
      false,
    );

    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await presentRegistrationKey({
          from: "not-an-address",
          key: `guess-${index}`,
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    expect(
      await presentRegistrationKey({
        from: "not-an-address",
        key: "guess-eleven",
        isKeyRight: false,
      }),
    ).not.toBeNull();
    expect(redis.keysHolding(":unknown:").length).toBeGreaterThan(0);
  });

  test("a private address a caller writes into X-Forwarded-For itself changes nothing: the address the bundled Nginx wrote is counted", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        await presentComponentKey({
          from: `10.0.0.${index + 1}, ${CLIENT}`,
          key: `guess-${index}`,
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    expect(
      await presentComponentKey({
        from: `127.0.0.1, ${CLIENT}`,
        key: "the-right-key",
        isKeyRight: true,
      }),
    ).toBeNull();
    expect(
      await presentComponentKey({
        from: `192.168.0.1, ${CLIENT}`,
        key: "guess-eleven",
        isKeyRight: false,
      }),
    ).not.toBeNull();
    expect(
      await presentComponentKey({
        from: `172.18.0.1, ${CLIENT}`,
        key: "the-right-key",
        isKeyRight: true,
      }),
    ).not.toBeNull();
  });

  test("a probe that reaches the app with no proxy in between, from a pod's address, is never counted", async () => {
    const direct: ExpressRequest = {
      headers: {},
      socket: { remoteAddress: "::ffff:10.42.0.17" },
      query: {},
      params: {},
      body: {},
    } as unknown as ExpressRequest;

    for (let index: number = 0; index < 30; index++) {
      expect(
        await WrongComponentKeyLimit.checkComponentKey({
          req: direct,
          kind: ComponentKeyKind.Probe,
          componentId: PROBE_A,
          presentedKey: `guess-${index}`,
          isKeyRight: false,
          componentExists: exists(true).check,
        }),
      ).toBeNull();
    }

    expect(redis.sent).toHaveLength(0);
  });

  test("an address with its link's zone, and text that is no address, are read safely", () => {
    expect(WrongComponentKeyLimit.isPrivateNetworkAddress("fe80::1%eth0")).toBe(
      true,
    );
    expect(WrongComponentKeyLimit.isPrivateNetworkAddress("")).toBe(false);
    expect(WrongComponentKeyLimit.isPrivateNetworkAddress("10.0.0")).toBe(
      false,
    );
    expect(
      WrongComponentKeyLimit.isPrivateNetworkAddress("10.0.0.1.example.com"),
    ).toBe(false);
    expect(
      WrongComponentKeyLimit.isPrivateNetworkAddress("10.0.0.1%eth0"),
    ).toBe(false);
    expect(
      WrongComponentKeyLimit.isPrivateNetworkAddress(
        `fe80::1${"%".repeat(100000)}`,
      ),
    ).toBe(true);
    expect(
      WrongComponentKeyLimit.isPrivateNetworkAddress(
        undefined as unknown as string,
      ),
    ).toBe(false);
  });
});

describe("Valkey away, slow or failing: keys are compared as always", () => {
  test("not connected: nothing is counted, and no component is looked up", async () => {
    mockRedisState.connected = false;

    const lookup: ExistenceCheck = exists(true);

    for (let index: number = 0; index < 100; index++) {
      expect(
        await presentComponentKey({
          from: CLIENT,
          key: `guess-${index}`,
          isKeyRight: false,
          existence: lookup,
        }),
      ).toBeNull();
    }

    expect(lookup.asked()).toBe(0);
    expect(redis.sent).toHaveLength(0);
  });

  test("no client at all: nothing is counted", async () => {
    mockRedisState.client = null;

    expect(
      await presentRegistrationKey({
        from: CLIENT,
        key: "x",
        isKeyRight: false,
      }),
    ).toBeNull();
  });

  test("a failing count lets the key be compared, and is logged once a minute at most", async () => {
    redis.failCommand = (): Error => {
      return new Error("READONLY You can't write against a read only replica");
    };

    for (let index: number = 0; index < 30; index++) {
      expect(
        await presentComponentKey({
          from: CLIENT,
          kind: ComponentKeyKind.Agent,
          componentId: RUNNER_A,
          key: `guess-${index}`,
          isKeyRight: false,
        }),
      ).toBeNull();
    }

    expect(
      mockWarnings.filter((line: string): boolean => {
        return (
          line ===
          "WrongComponentKeyLimit: the wrong agent key count failed, so those keys are compared without it"
        );
      }),
    ).toHaveLength(1);
  });

  test(`a count Valkey does not answer is not waited for past ${WRONG_KEY_COUNT_TIMEOUT_MS} ms`, async () => {
    redis.stallEvals = true;

    const started: number = Date.now();
    const refusal: WrongKeyRefusal | null = await presentComponentKey({
      from: CLIENT,
      key: "right",
      isKeyRight: true,
    });
    const waited: number = Date.now() - started;

    expect(refusal).toBeNull();
    expect(waited).toBeGreaterThanOrEqual(WRONG_KEY_COUNT_TIMEOUT_MS - 50);
    expect(waited).toBeLessThan(WRONG_KEY_COUNT_TIMEOUT_MS + 1500);

    // The late answer is not lost, nor thrown anywhere.
    expect(redis.releaseStalledEvals()).toBe(1);
  }, 15000);
});

describe("a client over the limit is refused before its key is looked up", () => {
  // Asks, as every check of a component's key does before its lookup.
  async function askBeforeLookup(data: {
    from: string;
    kind?: ComponentKeyKind.Probe | ComponentKeyKind.Agent;
    componentId?: string;
  }): Promise<WrongKeyRefusal | null> {
    return await WrongComponentKeyLimit.checkBeforeLookup({
      req: requestFrom(data.from),
      kind: data.kind ?? ComponentKeyKind.Probe,
      componentId: data.componentId ?? PROBE_A,
    });
  }

  async function sendWrongKeys(data: {
    from: string;
    kind?: ComponentKeyKind.Probe | ComponentKeyKind.Agent;
    componentId?: string;
    count: number;
  }): Promise<void> {
    for (let index: number = 0; index < data.count; index++) {
      await presentComponentKey({
        from: data.from,
        kind: data.kind ?? ComponentKeyKind.Probe,
        componentId: data.componentId ?? PROBE_A,
        key: `guess-${index}`,
        isKeyRight: false,
      });
    }
  }

  test("a client within the limit is let on to the lookup, and asking adds nothing to its count", async () => {
    expect(await askBeforeLookup({ from: CLIENT })).toBeNull();

    await sendWrongKeys({
      from: CLIENT,
      count: WRONG_COMPONENT_KEYS_PER_ADDRESS,
    });

    for (let ask: number = 0; ask < 50; ask++) {
      expect(await askBeforeLookup({ from: CLIENT })).toBeNull();
    }

    const sets: Array<string> = redis.keysHolding("probe-key:wrong-keys:");

    expect(sets).toHaveLength(1);
    expect(redis.membersOf(sets[0]!)).toHaveLength(
      WRONG_COMPONENT_KEYS_PER_ADDRESS,
    );

    // Asking left its count where it was: its next different wrong key is the one that goes over.
    expect(
      await presentComponentKey({
        from: CLIENT,
        key: "one-more-guess",
        isKeyRight: false,
      }),
    ).not.toBeNull();
  });

  test.each([
    ["a probe", ComponentKeyKind.Probe as const],
    ["a Runner or an AI agent", ComponentKeyKind.Agent as const],
  ])(
    "a client over the limit for %s is refused before the lookup, for that component and from that client alone, and asking keeps nothing more",
    async (
      _label: string,
      kind: ComponentKeyKind.Probe | ComponentKeyKind.Agent,
    ) => {
      await sendWrongKeys({
        from: CLIENT,
        kind: kind,
        count: WRONG_COMPONENT_KEYS_PER_ADDRESS + 1,
      });

      const warningsBefore: number = mockWarnings.length;
      const valuesBefore: Array<string> = redis.membersOf(
        redis.keysHolding(":wrong-keys:")[0]!,
      );

      for (let ask: number = 0; ask < 20; ask++) {
        const refusal: WrongKeyRefusal | null = await askBeforeLookup({
          from: CLIENT,
          kind: kind,
        });

        expect(refusal).not.toBeNull();
        expect(refusal!.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(refusal!.retryAfterSeconds).toBeLessThanOrEqual(
          WRONG_COMPONENT_KEY_WINDOW_SECONDS,
        );
      }

      // Nothing more is kept, and the one line its going over wrote is not written again.
      expect(redis.keysHolding(":wrong-keys:")).toHaveLength(1);
      expect(redis.membersOf(redis.keysHolding(":wrong-keys:")[0]!)).toEqual(
        valuesBefore,
      );
      expect(mockWarnings.length).toBe(warningsBefore);

      // Another client, another component, another kind of key: let on.
      expect(
        await askBeforeLookup({ from: OTHER_CLIENT, kind: kind }),
      ).toBeNull();
      expect(
        await askBeforeLookup({
          from: CLIENT,
          kind: kind,
          componentId: PROBE_B,
        }),
      ).toBeNull();
      expect(
        await askBeforeLookup({
          from: CLIENT,
          kind:
            kind === ComponentKeyKind.Probe
              ? ComponentKeyKind.Agent
              : ComponentKeyKind.Probe,
        }),
      ).toBeNull();
    },
  );

  test("every spelling of the component's id is asked about as that component", async () => {
    await sendWrongKeys({
      from: CLIENT,
      count: WRONG_COMPONENT_KEYS_PER_ADDRESS + 1,
    });

    for (const spelling of [
      PROBE_A,
      PROBE_A.toUpperCase(),
      `{${PROBE_A}}`,
      PROBE_A.split("-").join(""),
    ]) {
      const refusal: WrongKeyRefusal | null = await askBeforeLookup({
        from: CLIENT,
        componentId: spelling,
      });

      expect({ spelling, refused: refusal !== null }).toEqual({
        spelling,
        refused: true,
      });
    }
  });

  test("an IPv6 /64 over its limit is refused before the lookup, from an address of it that sent nothing yet", async () => {
    const perNetwork: number = getIpv6NetworkRateLimit(
      WRONG_COMPONENT_KEYS_PER_ADDRESS,
    );

    for (let index: number = 0; index <= perNetwork; index++) {
      await presentComponentKey({
        from: hostOf(index),
        key: `guess-${index}`,
        isKeyRight: false,
      });
    }

    expect(await askBeforeLookup({ from: hostOf(200000) })).not.toBeNull();
    expect(await askBeforeLookup({ from: "2001:db8:99:1::5" })).toBeNull();
    expect(await askBeforeLookup({ from: CLIENT })).toBeNull();
  });

  test("a private network address, an id that is no id, and Valkey away: never refused, and nothing is read", async () => {
    // Over the limit from a public address first, for every case below.
    await sendWrongKeys({
      from: CLIENT,
      count: WRONG_COMPONENT_KEYS_PER_ADDRESS + 1,
    });

    const sentBefore: number = redis.sent.length;

    for (const address of ["10.1.2.3", "172.19.0.1", "127.0.0.1", "fd00::7"]) {
      expect([address, await askBeforeLookup({ from: address })]).toEqual([
        address,
        null,
      ]);
    }

    for (const notAnId of ["", "probe-one", "x".repeat(5000)]) {
      expect(
        await askBeforeLookup({ from: CLIENT, componentId: notAnId }),
      ).toBeNull();
    }

    expect(redis.sent.length).toBe(sentBefore);

    mockRedisState.connected = false;
    expect(await askBeforeLookup({ from: CLIENT })).toBeNull();

    mockRedisState.connected = true;
    mockRedisState.client = null;
    expect(await askBeforeLookup({ from: CLIENT })).toBeNull();

    expect(redis.sent.length).toBe(sentBefore);
  });

  test("a failing question lets the request go on to its lookup", async () => {
    await sendWrongKeys({
      from: CLIENT,
      count: WRONG_COMPONENT_KEYS_PER_ADDRESS + 1,
    });

    redis.failNextExec = new Error("Connection is closed.");

    expect(await askBeforeLookup({ from: CLIENT })).toBeNull();

    // The next question, answered, refuses again.
    expect(await askBeforeLookup({ from: CLIENT })).not.toBeNull();
  });

  test(`a question Valkey does not answer is not waited for past ${WRONG_KEY_COUNT_TIMEOUT_MS} ms: the request goes on to its lookup`, async () => {
    redis.stallEvals = true;

    const started: number = Date.now();
    const refusal: WrongKeyRefusal | null = await askBeforeLookup({
      from: CLIENT,
    });
    const waited: number = Date.now() - started;

    expect(refusal).toBeNull();
    expect(waited).toBeGreaterThanOrEqual(WRONG_KEY_COUNT_TIMEOUT_MS - 50);
    expect(waited).toBeLessThan(WRONG_KEY_COUNT_TIMEOUT_MS + 1500);

    // The late answer is not lost, nor thrown anywhere, and added nothing.
    expect(redis.releaseStalledEvals()).toBe(1);
    expect(redis.keysHolding(":wrong-keys:")).toHaveLength(0);
  }, 15000);
});

describe("answering a refused request", () => {
  // Every kind of key, and what a client refused for it is told.
  const ANSWERS: Array<[ComponentKeyKind, string]> = [
    [ComponentKeyKind.Probe, WRONG_PROBE_KEYS_MESSAGE],
    [ComponentKeyKind.Agent, WRONG_AGENT_KEYS_MESSAGE],
    [ComponentKeyKind.ProbeRegistration, WRONG_PROBE_REGISTRATION_KEYS_MESSAGE],
  ];

  test("every kind of key there is is answered below: the shared Runner's key is gone", () => {
    expect(Object.values(ComponentKeyKind)).toStrictEqual(
      ANSWERS.map((answer: [ComponentKeyKind, string]): ComponentKeyKind => {
        return answer[0];
      }),
    );
  });

  test.each(ANSWERS)(
    "%s: 429, with when to try again in Retry-After, and what to do",
    (kind: ComponentKeyKind, message: string) => {
      const sendErrorResponse: Mock<(...args: Array<unknown>) => unknown> =
        Response.sendErrorResponse as unknown as Mock<
          (...args: Array<unknown>) => unknown
        >;
      sendErrorResponse.mockClear();

      const headers: Record<string, string> = {};
      const res: JSONObject = {
        setHeader: (name: string, value: string): void => {
          headers[name] = value;
        },
      } as unknown as JSONObject;

      WrongComponentKeyLimit.answerRefusal(
        requestFrom(CLIENT),
        res as never,
        kind,
        { retryAfterSeconds: 321 },
      );

      expect(headers).toStrictEqual({ "Retry-After": "321" });
      expect(sendErrorResponse).toHaveBeenCalledTimes(1);

      const error: Exception = sendErrorResponse.mock.calls[0]![2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(error.message).toBe(message);
      expect(message).toContain("Retry-After");
    },
  );

  test("a response without setHeader is still answered", () => {
    const sendErrorResponse: Mock<(...args: Array<unknown>) => unknown> =
      Response.sendErrorResponse as unknown as Mock<
        (...args: Array<unknown>) => unknown
      >;
    sendErrorResponse.mockClear();

    WrongComponentKeyLimit.answerRefusal(
      requestFrom(CLIENT),
      {} as never,
      ComponentKeyKind.Probe,
      { retryAfterSeconds: 5 },
    );

    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
  });
});

describe("canonicalId", () => {
  test("one spelling for every spelling Postgres reads as one id", () => {
    for (const spelling of [
      PROBE_A,
      PROBE_A.toUpperCase(),
      `{${PROBE_A}}`,
      `{${PROBE_A.toUpperCase()}}`,
      PROBE_A.split("-").join(""),
      `  ${PROBE_A}\t`,
    ]) {
      expect(WrongComponentKeyLimit.canonicalId(spelling)).toBe(PROBE_A);
    }
  });

  test("null for anything that is no id", () => {
    for (const notAnId of [
      "",
      "   ",
      "abc",
      `${PROBE_A}-`.repeat(3),
      "g".repeat(32),
      `{${PROBE_A}`,
      "x".repeat(65),
    ]) {
      expect(WrongComponentKeyLimit.canonicalId(notAnId)).toBeNull();
    }

    expect(
      WrongComponentKeyLimit.canonicalId(42 as unknown as string),
    ).toBeNull();
  });

  test("answers a megabyte of text at once", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(
          WrongComponentKeyLimit.canonicalId("-".repeat(1000000)),
        ).toBeNull();
      },
      limitInMs: 200,
    });
    expect(timed.inMs).toBeLessThan(200);
  });
});

describe("the limits are kept apart in Valkey", () => {
  test("each kind of key keeps its sets under a prefix of its own, none the cluster key's", async () => {
    const prefixOf: (key: string) => string = (key: string): string => {
      return key.split("wrong-keys:")[0]! + "wrong-keys:";
    };

    await presentComponentKey({
      from: CLIENT,
      kind: ComponentKeyKind.Probe,
      key: "w",
      isKeyRight: false,
    });
    await presentComponentKey({
      from: CLIENT,
      kind: ComponentKeyKind.Agent,
      key: "w",
      isKeyRight: false,
    });
    await presentRegistrationKey({
      from: CLIENT,
      key: "w",
      isKeyRight: false,
    });

    expect(Array.from(redis.sets.keys()).map(prefixOf).sort()).toStrictEqual(
      [
        "agent-key:wrong-keys:",
        "probe-key:wrong-keys:",
        "probe-registration-key:wrong-keys:",
      ].sort(),
    );
  });

  test("each limit is a WrongKeyLimit, which counts with the one script", () => {
    expect(
      new WrongKeyLimit({
        scope: "a test",
        logSource: "test",
        countedKeys: "test keys",
        keyPrefix: "test:wrong-keys:",
        perAddress: 1,
        windowSeconds: 60,
        countFailedMessage: "test",
      }).isCounting(),
    ).toBe(true);

    mockRedisState.connected = false;

    expect(
      new WrongKeyLimit({
        scope: "a test",
        logSource: "test",
        countedKeys: "test keys",
        keyPrefix: "test:wrong-keys:",
        perAddress: 1,
        windowSeconds: 60,
        countFailedMessage: "test",
      }).isCounting(),
    ).toBe(false);
  });
});
