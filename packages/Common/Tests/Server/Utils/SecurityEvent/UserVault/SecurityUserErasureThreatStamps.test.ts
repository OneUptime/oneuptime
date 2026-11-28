import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import DetectionFingerprint, {
  DetectionFingerprintKind,
} from "../../../../../Server/Utils/SecurityEvent/DetectionFingerprint";
import SecurityUserErasureThreatStamps, {
  MAX_STAMPS_PER_MUTATION,
  StampRewrite,
  StampedEventRow,
  StampsMutation,
  batchStampRewrites,
  planStampRewrite,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureThreatStamps";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
  isErasedIndicatorId,
} from "../../../../../Types/SecurityEvent/ThreatIntelConstants";
import {
  ERASED_USER_ATTRIBUTES,
  HASHED_USER_ATTRIBUTES,
  SCRUBBED_USER_ATTRIBUTES,
  ScrubbedUserRole,
  USER_ERASED_ON_REQUEST,
} from "../../../../../Utils/SecurityEvent/ScrubbedUser";
import { ErasedName } from "../../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE THREAT INTEL STAMP ON THE PERSON'S EVENTS (#11230): the ingest-time
 * enricher stamped an event the vault named the person in with the address
 * a feed lists (threat.indicator_value) and the feed's indicator
 * (threat.indicator_id), and an erasure left both. Here: which stamps are
 * the person's - the event's own user while the vault names them, a name
 * that left the same token once an erasure did not - what each gets, and
 * what is sent ClickHouse to read and rewrite them: the project, attribute
 * keys, tokens, ids and keyed ids, never the person nor the indicator. The
 * statements run on real servers in SecurityUserErasureClickhouse (26.7 and
 * 24.8) and SecurityUserErasureKeeperClickhouse (two replicas).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11230000-0000-4000-8000-0000000000a1",
);

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

const ALICE: string = "alice@example.com";
const TOKEN: string = tokenOf(ALICE);
const MIXED_TOKEN: string = tokenOf("Alice@Example.com");
const BOB_TOKEN: string = tokenOf("bob@example.com");
const STIX_ID: string = "indicator--8e2e2d2b-17d4-4cbf-938f-98ee46b3cd3f";

const NAMES: Array<ErasedName> = [
  { named: ALICE, hashed: TOKEN },
  { named: "Alice@Example.com", hashed: MIXED_TOKEN },
];
const TOKENS: Array<string> = [TOKEN, MIXED_TOKEN];

const CONTEXT: {
  projectId: ObjectID;
  tokens: Array<string>;
  names: Array<ErasedName>;
} = { projectId: PROJECT_ID, tokens: TOKENS, names: NAMES };

const EVENTS: string = new SecurityEvent().tableName;

function erasedIdOf(value: string): string {
  return DetectionFingerprint.erasedIndicatorIdOf({
    projectId: PROJECT_ID,
    value,
  });
}

function role(
  overrides: Partial<StampedEventRow["roles"][ScrubbedUserRole]> = {},
): StampedEventRow["roles"][ScrubbedUserRole] {
  return {
    user: "",
    hashedAs: "",
    scrubbed: "",
    isErased: false,
    ...overrides,
  };
}

function stamped(data: {
  id?: string;
  time?: string;
  stamp: string;
  principal?: Partial<StampedEventRow["roles"][ScrubbedUserRole]>;
  target?: Partial<StampedEventRow["roles"][ScrubbedUserRole]>;
}): StampedEventRow {
  return {
    id: data.id ?? "event-1",
    time: data.time ?? "1764000000000000001",
    indicatorValue: data.stamp,
    roles: {
      [ScrubbedUserRole.Principal]: role(data.principal),
      [ScrubbedUserRole.Target]: role(data.target),
    },
  };
}

function parameterValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params as Record<string, unknown>);
}

