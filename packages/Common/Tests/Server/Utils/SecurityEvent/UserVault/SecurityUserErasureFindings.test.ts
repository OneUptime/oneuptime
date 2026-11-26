import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import JobDeadline from "../../../../../Server/Utils/JobDeadline";
import SecurityUserErasureFindings, {
  ERASURE_FINDINGS_VENDOR,
  FINDING_NAMING_ATTRIBUTES,
  FINDING_USER_ERASED_ATTRIBUTE,
  FindingRewrite,
  FindingsMutation,
  FindingsScanResult,
  MAX_FINDINGS_PER_MUTATION,
  batchFindingRewrites,
  getFindingReplacement,
  planFindingRewrite,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureFindings";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "../../../../../Types/ObjectID";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_SUMMARY_ATTRIBUTE,
} from "../../../../../Types/SecurityEvent/DetectionFindingConstants";
import { THREAT_INDICATOR_VALUE_ATTRIBUTE } from "../../../../../Types/SecurityEvent/ThreatIntelConstants";
import { USER_ERASED_ON_REQUEST } from "../../../../../Utils/SecurityEvent/ScrubbedUser";
import { ErasedName } from "../../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE DETECTION FINDINGS AN ERASURE TAKES THE PERSON OUT OF (#11044): which
 * findings it changes and how, worked out in the worker - every observable
 * that is a name, what goes in its place, and the mutations that share a
 * change - and what it sends ClickHouse to read and change them: the
 * project, the class, ids, tokens and lengths, never the person. The
 * statements run on real servers in SecurityUserErasureClickhouse (26.7
 * and 24.8) and SecurityUserErasureKeeperClickhouse (two replicas).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11044000-0000-4000-8000-0000000000a1",
);

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

const ALICE: string = "alice@example.com";
const TOKEN: string = tokenOf(ALICE);
const OTHER_TOKEN: string = tokenOf("Alice@Example.com");

const NAMES: Array<ErasedName> = [
  { named: ALICE, hashed: TOKEN },
  { named: "Alice@Example.com", hashed: OTHER_TOKEN },
  { named: `auth0|${ALICE}`, hashed: `auth0|${TOKEN}` },
];

const EVENTS: string = new SecurityEvent().tableName;

function parameterValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params as Record<string, unknown>);
}

function sentText(statement: Statement): string {
  return `${statement.query} ${JSON.stringify(statement.query_params)}`;
}

describe("what goes in place of an observable that is a name", () => {
  test("the token alone, when the rule left nothing else", () => {
    expect(getFindingReplacement({ named: ALICE, hashed: TOKEN }, 2)).toEqual({
      position: 2,
      prefixBytes: 0,
      token: TOKEN,
      suffixBytes: 0,
    });
  });

  test("the bytes the rule left whole around the token, by their lengths only", () => {
    expect(
      getFindingReplacement(
        { named: `auth0|${ALICE}`, hashed: `auth0|${TOKEN}` },
        1,
      ),
    ).toEqual({ position: 1, prefixBytes: 6, token: TOKEN, suffixBytes: 0 });
    expect(
      getFindingReplacement(
        { named: `Alice Smith <${ALICE}>`, hashed: `Alice Smith <${TOKEN}>` },
        1,
      ),
    ).toEqual({ position: 1, prefixBytes: 13, token: TOKEN, suffixBytes: 1 });
  });

  test("lengths in bytes, as ClickHouse's left() and right() count them", () => {
    // "Zoë " is 5 bytes in UTF-8, and 4 characters.
    expect(
      getFindingReplacement(
        { named: `Zoë <${ALICE}>`, hashed: `Zoë <${TOKEN}>` },
        1,
      ),
    ).toEqual({ position: 1, prefixBytes: 6, token: TOKEN, suffixBytes: 1 });
  });

  test("two tokens, or a name that does not line up with what the rule left: the tokens alone, nothing of the observable", () => {
    const second: string = tokenOf("bob@example.com");

    expect(
      getFindingReplacement(
        {
          named: `${ALICE} / bob@example.com`,
          hashed: `${TOKEN} / ${second}`,
        },
        3,
      ),
    ).toEqual({
      position: 3,
      prefixBytes: 0,
      token: `${TOKEN} ${second}`,
      suffixBytes: 0,
    });
    expect(
      getFindingReplacement(
        { named: "somebody else", hashed: `auth0|${TOKEN}` },
        1,
      ),
    ).toEqual({ position: 1, prefixBytes: 0, token: TOKEN, suffixBytes: 0 });
  });

  test("none for a name whose hashed form holds no token of today's form", () => {
    expect(
      getFindingReplacement({ named: ALICE, hashed: "[HASHED:8c87b489]" }, 1),
    ).toBeNull();
  });
});

