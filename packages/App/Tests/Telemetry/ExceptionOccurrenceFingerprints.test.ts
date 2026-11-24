/*
 * WHICH EXCEPTION AN OCCURRENCE BELONGS TO, WHATEVER A SCRUB RULE HID (#10434).
 *
 * ExceptionUtil.getOccurrenceFingerprints makes an occurrence's fingerprints
 * from the exception as it arrived and from what the scrub rules left of it,
 * and resolveGroupFingerprints picks the exception it belongs to: the first
 * of its candidates one exists under, else a new one under its v2. These
 * pin both, with Postgres mocked: the ingest walks are in
 * ScrubRuleExceptionGroups.test.ts.
 */
import ExceptionUtil, {
  EXISTING_GROUP_CACHE_MAX_ENTRIES,
  ExceptionGroupingContent,
  GROUP_FINGERPRINT_LOOKUP_SQL,
  GroupFingerprintCandidate,
  OccurrenceFingerprints,
  TelemetryExceptionPayload,
  clearExistingV1FingerprintCache,
  groupFingerprintKey,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import {
  getExceptionGroupingKey,
  getExceptionGroupingText,
} from "Common/Server/Utils/Telemetry/ExceptionGrouping";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-00000000e434",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-00000000e434",
);

// A message-only exception: grouping v2 reads its message.
const CARD_ARRIVED: ExceptionGroupingContent = {
  exceptionType: "PaymentDeclinedError",
  message: "card 4111-1111-1111-4821 declined",
  stackTrace: "",
};
const CARD_STORED: ExceptionGroupingContent = {
  ...CARD_ARRIVED,
  message: "card [REDACTED] declined",
};

// One with a stack trace: grouping v2 reads its frames, not its message.
const CART_STACK: string = [
  "TypeError: no cart for ada@example.com",
  "    at checkout (/app/src/cart.ts:10:15)",
  "    at reserve (/app/src/stock.ts:4:3)",
].join("\n");
const CART_ARRIVED: ExceptionGroupingContent = {
  exceptionType: "TypeError",
  message: "no cart for ada@example.com",
  stackTrace: CART_STACK,
};
const CART_STORED: ExceptionGroupingContent = {
  exceptionType: "TypeError",
  message: "no cart for [REDACTED]",
  stackTrace: [
    "TypeError: no cart for [REDACTED]",
    "    at checkout (/app/src/cart.ts:10:15)",
    "    at reserve (/app/src/stock.ts:4:3)",
  ].join("\n"),
};

interface Fingerprints {
  v1: string;
  // The keyed one of v1's text, where a v1 exception moves (#10619).
  keyedV1: string;
  v2: string;
  keyed: string;
  // Grouping v3's, and its keyed one (#10620): v2's for frames.
  v3: string;
  keyedV3: string;
}

// An exception's fingerprints, made the way the ingest made them before.
function fingerprintsOf(content: ExceptionGroupingContent): Fingerprints {
  const input: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    message: string;
    stackTrace: string;
    exceptionType: string;
  } = {
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    ...content,
  };

  return {
    v1: ExceptionUtil.getFingerprint(input),
    keyedV1: KeyedExceptionFingerprint.ofFirstGroupingText({
      projectId: PROJECT_ID,
      text: ExceptionUtil.getGroupingTextV1(input),
    }),
    v2: ExceptionUtil.getFingerprintV2(input),
    keyed: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: getExceptionGroupingText({
        projectId: PROJECT_ID.toString(),
        primaryEntityId: SERVICE_ID.toString(),
        key: getExceptionGroupingKey(content),
      }),
    }),
    v3: ExceptionUtil.getFingerprintV3(input),
    keyedV3: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: ExceptionUtil.getGroupingTexts(input).v3,
    }),
  };
}

function occurrence(data: {
  arrived: ExceptionGroupingContent;
  stored: ExceptionGroupingContent;
  fromLog?: boolean;
}): OccurrenceFingerprints {
  return ExceptionUtil.getOccurrenceFingerprints({
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    arrived: data.arrived,
    stored: data.stored,
    findsGroupsOfStoredText: data.fromLog,
  });
}