function sentText(statement: Statement): string {
  return `${statement.query} ${JSON.stringify(statement.query_params)}`;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("whose a stamp is", () => {
  test("while the vault names the user: theirs when it is the user, lower-cased as the enricher matched it", () => {
    for (const user of [ALICE, "Alice@Example.com", ` ${ALICE} `]) {
      const hashedAs: string = user.trim() === ALICE ? TOKEN : MIXED_TOKEN;

      expect(
        planStampRewrite(
          stamped({ stamp: ALICE, principal: { user, hashedAs } }),
          CONTEXT,
        ),
      ).toEqual({
        id: "event-1",
        time: "1764000000000000001",
        value: hashedAs,
        indicatorId: erasedIdOf(hashedAs),
      });
    }
  });

  test("the user acted on, as well as the one who acted", () => {
    expect(
      planStampRewrite(
        stamped({
          stamp: ALICE,
          principal: { user: "service-account" },
          target: { user: ALICE, hashedAs: TOKEN },
        }),
        CONTEXT,
      )?.value,
    ).toBe(TOKEN);
  });

  test("what the rule left around the token stays around it", () => {
    const hashedAs: string = `auth0|${TOKEN}`;

    expect(
      planStampRewrite(
        stamped({
          stamp: `auth0|${ALICE}`,
          principal: { user: `auth0|${ALICE}`, hashedAs },
        }),
        CONTEXT,
      ),
    ).toMatchObject({ value: hashedAs, indicatorId: erasedIdOf(hashedAs) });
  });

  test("a stamp about anything else the event names is not the person's", () => {
    for (const stamp of [
      "198.51.100.4",
      "evil.example.net",
      "bob@example.com",
    ]) {
      expect(
        planStampRewrite(
          stamped({ stamp, principal: { user: ALICE, hashedAs: TOKEN } }),
          CONTEXT,
        ),
      ).toBeNull();
    }
  });

  test("another person's user, named by a token the request does not erase, is not the person's", () => {
    expect(
      planStampRewrite(
        stamped({
          stamp: "bob@example.com",
          principal: { user: "bob@example.com", hashedAs: BOB_TOKEN },
        }),
        CONTEXT,
      ),
    ).toBeNull();
  });

  test("on an event an erasure un-named: theirs when it is a name that left the event's token", () => {
    expect(
      planStampRewrite(
        stamped({
          stamp: ALICE,
          principal: { user: TOKEN, scrubbed: TOKEN, isErased: true },
        }),
        CONTEXT,
      ),
    ).toMatchObject({ value: TOKEN, indicatorId: erasedIdOf(TOKEN) });

    // The vault's spelling, which the enricher lower-cased.
    expect(
      planStampRewrite(
        stamped({
          stamp: ALICE,
          principal: {
            user: MIXED_TOKEN,
            scrubbed: MIXED_TOKEN,
            isErased: true,
          },
        }),
        CONTEXT,
      ),
    ).toMatchObject({ value: MIXED_TOKEN });
  });

  test("on an event an erasure un-named, a name of another token, no name at all, or no erasure's marker: left", () => {
    // A name, but one that left another token.
    expect(
      planStampRewrite(
        stamped({
          stamp: ALICE,
          principal: { user: TOKEN, scrubbed: TOKEN, isErased: true },
        }),
        { ...CONTEXT, names: [{ named: ALICE, hashed: BOB_TOKEN }] },
      ),
    ).toBeNull();

    // A request that knows no name: nothing proves the stamp is theirs.
    expect(
      planStampRewrite(
        stamped({
          stamp: ALICE,
          principal: { user: TOKEN, scrubbed: TOKEN, isErased: true },
        }),
        { ...CONTEXT, names: [] },
      ),
    ).toBeNull();

    // A scrub rule hid the user; no erasure took them out.
    expect(
      planStampRewrite(
        stamped({
          stamp: ALICE,
          principal: { user: TOKEN, scrubbed: TOKEN, isErased: false },
        }),
        CONTEXT,
      ),
    ).toBeNull();
  });

  test("a stamp that holds a token already, or an event with no id, needs nothing", () => {
    expect(
      planStampRewrite(
        stamped({ stamp: TOKEN, principal: { user: ALICE, hashedAs: TOKEN } }),
        CONTEXT,
      ),
    ).toBeNull();
    expect(
      planStampRewrite(
        stamped({
          id: "",
          stamp: ALICE,
          principal: { user: ALICE, hashedAs: TOKEN },
        }),
        CONTEXT,
      ),
    ).toBeNull();
    expect(
      planStampRewrite(
        stamped({ stamp: "", principal: { user: ALICE, hashedAs: TOKEN } }),
        CONTEXT,
      ),
    ).toBeNull();
  });

  test("the erased indicator id: the keyed fingerprint of what the rule left, never of the person", () => {
    const rewrite: StampRewrite = planStampRewrite(
      stamped({ stamp: ALICE, principal: { user: ALICE, hashedAs: TOKEN } }),
      CONTEXT,
    )!;

    expect(isErasedIndicatorId(rewrite.indicatorId)).toBe(true);
    expect(rewrite.indicatorId).toBe(
      `[INDICATOR:${DetectionFingerprint.of({ projectId: PROJECT_ID, kind: DetectionFingerprintKind.ThreatIntel, value: TOKEN })}]`,
    );

    for (const name of NAMES) {
      for (const kind of [
        DetectionFingerprintKind.ThreatIntel,
        DetectionFingerprintKind.DetectionRule,
      ]) {
        expect(rewrite.indicatorId).not.toContain(
          DetectionFingerprint.of({
            projectId: PROJECT_ID,
            kind,
            value: name.named,
          }),
        );
        expect(rewrite.indicatorId).not.toContain(
          DetectionFingerprint.legacyOf({ kind, value: name.named }),
        );
      }

      expect(rewrite.indicatorId).not.toContain(
        MetricSeriesFingerprint.computeFingerprint({ groupValue: name.named }),
      );
    }
  });
});

describe("the mutations that rewrite the stamps", () => {
  function rewrite(id: string, time: string, value: string): StampRewrite {
    return { id, time, value, indicatorId: erasedIdOf(value) };
  }

  test("one for each stamp that goes in, its events in time order, each once", () => {
    const mutations: Array<StampsMutation> = batchStampRewrites([
      rewrite("b", "1764000000000000002", TOKEN),
      rewrite("a", "1764000000000000001", TOKEN),
      rewrite("a", "1764000000000000001", TOKEN),
      rewrite("c", "1764000000000000003", MIXED_TOKEN),
    ]);

    expect(mutations).toEqual([
      {
        value: TOKEN,
        indicatorId: erasedIdOf(TOKEN),
        ids: ["a", "b"],
        fromTime: "1764000000000000001",
        toTime: "1764000000000000002",
      },
      {
        value: MIXED_TOKEN,
        indicatorId: erasedIdOf(MIXED_TOKEN),
        ids: ["c"],
        fromTime: "1764000000000000003",
        toTime: "1764000000000000003",
      },
    ]);
  });

  test("at most MAX_STAMPS_PER_MUTATION events each", () => {
    const rewrites: Array<StampRewrite> = Array.from(
      { length: MAX_STAMPS_PER_MUTATION + 5 },
      (_value: unknown, index: number): StampRewrite => {
        return rewrite(
          `e${String(index).padStart(5, "0")}`,
          String(BigInt("1764000000000000000") + BigInt(index)),
          TOKEN,
        );
      },
    );
    const mutations: Array<StampsMutation> = batchStampRewrites(rewrites);

    expect(mutations).toHaveLength(2);
    expect(mutations[0]!.ids).toHaveLength(MAX_STAMPS_PER_MUTATION);
    expect(mutations[1]!.ids).toHaveLength(5);
    expect(batchStampRewrites(rewrites, 3)).toHaveLength(
      Math.ceil((MAX_STAMPS_PER_MUTATION + 5) / 3),
    );
  });

  test("none for no stamps", () => {
    expect(batchStampRewrites([])).toEqual([]);
  });
});

describe("what the erasure sends ClickHouse about the stamps", () => {
  test("the read: the project's stamped events that hold one of the tokens as a user's, through the Distributed table", () => {
    const statement: Statement =
      SecurityUserErasureThreatStamps.toStampedEventsStatement({
        projectId: PROJECT_ID,
        tokens: TOKENS,
        limit: 5000,
      });

    expect(statement.query).toMatch(
      new RegExp(
        `^SELECT _id AS stampedEventId, toString\\(toUnixTimestamp64Nano\\(time\\)\\) AS stampedEventTime, attributes\\[\\{p\\d+:String\\}\\] AS stampedValue, principalUser AS principalStampedUser, attributes\\[\\{p\\d+:String\\}\\] AS principalStampedHashedAs, `,
      ),
    );
    expect(statement.query).toMatch(
      new RegExp(` FROM \\S+\\.${EVENTS} WHERE `),
    );
    expect(statement.query).not.toContain(`${EVENTS}Local`);
    expect(statement.query).toContain(
      "AND NOT has(arrayMap(observable -> lowerUTF8(observable), observables), lowerUTF8(attributes[",
    );
    expect(statement.query).toMatch(/ORDER BY time, _id LIMIT \{p\d+:Int32\}$/);
    expect(parameterValues(statement)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
        HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal],
        HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Target],
        SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Principal].scrubbed,
        SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Target].scrubbed,
        ERASED_USER_ATTRIBUTES[ScrubbedUserRole.Principal],
        ERASED_USER_ATTRIBUTES[ScrubbedUserRole.Target],
        USER_ERASED_ON_REQUEST,
        TOKENS,
        5000,
      ]),
    );

    // Balanced: the conditions each close where they open.
    expect(statement.query.split("(").length).toBe(
      statement.query.split(")").length,
    );

    const next: Statement =
      SecurityUserErasureThreatStamps.toStampedEventsStatement({
        projectId: PROJECT_ID,
        tokens: TOKENS,
        after: { time: "1764000000000000123", id: "last-id" },
        limit: 10,
      });

    expect(next.query).toMatch(
      /AND time >= fromUnixTimestamp64Nano\(\{p\d+:Int64\}\) AND \(toUnixTimestamp64Nano\(time\), _id\) > \(\{p\d+:Int64\}, \{p\d+:String\}\) ORDER BY time, _id/,
    );
    expect(parameterValues(next)).toEqual(
      expect.arrayContaining(["1764000000000000123", "last-id", 10]),
    );
  });

  test("the rewrite: a mutation on the local table, ON CLUSTER, of the events by id in the stretch they happened", () => {
    const statement: Statement =
      SecurityUserErasureThreatStamps.toRewriteStampsStatement({
        projectId: PROJECT_ID,
        mutation: {
          value: TOKEN,
          indicatorId: erasedIdOf(TOKEN),
          ids: ["event-a", "event-b"],
          fromTime: "1764000000000000001",
          toTime: "1764000000000000009",
        },
      });

    expect(statement.query).toMatch(
      new RegExp(
        `^ALTER TABLE \\S+\\.${EVENTS}Local ON CLUSTER '[^']+' UPDATE attributes = mapUpdate\\(attributes, map\\(\\{p\\d+:String\\}, \\{p\\d+:String\\}, \\{p\\d+:String\\}, \\{p\\d+:String\\}\\)\\), attributeKeys = mapKeys\\(mapUpdate\\(attributes, map\\(`,
      ),
    );
    expect(statement.query).toMatch(
      /WHERE projectId = \{p\d+:String\} AND time >= fromUnixTimestamp64Nano\(\{p\d+:Int64\}\) AND time <= fromUnixTimestamp64Nano\(\{p\d+:Int64\}\) AND _id IN \(\{p\d+:Array\(String\)\}\)$/,
    );
    expect(parameterValues(statement)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
        ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
        TOKEN,
        erasedIdOf(TOKEN),
        ["event-a", "event-b"],
        "1764000000000000001",
        "1764000000000000009",
      ]),
    );
  });

  test("neither statement holds the person, a fingerprint of them, or the feed's indicator", () => {
    const rewrite: StampRewrite = planStampRewrite(
      stamped({ stamp: ALICE, principal: { user: ALICE, hashedAs: TOKEN } }),
      CONTEXT,
    )!;

    for (const statement of [
      SecurityUserErasureThreatStamps.toStampedEventsStatement({
        projectId: PROJECT_ID,
        tokens: TOKENS,
        after: { time: rewrite.time, id: rewrite.id },
        limit: 10,
      }),
      SecurityUserErasureThreatStamps.toRewriteStampsStatement({
        projectId: PROJECT_ID,
        mutation: batchStampRewrites([rewrite])[0]!,
      }),
    ]) {
      const sent: string = sentText(statement).toLowerCase();

      expect(sent).not.toContain("alice");
      expect(sent).not.toContain("example.com");
      expect(sent).not.toContain(STIX_ID);
      expect(sent).not.toContain("indicator--");
      // The attribute keys are parameters.
      expect(statement.query).not.toContain("threat.");
      expect(statement.query).not.toMatch(/oneuptime\.(principal|target)_/);

      for (const name of NAMES) {
        for (const kind of [
          DetectionFingerprintKind.ThreatIntel,
          DetectionFingerprintKind.DetectionRule,
        ]) {
          expect(sent).not.toContain(
            DetectionFingerprint.of({
              projectId: PROJECT_ID,
              kind,
              value: name.named,
            }),
          );
          expect(sent).not.toContain(
            DetectionFingerprint.legacyOf({ kind, value: name.named }),
          );
        }
      }
    }
  });
});