describe("which findings name the person, and the change each needs", () => {
  test("each observable that is exactly one of the names, in its place, counted from 1", () => {
    const rewrite: FindingRewrite | null = planFindingRewrite(
      {
        id: "a",
        time: "1764000000000000001",
        observables: [
          ALICE,
          "203.0.113.7",
          "Alice@Example.com",
          `auth0|${ALICE}`,
        ],
      },
      NAMES,
    );

    expect(rewrite).toEqual({
      id: "a",
      time: "1764000000000000001",
      replacements: [
        { position: 1, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
        { position: 3, prefixBytes: 0, token: OTHER_TOKEN, suffixBytes: 0 },
        { position: 4, prefixBytes: 6, token: TOKEN, suffixBytes: 0 },
      ],
    });
  });

  test("never a name inside another observable, another case of a user id, or a token already in place", () => {
    expect(
      planFindingRewrite(
        {
          id: "b",
          time: "1",
          observables: [
            `m${ALICE}`,
            `${ALICE} (admin)`,
            "ALICE@EXAMPLE.COM",
            TOKEN,
            `auth0|${TOKEN}`,
          ],
        },
        NAMES,
      ),
    ).toBeNull();
  });

  test("a name that is no name - empty, or what the rule left already - finds nothing", () => {
    expect(
      planFindingRewrite({ id: "c", time: "1", observables: ["", TOKEN] }, [
        { named: "", hashed: TOKEN },
        { named: TOKEN, hashed: TOKEN },
      ]),
    ).toBeNull();
  });
});

describe("the mutations that make the changes", () => {
  function rewrite(id: string, time: string, position: number): FindingRewrite {
    return {
      id,
      time,
      replacements: [
        { position, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
      ],
    };
  }

  test("findings that need the same change share one, in the order they were written, with the stretch of time they span", () => {
    const mutations: Array<FindingsMutation> = batchFindingRewrites([
      rewrite("c", "30", 1),
      rewrite("a", "10", 1),
      rewrite("x", "20", 2),
      rewrite("b", "20", 1),
    ]);

    expect(mutations).toEqual([
      {
        replacements: [
          { position: 1, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
        ],
        ids: ["a", "b", "c"],
        fromTime: "10",
        toTime: "30",
      },
      {
        replacements: [
          { position: 2, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
        ],
        ids: ["x"],
        fromTime: "20",
        toTime: "20",
      },
    ]);
  });

  test("at most so many findings to a mutation, each batch its own stretch of time", () => {
    const rewrites: Array<FindingRewrite> = Array.from(
      { length: 5 },
      (_value: unknown, index: number): FindingRewrite => {
        return rewrite(`f${index}`, String(100 + index), 1);
      },
    );

    const mutations: Array<FindingsMutation> = batchFindingRewrites(
      rewrites,
      2,
    );

    expect(
      mutations.map((mutation: FindingsMutation): Array<string> => {
        return [mutation.fromTime, mutation.toTime, ...mutation.ids];
      }),
    ).toEqual([
      ["100", "101", "f0", "f1"],
      ["102", "103", "f2", "f3"],
      ["104", "104", "f4"],
    ]);
    expect(MAX_FINDINGS_PER_MUTATION).toBeGreaterThanOrEqual(100);
  });

  test("times are nanoseconds as text, compared as numbers, beyond what a JavaScript number holds", () => {
    const mutations: Array<FindingsMutation> = batchFindingRewrites([
      rewrite("later", "1764000000000000002", 1),
      rewrite("earlier", "1764000000000000001", 1),
      rewrite("earliest", "999999999999999999", 1),
    ]);

    expect(mutations[0]!.ids).toEqual(["earliest", "earlier", "later"]);
    expect(mutations[0]!.fromTime).toBe("999999999999999999");
    expect(mutations[0]!.toTime).toBe("1764000000000000002");
  });

  test("none for no findings", () => {
    expect(batchFindingRewrites([])).toEqual([]);
  });
});

describe("what the erasure sends ClickHouse about the findings", () => {
  test("the read: the project's own Detection Findings, through the Distributed table, in the order they were written", () => {
    const first: Statement =
      SecurityUserErasureFindings.toFindingsPageStatement({
        projectId: PROJECT_ID,
        limit: 5000,
      });

    expect(first.query).toMatch(
      new RegExp(
        `^SELECT _id AS findingId, toString\\(toUnixTimestamp64Nano\\(time\\)\\) AS findingTime, observables FROM \\S+\\.${EVENTS} WHERE projectId = \\{p\\d+:String\\} AND className = \\{p\\d+:String\\} AND vendorName = \\{p\\d+:String\\} ORDER BY time, _id LIMIT \\{p\\d+:Int32\\}$`,
      ),
    );
    expect(first.query).not.toContain(`${EVENTS}Local`);
    expect(parameterValues(first)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        DETECTION_FINDING_CLASS_NAME,
        ERASURE_FINDINGS_VENDOR,
        5000,
      ]),
    );

    // The next page: after the last one read, by its time to the nanosecond and its id.
    const next: Statement = SecurityUserErasureFindings.toFindingsPageStatement(
      {
        projectId: PROJECT_ID,
        after: { time: "1764000000000000123", id: "last-id" },
        limit: 5000,
      },
    );

    expect(next.query).toContain("AND time >= fromUnixTimestamp64Nano({p");
    expect(next.query).toMatch(
      /AND \(toUnixTimestamp64Nano\(time\), _id\) > \(\{p\d+:Int64\}, \{p\d+:String\}\) ORDER BY time, _id/,
    );
    expect(parameterValues(next)).toEqual(
      expect.arrayContaining(["1764000000000000123", "last-id"]),
    );
  });

  test("the update: a mutation on the local table, ON CLUSTER, of the findings by id in the stretch they were written", () => {
    const statement: Statement =
      SecurityUserErasureFindings.toUnnameFindingsStatement({
        projectId: PROJECT_ID,
        mutation: {
          replacements: [
            { position: 1, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
            { position: 4, prefixBytes: 6, token: TOKEN, suffixBytes: 0 },
          ],
          ids: ["finding-a", "finding-b"],
          fromTime: "1764000000000000001",
          toTime: "1764000000000000009",
        },
      });

    expect(statement.query).toMatch(
      new RegExp(
        `^ALTER TABLE \\S+\\.${EVENTS}Local ON CLUSTER '[^']+' UPDATE observables = arrayMap\\(\\(observable, observablePosition\\) -> multiIf\\(observablePosition = \\{p\\d+:Int32\\}, concat\\(left\\(observable, `,
      ),
    );
    expect(statement.query).toContain(", message = replaceRegexpAll(");
    expect(statement.query).toContain(
      ", attributes = mapUpdate(mapApply((attributeKey, attributeValue) -> (attributeKey, if(has(",
    );
    expect(statement.query).toContain(", attributeKeys = mapKeys(mapUpdate(");
    expect(statement.query).toContain("regexpQuoteMeta(observables[1])");
    expect(statement.query).toContain("regexpQuoteMeta(observables[4])");
    expect(statement.query).toMatch(
      /WHERE projectId = \{p\d+:String\} AND className = \{p\d+:String\} AND vendorName = \{p\d+:String\} AND time >= fromUnixTimestamp64Nano\(\{p\d+:Int64\}\) AND time <= fromUnixTimestamp64Nano\(\{p\d+:Int64\}\) AND _id IN \(\{p\d+:Array\(String\)\}\)$/,
    );
    expect(parameterValues(statement)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        DETECTION_FINDING_CLASS_NAME,
        ERASURE_FINDINGS_VENDOR,
        "1764000000000000001",
        "1764000000000000009",
        ["finding-a", "finding-b"],
        [...FINDING_NAMING_ATTRIBUTES],
        FINDING_USER_ERASED_ATTRIBUTE,
        USER_ERASED_ON_REQUEST,
        TOKEN,
        6,
      ]),
    );
  });

  test("each observable twice over the message and the attributes: two of a value side by side share the text between them", () => {
    const statement: Statement =
      SecurityUserErasureFindings.toUnnameFindingsStatement({
        projectId: PROJECT_ID,
        mutation: {
          replacements: [
            { position: 2, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
          ],
          ids: ["a"],
          fromTime: "1",
          toTime: "1",
        },
      });

    // Twice for the message, twice in each of the two copies of the attributes.
    expect(statement.query.split("replaceRegexpAll(").length - 1).toBe(6);
    expect(
      statement.query.split("regexpQuoteMeta(observables[2])").length - 1,
    ).toBe(6);
  });

  test("the attributes it changes are those that repeat what a finding is about", () => {
    expect([...FINDING_NAMING_ATTRIBUTES].sort()).toEqual(
      [
        DETECTION_GROUP_VALUE_ATTRIBUTE,
        DETECTION_SUMMARY_ATTRIBUTE,
        THREAT_INDICATOR_VALUE_ATTRIBUTE,
      ].sort(),
    );
  });

  test("no value is spelt into a statement's text, and none is the person", () => {
    const rewrite: FindingRewrite = planFindingRewrite(
      {
        id: ObjectID.generate().toString(),
        time: "1764000000000000001",
        observables: [
          `Alice Smith <${ALICE}>`,
          ALICE,
          "Alice@Example.com",
          `auth0|${ALICE}`,
        ],
      },
      [
        ...NAMES,
        { named: `Alice Smith <${ALICE}>`, hashed: `Alice Smith <${TOKEN}>` },
      ],
    )!;

    const statements: Array<Statement> = [
      SecurityUserErasureFindings.toFindingsPageStatement({
        projectId: PROJECT_ID,
        after: { time: rewrite.time, id: rewrite.id },
        limit: 10,
      }),
      SecurityUserErasureFindings.toUnnameFindingsStatement({
        projectId: PROJECT_ID,
        mutation: batchFindingRewrites([rewrite])[0]!,
      }),
    ];

    for (const statement of statements) {
      expect(statement.query).not.toContain("HASHED");
      expect(statement.query).not.toContain(PROJECT_ID.toString());
      expect(statement.query).not.toContain(DETECTION_FINDING_CLASS_NAME);
      // The attribute keys are parameters too.
      expect(statement.query).not.toContain("oneuptime.detection");
      expect(statement.query).not.toContain("oneuptime.threat");
      expect(statement.query).not.toContain("oneuptime.finding");

      const sent: string = sentText(statement).toLowerCase();

      expect(sent).not.toContain("alice");
      expect(sent).not.toContain("smith");
      expect(sent).not.toContain("example.com");
      expect(sent).not.toContain("auth0");
    }
  });
});

describe("reading a project's findings for the names", () => {
  let pages: Array<Array<Record<string, unknown>>>;
  let sent: Array<Statement>;

  function finding(
    id: string,
    time: string,
    observables: Array<string>,
  ): Record<string, unknown> {
    return { findingId: id, findingTime: time, observables };
  }

  beforeEach((): void => {
    pages = [];
    sent = [];

    jest.spyOn(SecurityEventService, "executeQuery").mockImplementation((async (
      statement: Statement,
    ): Promise<unknown> => {
      sent.push(statement);
      const page: Array<Record<string, unknown>> = pages.shift() || [];

      return {
        json: async (): Promise<unknown> => {
          return { data: page };
        },
      };
    }) as never);
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("page after page from where the last one ended, until a page comes back short", async () => {
    pages = [
      [finding("a", "10", [ALICE]), finding("b", "10", ["203.0.113.7"])],
      [
        finding("c", "11", ["bob@example.com"]),
        finding("d", "12", ["203.0.113.7", `auth0|${ALICE}`]),
      ],
      [finding("e", "13", [ALICE])],
    ];

    const found: FindingsScanResult =
      await SecurityUserErasureFindings.findNamingFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        pageSize: 2,
      });

    expect(
      found.rewrites.map((rewrite: FindingRewrite): string => {
        return rewrite.id;
      }),
    ).toEqual(["a", "d", "e"]);
    expect(found.isCapped).toBe(false);
    expect(sent).toHaveLength(3);
    expect(parameterValues(sent[1]!)).toEqual(
      expect.arrayContaining(["10", "b"]),
    );
    expect(parameterValues(sent[2]!)).toEqual(
      expect.arrayContaining(["12", "d"]),
    );
  });

  test("stops at the first that names the person, when that is all the check needs", async () => {
    pages = [
      [finding("a", "10", ["x"]), finding("b", "10", [ALICE])],
      [finding("c", "11", [ALICE])],
    ];

    expect(
      await SecurityUserErasureFindings.isAnyFindingNaming({
        projectId: PROJECT_ID,
        names: NAMES,
      }),
    ).toBe(true);
    expect(sent).toHaveLength(1);
  });

  test("keeps at most as many as a run changes, and says there may be more", async () => {
    pages = [
      [
        finding("a", "10", [ALICE]),
        finding("b", "11", [ALICE]),
        finding("c", "12", [ALICE]),
      ],
    ];

    const found: FindingsScanResult =
      await SecurityUserErasureFindings.findNamingFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        maxRewrites: 2,
      });

    expect(found.rewrites).toHaveLength(2);
    expect(found.isCapped).toBe(true);
  });

  test("reads nothing for no names, and finds nothing in an empty project", async () => {
    expect(
      await SecurityUserErasureFindings.findNamingFindings({
        projectId: PROJECT_ID,
        names: [],
      }),
    ).toEqual({ rewrites: [], isCapped: false });
    expect(sent).toHaveLength(0);

    expect(
      await SecurityUserErasureFindings.isAnyFindingNaming({
        projectId: PROJECT_ID,
        names: NAMES,
      }),
    ).toBe(false);
    expect(sent).toHaveLength(1);
  });

  test("past its own time limit it throws, so the run is tried again rather than taken as done", async () => {
    pages = [[finding("a", "10", ["x"])], [finding("b", "11", ["x"])]];

    await expect(
      SecurityUserErasureFindings.findNamingFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        pageSize: 1,
        timeLimitMs: -1,
      }),
    ).rejects.toThrow(
      "Security Events could not read all of the project's Detection Findings",
    );
  });

  test("stops between pages once the run's deadline has passed", async () => {
    const deadline: JobDeadline = new JobDeadline();

    pages = [[finding("a", "10", ["x"])], [finding("b", "11", [ALICE])]];

    jest.spyOn(SecurityEventService, "executeQuery").mockImplementation((async (
      statement: Statement,
    ): Promise<unknown> => {
      sent.push(statement);
      const page: Array<Record<string, unknown>> = pages.shift() || [];

      // The run runs out of time while the first page is read.
      deadline.end();

      return {
        json: async (): Promise<unknown> => {
          return { data: page };
        },
      };
    }) as never);

    await expect(
      SecurityUserErasureFindings.findNamingFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        pageSize: 1,
        deadline,
      }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });

  test("a row with no id is never changed", async () => {
    pages = [[finding("", "10", [ALICE])]];

    expect(
      (
        await SecurityUserErasureFindings.findNamingFindings({
          projectId: PROJECT_ID,
          names: NAMES,
        })
      ).rewrites,
    ).toEqual([]);
  });
});