describe("an occurrence's fingerprints", () => {
  test("no rule changed it: v1, v2 and v3, each with its keyed one, are tried in that order, a new exception is made under v3, and v1 is kept when nothing can be read", () => {
    const card: Fingerprints = fingerprintsOf(CARD_ARRIVED);

    for (const fromLog of [false, true]) {
      expect(
        occurrence({ arrived: CARD_ARRIVED, stored: CARD_ARRIVED, fromLog }),
      ).toEqual({
        fingerprint: card.v1,
        fingerprintV2: card.v3,
        fingerprintCandidates: [
          card.v1,
          card.keyedV1,
          card.v2,
          card.keyed,
          card.v3,
          card.keyedV3,
        ],
      });
    }

    // Grouped by its frames, v3 is v2: each is tried once.
    const cart: Fingerprints = fingerprintsOf(CART_ARRIVED);
    expect(cart.v3).toBe(cart.v2);
    expect(cart.keyedV3).toBe(cart.keyed);
    expect(occurrence({ arrived: CART_ARRIVED, stored: CART_ARRIVED })).toEqual(
      {
        fingerprint: cart.v1,
        fingerprintV2: cart.v2,
        fingerprintCandidates: [cart.v1, cart.keyedV1, cart.v2, cart.keyed],
      },
    );
  });

  test("the fingerprints an occurrence no rule changed was given before #10434 stay its own", () => {
    const expected: Fingerprints = fingerprintsOf(CART_ARRIVED);
    const fingerprints: OccurrenceFingerprints = occurrence({
      arrived: CART_ARRIVED,
      stored: CART_ARRIVED,
    });

    // What a span's exception was given: v1 kept, v2 made under.
    expect(fingerprints.fingerprint).toBe(expected.v1);
    expect(fingerprints.fingerprintV2).toBe(expected.v2);
  });

  test("a rule hid a card number: tried as it arrived, and made under v3, which folds the card, as kept when nothing can be read", () => {
    const arrived: Fingerprints = fingerprintsOf(CARD_ARRIVED);

    expect(occurrence({ arrived: CARD_ARRIVED, stored: CARD_STORED })).toEqual({
      fingerprint: arrived.v3,
      fingerprintV2: arrived.v3,
      fingerprintCandidates: [
        arrived.v1,
        arrived.keyedV1,
        arrived.v2,
        arrived.keyed,
        arrived.v3,
        arrived.keyedV3,
      ],
      /*
       * v1 and v2 hash the card's digits: an exception made under either
       * moves (#10619). v3's text holds <CARD> whatever the card was.
       */
      fingerprintRekeys: {
        [arrived.v1]: arrived.keyedV1,
        [arrived.v2]: arrived.keyed,
      },
    });
  });

  test("a rule hid what grouping v3 reads too, a name: made under v3's keyed fingerprint, and kept under it when nothing can be read", () => {
    const named: ExceptionGroupingContent = {
      exceptionType: "AccountError",
      message: "No account for Ada Lovelace",
      stackTrace: "",
    };
    const arrived: Fingerprints = fingerprintsOf(named);

    expect(
      occurrence({
        arrived: named,
        stored: { ...named, message: "No account for [REDACTED]" },
      }),
    ).toEqual({
      fingerprint: arrived.keyedV3,
      fingerprintV2: arrived.keyedV3,
      fingerprintCandidates: [
        arrived.v1,
        arrived.keyedV1,
        arrived.v2,
        arrived.keyed,
        arrived.v3,
        arrived.keyedV3,
      ],
      fingerprintRekeys: {
        [arrived.v1]: arrived.keyedV1,
        [arrived.v2]: arrived.keyed,
        [arrived.v3]: arrived.keyedV3,
      },
    });
  });

  test("for a log, the exceptions grouped by what the rule left are tried first: those a rule split before #10434", () => {
    const arrived: Fingerprints = fingerprintsOf(CARD_ARRIVED);
    const stored: Fingerprints = fingerprintsOf(CARD_STORED);

    expect(
      occurrence({ arrived: CARD_ARRIVED, stored: CARD_STORED, fromLog: true }),
    ).toEqual({
      fingerprint: arrived.v3,
      fingerprintV2: arrived.v3,
      fingerprintCandidates: [
        stored.v1,
        stored.v2,
        arrived.v1,
        arrived.keyedV1,
        arrived.v2,
        arrived.keyed,
        arrived.v3,
        arrived.keyedV3,
      ],
      // What the rule left hashes nothing hidden: never moved.
      fingerprintRekeys: {
        [arrived.v1]: arrived.keyedV1,
        [arrived.v2]: arrived.keyed,
      },
    });
  });

  test("a rule hid only an address in a stack trace's message: made under v2 as it arrived, which leaves the message out, and kept under v1, which folds the address", () => {
    const arrived: Fingerprints = fingerprintsOf(CART_ARRIVED);
    const stored: Fingerprints = fingerprintsOf(CART_STORED);

    // The frames are the same with the address or without it.
    expect(stored.v2).toBe(arrived.v2);
    expect(stored.v1).not.toBe(arrived.v1);

    expect(occurrence({ arrived: CART_ARRIVED, stored: CART_STORED })).toEqual({
      fingerprint: arrived.v1,
      fingerprintV2: arrived.v2,
      fingerprintCandidates: [
        arrived.v1,
        arrived.keyedV1,
        arrived.v2,
        arrived.keyed,
      ],
      /*
       * Neither hashes the address - v1's text holds <EMAIL> in its place -
       * so an exception under either keeps its fingerprint: no moves.
       */
    });

    // A log tries what it was grouped by before, once each.
    expect(
      occurrence({ arrived: CART_ARRIVED, stored: CART_STORED, fromLog: true })
        .fingerprintCandidates,
    ).toEqual([
      stored.v1,
      arrived.v2,
      arrived.v1,
      arrived.keyedV1,
      arrived.keyed,
    ]);
  });

  test("is the same every time, and another in another service or project", () => {
    const first: OccurrenceFingerprints = occurrence({
      arrived: CARD_ARRIVED,
      stored: CARD_STORED,
      fromLog: true,
    });

    expect(
      occurrence({ arrived: CARD_ARRIVED, stored: CARD_STORED, fromLog: true }),
    ).toEqual(first);

    const elsewhere: Array<OccurrenceFingerprints> = [
      ExceptionUtil.getOccurrenceFingerprints({
        projectId: PROJECT_ID,
        primaryEntityId: ObjectID.generate(),
        arrived: CARD_ARRIVED,
        stored: CARD_STORED,
      }),
      ExceptionUtil.getOccurrenceFingerprints({
        projectId: ObjectID.generate(),
        primaryEntityId: SERVICE_ID,
        arrived: CARD_ARRIVED,
        stored: CARD_STORED,
      }),
    ];

    for (const other of elsewhere) {
      expect(other.fingerprintV2).not.toBe(first.fingerprintV2);
      for (const candidate of other.fingerprintCandidates) {
        expect(first.fingerprintCandidates).not.toContain(candidate);
      }
    }
  });
});