describe("reading and rewriting the stamps", () => {
  // The rows ClickHouse answers, a page at a time after each cursor.
  function answerPages(pages: Array<Array<Record<string, unknown>>>): {
    statements: Array<Statement>;
  } {
    const statements: Array<Statement> = [];
    let page: number = 0;

    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockImplementation(async (statement: unknown): Promise<never> => {
        statements.push(statement as Statement);

        const data: Array<Record<string, unknown>> = pages[page] || [];

        page++;

        return {
          json: async () => {
            return { data };
          },
        } as never;
      });

    return { statements };
  }

  function answerRow(
    index: number,
    stamp: string,
    user: string = ALICE,
  ): Record<string, unknown> {
    return {
      stampedEventId: `e${index}`,
      stampedEventTime: String(BigInt("1764000000000000000") + BigInt(index)),
      stampedValue: stamp,
      principalStampedUser: user,
      principalStampedHashedAs: user === ALICE ? TOKEN : "",
      principalStampedScrubbed: "",
      principalStampedErased: "",
      targetStampedUser: "",
      targetStampedHashedAs: "",
      targetStampedScrubbed: "",
      targetStampedErased: "",
    };
  }

  test("reads every page on from the last row read, and matches each stamp to the person in the worker", async () => {
    const { statements } = answerPages([
      [answerRow(0, ALICE), answerRow(1, "198.51.100.4")],
      [answerRow(2, ALICE)],
    ]);

    const rewrites: Array<StampRewrite> =
      await SecurityUserErasureThreatStamps.findStampRewrites({
        ...CONTEXT,
        pageSize: 2,
      });

    expect(
      rewrites.map((rewrite: StampRewrite): string => {
        return rewrite.id;
      }),
    ).toEqual(["e0", "e2"]);
    expect(statements).toHaveLength(2);
    expect(parameterValues(statements[1]!)).toEqual(
      expect.arrayContaining(["e1", "1764000000000000001"]),
    );
  });

  test("stops at its cap, so a run never takes on more than it can write", async () => {
    answerPages([
      [answerRow(0, ALICE), answerRow(1, ALICE), answerRow(2, ALICE)],
    ]);

    expect(
      await SecurityUserErasureThreatStamps.findStampRewrites({
        ...CONTEXT,
        maxRewrites: 2,
      }),
    ).toHaveLength(2);
  });

  test("with no token of today's form, reads nothing", async () => {
    const { statements } = answerPages([[answerRow(0, ALICE)]]);

    expect(
      await SecurityUserErasureThreatStamps.findStampRewrites({
        ...CONTEXT,
        tokens: ["[HASHED:8c87b489]", "not-a-token"],
      }),
    ).toEqual([]);
    expect(statements).toHaveLength(0);
  });

  test("queues one mutation for each batch, and counts the events they change", async () => {
    answerPages([[answerRow(0, ALICE), answerRow(1, ALICE)]]);

    const executed: Array<Statement> = [];

    jest
      .spyOn(SecurityEventService, "execute")
      .mockImplementation(async (statement: unknown): Promise<never> => {
        executed.push(statement as Statement);
        return undefined as never;
      });

    expect(await SecurityUserErasureThreatStamps.rewriteStamps(CONTEXT)).toBe(
      2,
    );
    expect(executed).toHaveLength(1);
    expect(executed[0]!.query).toContain("ALTER TABLE");
    expect(parameterValues(executed[0]!)).toEqual(
      expect.arrayContaining([["e0", "e1"], TOKEN, erasedIdOf(TOKEN)]),
    );
  });

  test("says whether any stamp of the person is left, reading no further than the first", async () => {
    const { statements } = answerPages([[answerRow(0, ALICE)]]);

    expect(await SecurityUserErasureThreatStamps.hasStampsLeft(CONTEXT)).toBe(
      true,
    );
    expect(statements).toHaveLength(1);

    answerPages([[answerRow(0, "198.51.100.4")]]);

    expect(await SecurityUserErasureThreatStamps.hasStampsLeft(CONTEXT)).toBe(
      false,
    );
  });
});