describe("changing the findings", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("one mutation for each change and batch, each as ClickHouse holds it, and how many findings they change", async () => {
    const executed: Array<Statement> = [];

    jest.spyOn(SecurityEventService, "execute").mockImplementation((async (
      statement: Statement,
    ): Promise<unknown> => {
      executed.push(statement);
      return {};
    }) as never);

    const changed: number = await SecurityUserErasureFindings.unnameFindings({
      projectId: PROJECT_ID,
      rewrites: [
        planFindingRewrite(
          { id: "a", time: "1", observables: [ALICE] },
          NAMES,
        )!,
        planFindingRewrite(
          { id: "b", time: "2", observables: [ALICE] },
          NAMES,
        )!,
        planFindingRewrite(
          { id: "c", time: "3", observables: ["x", ALICE] },
          NAMES,
        )!,
      ],
    });

    expect(changed).toBe(3);
    expect(executed).toHaveLength(2);
    expect(parameterValues(executed[0]!)).toEqual(
      expect.arrayContaining([["a", "b"]]),
    );
    expect(parameterValues(executed[1]!)).toEqual(
      expect.arrayContaining([["c"]]),
    );
  });

  test("nothing to change: nothing sent", async () => {
    const execute: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityEventService,
      "execute",
    );

    expect(
      await SecurityUserErasureFindings.unnameFindings({
        projectId: PROJECT_ID,
        rewrites: [],
      }),
    ).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