// The fingerprints the mocked Postgres holds exceptions under.
let existing: Set<string>;
let lookups: Array<Array<unknown>>;
let lookupFails: boolean;

function mockPostgres(): void {
  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        if (sql === GROUP_FINGERPRINT_LOOKUP_SQL) {
          lookups.push(params);
          if (lookupFails) {
            throw new Error("connection reset");
          }
          return (params[1] as Array<string>)
            .filter((fingerprint: string): boolean => {
              return existing.has(fingerprint);
            })
            .map((fingerprint: string) => {
              return { fingerprint, movedTo: null };
            });
        }
        return [];
      },
    },
  } as never);

  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
}

describe("which exception an occurrence with candidates belongs to", () => {
  beforeEach(() => {
    clearExistingV1FingerprintCache();
    existing = new Set<string>();
    lookups = [];
    lookupFails = false;
    mockPostgres();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function resolve(
    candidates: Array<GroupFingerprintCandidate>,
    now?: number,
  ): Promise<Map<string, string>> {
    return ExceptionUtil.resolveGroupFingerprints(candidates, now);
  }

  const HIDDEN: GroupFingerprintCandidate = {
    projectId: "p",
    v1: "keyed",
    v2: "keyed",
    candidates: ["stored-v1", "stored-v2", "v1", "v2", "keyed"],
  };
  const SEEN_AS_IT_CAME: GroupFingerprintCandidate = {
    projectId: "p",
    v1: "v1",
    v2: "v2",
    candidates: ["v1", "v2", "keyed"],
  };

  test("the first candidate an exception exists under, in their order", async () => {
    existing = new Set<string>(["v2", "keyed"]);

    const chosen: Map<string, string> = await resolve([
      HIDDEN,
      SEEN_AS_IT_CAME,
    ]);

    expect(chosen.get(groupFingerprintKey(HIDDEN))).toBe("v2");
    expect(chosen.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("v2");

    existing = new Set<string>(["stored-v2", "v1"]);
    clearExistingV1FingerprintCache();

    expect((await resolve([HIDDEN])).get(groupFingerprintKey(HIDDEN))).toBe(
      "stored-v2",
    );
  });

  test("one read for the project, with every candidate the batch tries once", async () => {
    await resolve([HIDDEN, SEEN_AS_IT_CAME]);

    expect(lookups).toEqual([
      ["p", ["stored-v1", "stored-v2", "v1", "v2", "keyed"]],
    ]);
  });

  test("none existing, it is made under its v2: the occurrences after it in the batch find it, whichever came first", async () => {
    const hiddenFirst: Map<string, string> = await resolve([
      HIDDEN,
      SEEN_AS_IT_CAME,
    ]);

    expect(hiddenFirst.get(groupFingerprintKey(HIDDEN))).toBe("keyed");
    expect(hiddenFirst.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("keyed");

    clearExistingV1FingerprintCache();

    const seenFirst: Map<string, string> = await resolve([
      SEEN_AS_IT_CAME,
      HIDDEN,
    ]);

    expect(seenFirst.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("v2");
    expect(seenFirst.get(groupFingerprintKey(HIDDEN))).toBe("v2");
  });

  test("and the batches this process reads next find it too, without reading again", async () => {
    await resolve([HIDDEN]);
    expect(lookups).toHaveLength(1);

    // The rule is removed: the next copy no rule changes finds the exception.
    const next: Map<string, string> = await resolve([SEEN_AS_IT_CAME]);

    expect(next.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("keyed");
    expect(lookups).toHaveLength(1);
  });

  test("a failed read keeps the fingerprint it names for that: v1 for an occurrence no rule changed, the keyed one for one a rule did", async () => {
    lookupFails = true;

    const chosen: Map<string, string> = await resolve([
      HIDDEN,
      SEEN_AS_IT_CAME,
    ]);

    expect(chosen.get(groupFingerprintKey(HIDDEN))).toBe("keyed");
    expect(chosen.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("v1");
    expect(logger.warn).toHaveBeenCalled();
  });

  test("what a read found is kept for the whole read, though the cache fills and is cleared midway", async () => {
    // Project a's exceptions fill the cache to its cap...
    const many: Array<GroupFingerprintCandidate> = [];

    for (
      let index: number = 0;
      index < EXISTING_GROUP_CACHE_MAX_ENTRIES;
      index++
    ) {
      many.push({
        projectId: "a",
        v1: `a-v1-${index}`,
        v2: `a-v2-${index}`,
      });
    }

    existing = new Set<string>(["a-v1-0"]);

    // ...and project b's, read after them in the same batch, clear it.
    const chosen: Map<string, string> = await resolve([
      ...many,
      { projectId: "b", v1: "b-v1", v2: "b-v2" },
    ]);

    expect(lookups).toHaveLength(2);
    expect(chosen.get(groupFingerprintKey(many[0]!))).toBe("a-v1-0");
    expect(chosen.get(groupFingerprintKey(many[1]!))).toBe("a-v2-1");
  });

  test("rows and payloads are given the chosen fingerprint, and keep no candidates or v2 of their own", async () => {
    existing = new Set<string>(["v1"]);

    const rows: Array<JSONObject> = [
      {
        projectId: "p",
        fingerprint: "v1",
        fingerprintV2: "v2",
        fingerprintCandidates: ["v1", "v2", "keyed"],
      },
      {
        projectId: "p",
        fingerprint: "keyed",
        fingerprintV2: "keyed",
        fingerprintCandidates: ["stored-v1", "stored-v2", "v1", "v2", "keyed"],
      },
      // A row with no v2 is left as it is, but for its candidates.
      { projectId: "p", fingerprint: "x", fingerprintCandidates: ["v1"] },
    ];

    await ExceptionUtil.assignRowGroupFingerprints(rows);

    expect(rows).toEqual([
      { projectId: "p", fingerprint: "v1" },
      { projectId: "p", fingerprint: "v1" },
      { projectId: "p", fingerprint: "x" },
    ]);

    const payloads: Array<TelemetryExceptionPayload> =
      await ExceptionUtil.assignPayloadGroupFingerprints([
        {
          fingerprint: "keyed",
          fingerprintV2: "keyed",
          fingerprintCandidates: [
            "stored-v1",
            "stored-v2",
            "v1",
            "v2",
            "keyed",
          ],
          projectId: PROJECT_ID,
          primaryEntityId: SERVICE_ID,
        },
      ]);

    // The exception its row was filed under: the one from before the rule.
    expect(payloads[0]!.fingerprint).toBe("v1");
    expect(payloads[0]).not.toHaveProperty("fingerprintV2");
    expect(payloads[0]).not.toHaveProperty("fingerprintCandidates");
  });

  test("a row's candidates are read with care: anything but text is left out, and no list is its v1 alone", async () => {
    existing = new Set<string>(["v2"]);

    const rows: Array<JSONObject> = [
      {
        projectId: "p",
        fingerprint: "v1",
        fingerprintV2: "keyed",
        fingerprintCandidates: [42, null, "", "v2"] as never,
      },
      {
        projectId: "p",
        fingerprint: "v1",
        fingerprintV2: "fresh",
        fingerprintCandidates: "v2" as never,
      },
    ];

    await ExceptionUtil.assignRowGroupFingerprints(rows);

    expect(rows[0]!["fingerprint"]).toBe("v2");
    // Its v1 alone was tried, and no exception exists under it.
    expect(rows[1]!["fingerprint"]).toBe("fresh");
  });
});
