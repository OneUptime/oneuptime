import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import JobDeadline from "../../../../../Server/Utils/JobDeadline";
import DetectionFingerprint, {
  DetectionFingerprintKind,
} from "../../../../../Server/Utils/SecurityEvent/DetectionFingerprint";
import SecurityUserErasureFindings, {
  ERASURE_FINDINGS_VENDOR,
  ErasureFindingRow,
  FINDING_FINGERPRINTED_ATTRIBUTE,
  FINDING_NAMING_ATTRIBUTES,
  FINDING_USER_ERASED_ATTRIBUTE,
  FindingRewrite,
  FindingsCursor,
  FindingsMutation,
  FindingsScanProgress,
  FindingsScanStep,
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
import {
  THREAT_FEED_NAME_ATTRIBUTE,
  THREAT_INDICATOR_ID_ATTRIBUTE,
  THREAT_INDICATOR_VALUE_ATTRIBUTE,
  isErasedIndicatorId,
} from "../../../../../Types/SecurityEvent/ThreatIntelConstants";
import {
  getFindingUidPlaces,
  putFingerprintAt,
} from "../../../../../Utils/SecurityEvent/DetectionFingerprintPlaces";
import { USER_ERASED_ON_REQUEST } from "../../../../../Utils/SecurityEvent/ScrubbedUser";
import { ErasedName } from "../../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
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
 * that is a name, what goes in its place, its id's new fingerprint (#11130),
 * and the mutations that share a change - and what it sends ClickHouse to
 * read and change them: the project, the class, ids, tokens, lengths and
 * keyed fingerprints of what the finding holds once the names are out,
 * never the person nor a fingerprint of them. And the read itself, on from
 * where the last one stopped (#11160). The statements run on real servers
 * in SecurityUserErasureClickhouse (26.7 and 24.8) and
 * SecurityUserErasureKeeperClickhouse (two replicas).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11044000-0000-4000-8000-0000000000a1",
);
const RULE_ID: string = "11044000-0000-4000-8000-0000000000b1";
const FEED_ID: string = "11044000-0000-4000-8000-0000000000c1";

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

const ALICE: string = "alice@example.com";
const TOKEN: string = tokenOf(ALICE);
const OTHER_TOKEN: string = tokenOf("Alice@Example.com");
const BOB_TOKEN: string = tokenOf("bob@example.com");

const NAMES: Array<ErasedName> = [
  { named: ALICE, hashed: TOKEN },
  { named: "Alice@Example.com", hashed: OTHER_TOKEN },
  { named: `auth0|${ALICE}`, hashed: `auth0|${TOKEN}` },
];
const TOKENS: Array<string> = [TOKEN, OTHER_TOKEN];

const CONTEXT: { projectId: ObjectID; tokens: Array<string> } = {
  projectId: PROJECT_ID,
  tokens: TOKENS,
};

const EVENTS: string = new SecurityEvent().tableName;

function keyed(value: string, kind?: DetectionFingerprintKind): string {
  return DetectionFingerprint.of({
    projectId: PROJECT_ID,
    kind: kind || DetectionFingerprintKind.DetectionRule,
    value,
  });
}

function unkeyed(value: string): string {
  return MetricSeriesFingerprint.computeFingerprint({ groupValue: value });
}

// A scheduled run's finding's id, with `fingerprint` in both its places.
function runUid(fingerprint: string): string {
  return `detection:${RULE_ID}:detection-rule:${RULE_ID}:${fingerprint}:run:1764000000000:each:${fingerprint}`;
}

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
    expect(
      getFindingReplacement(
        {
          named: `${ALICE} / bob@example.com`,
          hashed: `${TOKEN} / ${BOB_TOKEN}`,
        },
        3,
      ),
    ).toEqual({
      position: 3,
      prefixBytes: 0,
      token: `${TOKEN} ${BOB_TOKEN}`,
      suffixBytes: 0,
    });
    expect(
      getFindingReplacement({ named: "alice", hashed: `user-${TOKEN}` }, 1),
    ).toEqual({ position: 1, prefixBytes: 0, token: TOKEN, suffixBytes: 0 });
  });

  test("none for a name whose hashed form holds no token of today's form", () => {
    expect(
      getFindingReplacement({ named: ALICE, hashed: "[HASHED:abc]" }, 1),
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
      CONTEXT,
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
        CONTEXT,
      ),
    ).toBeNull();
  });

  test("a name that is no name - empty, or what the rule left already - finds nothing", () => {
    expect(
      planFindingRewrite(
        { id: "c", time: "1", observables: ["", TOKEN] },
        [
          { named: "", hashed: TOKEN },
          { named: TOKEN, hashed: TOKEN },
        ],
        CONTEXT,
      ),
    ).toBeNull();
  });
});

describe("a finding's id: the fingerprint of what it holds once the names are out (#11130)", () => {
  test("a scheduled run's finding gets the keyed fingerprint of the token in both its places", () => {
    for (const before of [unkeyed(ALICE), keyed(ALICE)]) {
      const rewrite: FindingRewrite | null = planFindingRewrite(
        {
          id: "a",
          time: "1",
          observables: [ALICE, "203.0.113.7"],
          eventUid: runUid(before),
          groupValue: ALICE,
        },
        NAMES,
        CONTEXT,
      );

      expect(rewrite?.uid).toEqual({
        positions: [5, 9],
        fingerprint: keyed(TOKEN),
      });
      expect(rewrite?.groupValue).toEqual({ named: ALICE, hashed: TOKEN });
      // What a rule makes when it fires on the token: the same id.
      expect(
        putFingerprintAt({
          text: runUid(before),
          places: getFindingUidPlaces(runUid(before))!,
          fingerprint: rewrite!.uid!.fingerprint,
        }),
      ).toBe(runUid(keyed(TOKEN)));
    }
  });

  test("a finding named by when it was written gets it in its one place", () => {
    const rewrite: FindingRewrite | null = planFindingRewrite(
      {
        id: "a",
        time: "1",
        observables: [`auth0|${ALICE}`],
        eventUid: `detection:${RULE_ID}:detection-rule:${RULE_ID}:${unkeyed(`auth0|${ALICE}`)}:1764000000123456789`,
        groupValue: `auth0|${ALICE}`,
      },
      NAMES,
      CONTEXT,
    );

    expect(rewrite?.uid).toEqual({
      positions: [5],
      fingerprint: keyed(`auth0|${TOKEN}`),
    });
  });

  test("a threat intel finding is fingerprinted by its indicator, as a feed fingerprints it", () => {
    const rewrite: FindingRewrite | null = planFindingRewrite(
      {
        id: "a",
        time: "1",
        observables: [ALICE],
        eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${keyed(ALICE, DetectionFingerprintKind.ThreatIntel)}:1764000000123456789`,
        groupValue: "",
        indicatorValue: ALICE,
      },
      NAMES,
      CONTEXT,
    );

    expect(rewrite?.uid).toEqual({
      positions: [5],
      fingerprint: keyed(TOKEN, DetectionFingerprintKind.ThreatIntel),
    });
  });

  test("a correlation's finding: the fingerprint of its values with each name out", () => {
    const groupValue: string = `${ALICE} / 203.0.113.7`;
    const rewrite: FindingRewrite | null = planFindingRewrite(
      {
        id: "a",
        time: "1",
        observables: [ALICE, "203.0.113.7"],
        eventUid: runUid(unkeyed(groupValue)),
        groupValue,
      },
      NAMES,
      CONTEXT,
    );

    expect(rewrite?.uid?.fingerprint).toBe(keyed(`${TOKEN} / 203.0.113.7`));
    expect(rewrite?.groupValue).toEqual({
      named: groupValue,
      hashed: `${TOKEN} / 203.0.113.7`,
    });
  });

  test("an id of another shape, or a finding about nothing, keeps its id: only its names go", () => {
    for (const row of [
      { eventUid: "imported-alert-7", groupValue: ALICE },
      { eventUid: runUid(unkeyed(ALICE)), groupValue: "" },
      { eventUid: undefined, groupValue: ALICE },
    ]) {
      const rewrite: FindingRewrite | null = planFindingRewrite(
        { id: "a", time: "1", observables: [ALICE], ...row },
        NAMES,
        CONTEXT,
      );

      expect(rewrite?.replacements).toHaveLength(1);
      expect(rewrite?.uid).toBeUndefined();
    }
  });

  test("an id an earlier erasure left: its id alone, once marked erased and holding a request's token", () => {
    const rewrite: FindingRewrite | null = planFindingRewrite(
      {
        id: "a",
        time: "1",
        observables: [TOKEN, "203.0.113.7"],
        eventUid: runUid(unkeyed(ALICE)),
        groupValue: TOKEN,
        isMarkedErased: true,
      },
      NAMES,
      CONTEXT,
    );

    expect(rewrite).toEqual({
      id: "a",
      time: "1",
      replacements: [],
      uid: { positions: [5, 9], fingerprint: keyed(TOKEN) },
    });
  });

  test("a finding that holds the token but no erasure touched, or another person's, or one already right, is left", () => {
    for (const row of [
      // Written about the token: nobody's erasure changed it.
      {
        observables: [TOKEN],
        eventUid: runUid(unkeyed(TOKEN)),
        groupValue: TOKEN,
        isMarkedErased: false,
      },
      // Another person's erasure.
      {
        observables: [BOB_TOKEN],
        eventUid: runUid(unkeyed("bob@example.com")),
        groupValue: BOB_TOKEN,
        isMarkedErased: true,
      },
      // Already the fingerprint of what it holds.
      {
        observables: [TOKEN],
        eventUid: runUid(keyed(TOKEN)),
        groupValue: TOKEN,
        isMarkedErased: true,
      },
    ]) {
      expect(
        planFindingRewrite({ id: "a", time: "1", ...row }, NAMES, CONTEXT),
      ).toBeNull();
    }
  });

  test("the new fingerprint is never of a name, keyed or not", () => {
    const rewrite: FindingRewrite = planFindingRewrite(
      {
        id: "a",
        time: "1",
        observables: [ALICE],
        eventUid: runUid(unkeyed(ALICE)),
        groupValue: ALICE,
      },
      NAMES,
      CONTEXT,
    )!;

    for (const name of NAMES) {
      expect(rewrite.uid!.fingerprint).not.toBe(keyed(name.named));
      expect(rewrite.uid!.fingerprint).not.toBe(unkeyed(name.named));
    }
  });

  test("reads the fingerprinted value from the attribute of its source", () => {
    expect(FINDING_FINGERPRINTED_ATTRIBUTE).toEqual({
      [DetectionFingerprintKind.DetectionRule]: DETECTION_GROUP_VALUE_ATTRIBUTE,
      [DetectionFingerprintKind.ThreatIntel]: THREAT_INDICATOR_VALUE_ATTRIBUTE,
    });
  });
});

/*
 * #11230: a feed can list the person's email address, and a finding about the
 * match named the feed's indicator - its id in ruleId and
 * oneuptime.threat.indicator_id, its name in ruleName - beside which the feed
 * keeps the address in clear.
 */
describe("the feed's indicator, out of a threat intel finding about the person (#11230)", () => {
  const STIX_ID: string = "indicator--8e2e2d2b-17d4-4cbf-938f-98ee46b3cd3f";
  const FEED_NAME: string = "Acme Phishing Senders";
  // A feed can name an indicator by its value: the address itself.
  const INDICATOR_NAME: string = `Phishing sender ${ALICE}`;
  const ERASED_ID: string = DetectionFingerprint.erasedIndicatorIdOf({
    projectId: PROJECT_ID,
    value: TOKEN,
  });

  function feedFinding(
    overrides: Partial<ErasureFindingRow> = {},
  ): ErasureFindingRow {
    return {
      id: "a",
      time: "1764000000000000001",
      observables: [ALICE, "203.0.113.7"],
      eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${keyed(ALICE, DetectionFingerprintKind.ThreatIntel)}:1764000000123456789`,
      groupValue: "",
      indicatorValue: ALICE,
      ruleId: STIX_ID,
      ruleName: INDICATOR_NAME,
      indicatorId: STIX_ID,
      feedName: FEED_NAME,
      ...overrides,
    };
  }

  test("the erased indicator id: the keyed fingerprint of the token, as the feed's alert and case detection carry it", () => {
    expect(ERASED_ID).toBe(
      `[INDICATOR:${keyed(TOKEN, DetectionFingerprintKind.ThreatIntel)}]`,
    );
    expect(isErasedIndicatorId(ERASED_ID)).toBe(true);
    expect(ERASED_ID).not.toMatch(/\[INDICATOR:[0-9]{16}\]/);
  });

  test("a finding about the person gets it in its id places, beside the names out and its id's new fingerprint", () => {
    const rewrite: FindingRewrite | null = planFindingRewrite(
      feedFinding(),
      NAMES,
      CONTEXT,
    );

    expect(rewrite?.replacements).toEqual([
      { position: 1, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
    ]);
    expect(rewrite?.uid?.fingerprint).toBe(
      keyed(TOKEN, DetectionFingerprintKind.ThreatIntel),
    );
    expect(rewrite?.indicator).toEqual({ id: ERASED_ID });
    // The same token the id's new fingerprint is: the match, without the indicator.
    expect(rewrite?.indicator?.id).toBe(
      `[INDICATOR:${rewrite?.uid?.fingerprint}]`,
    );
  });

  test("whichever feed it came from: a list's or Google SecOps's marker goes too", () => {
    for (const marker of ["list", "google-secops", ""]) {
      expect(
        planFindingRewrite(
          feedFinding({
            ruleId: marker,
            indicatorId: marker,
            ruleName: FEED_NAME,
          }),
          NAMES,
          CONTEXT,
        )?.indicator,
      ).toEqual({ id: ERASED_ID });
    }
  });

  test("an indicator's own name goes even where its id already went", () => {
    expect(
      planFindingRewrite(
        feedFinding({ ruleId: ERASED_ID, indicatorId: ERASED_ID }),
        NAMES,
        CONTEXT,
      )?.indicator,
    ).toEqual({ id: ERASED_ID });
  });

  test("one an earlier erasure un-named with the indicator left: the indicator alone", () => {
    const rewrite: FindingRewrite | null = planFindingRewrite(
      feedFinding({
        observables: [TOKEN, "203.0.113.7"],
        eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${keyed(TOKEN, DetectionFingerprintKind.ThreatIntel)}:1764000000123456789`,
        indicatorValue: TOKEN,
        isMarkedErased: true,
      }),
      NAMES,
      CONTEXT,
    );

    expect(rewrite).toEqual({
      id: "a",
      time: "1764000000000000001",
      replacements: [],
      indicator: { id: ERASED_ID },
    });
  });

  test("and its id too, when that was left as it was", () => {
    const rewrite: FindingRewrite | null = planFindingRewrite(
      feedFinding({
        observables: [TOKEN],
        eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${DetectionFingerprint.legacyOf({ kind: DetectionFingerprintKind.ThreatIntel, value: ALICE })}:1764000000123456789`,
        indicatorValue: TOKEN,
        isMarkedErased: true,
      }),
      NAMES,
      CONTEXT,
    );

    expect(rewrite?.uid?.fingerprint).toBe(
      keyed(TOKEN, DetectionFingerprintKind.ThreatIntel),
    );
    expect(rewrite?.indicator).toEqual({ id: ERASED_ID });
  });

  test("a finding already without its indicator is left: a run again changes nothing", () => {
    expect(
      planFindingRewrite(
        feedFinding({
          observables: [TOKEN],
          eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${keyed(TOKEN, DetectionFingerprintKind.ThreatIntel)}:1764000000123456789`,
          indicatorValue: TOKEN,
          isMarkedErased: true,
          ruleId: ERASED_ID,
          indicatorId: ERASED_ID,
          ruleName: FEED_NAME,
        }),
        NAMES,
        CONTEXT,
      ),
    ).toBeNull();
  });

  test("the feed's finding about anything else, or about another person, keeps its indicator", () => {
    for (const row of [
      // An address the feed lists: nobody's name.
      feedFinding({
        observables: ["198.51.100.4"],
        indicatorValue: "198.51.100.4",
        eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${keyed("198.51.100.4", DetectionFingerprintKind.ThreatIntel)}:1`,
      }),
      // Another person's erasure.
      feedFinding({
        observables: [BOB_TOKEN],
        indicatorValue: BOB_TOKEN,
        isMarkedErased: true,
        eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${keyed(BOB_TOKEN, DetectionFingerprintKind.ThreatIntel)}:1`,
      }),
      // The token, which no erasure touched.
      feedFinding({
        observables: [TOKEN],
        indicatorValue: TOKEN,
        isMarkedErased: false,
        eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${keyed(TOKEN, DetectionFingerprintKind.ThreatIntel)}:1`,
      }),
    ]) {
      expect(planFindingRewrite(row, NAMES, CONTEXT)).toBeNull();
    }
  });

  test("a feed's finding about another indicator keeps it, though its sample events named the person", () => {
    const address: string = "198.51.100.4";
    const aboutAddress: ErasureFindingRow = feedFinding({
      observables: [address, ALICE],
      indicatorValue: address,
      eventUid: `threat-intel:${FEED_ID}:threat-intel:${FEED_ID}:${keyed(address, DetectionFingerprintKind.ThreatIntel)}:1`,
      ruleName: "Botnet node",
    });
    const rewrite: FindingRewrite | null = planFindingRewrite(
      aboutAddress,
      NAMES,
      CONTEXT,
    );

    // The person comes out of its observables; the address's indicator stays.
    expect(rewrite?.replacements).toEqual([
      { position: 2, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
    ]);
    expect(rewrite?.indicator).toBeUndefined();

    // Un-named by an earlier erasure, it is no more the person's.
    expect(
      planFindingRewrite(
        {
          ...aboutAddress,
          observables: [address, TOKEN],
          isMarkedErased: true,
        },
        NAMES,
        CONTEXT,
      ),
    ).toBeNull();
  });

  test("a rule's finding names no feed's indicator: its rule is left as it is", () => {
    const rewrite: FindingRewrite | null = planFindingRewrite(
      {
        id: "a",
        time: "1",
        observables: [ALICE],
        eventUid: runUid(unkeyed(ALICE)),
        groupValue: ALICE,
        ruleId: "sigma-rule-1",
        ruleName: "Brute force",
      },
      NAMES,
      CONTEXT,
    );

    expect(rewrite?.replacements).toHaveLength(1);
    expect(rewrite?.indicator).toBeUndefined();
  });

  test("a feed's finding whose id is of another shape is still told by the indicator it names", () => {
    expect(
      planFindingRewrite(
        feedFinding({ eventUid: "threat-intel:older-shape" }),
        NAMES,
        CONTEXT,
      )?.indicator,
    ).toEqual({ id: ERASED_ID });
  });

  test("findings that take the same indicator share a mutation; another indicator, another mutation", () => {
    const rewrites: Array<FindingRewrite> = [
      planFindingRewrite(feedFinding({ id: "a" }), NAMES, CONTEXT)!,
      planFindingRewrite(
        feedFinding({ id: "b", time: "1764000000000000002" }),
        NAMES,
        CONTEXT,
      )!,
      {
        ...planFindingRewrite(feedFinding({ id: "c" }), NAMES, CONTEXT)!,
        indicator: { id: "[INDICATOR:0123456789abcdef]" },
      },
    ];
    const mutations: Array<FindingsMutation> = batchFindingRewrites(rewrites);

    expect(mutations).toHaveLength(2);
    expect(mutations[0]!.indicator).toEqual({ id: ERASED_ID });
    expect(mutations[0]!.ids).toEqual(["a", "b"]);
    expect(mutations[1]!.indicator).toEqual({
      id: "[INDICATOR:0123456789abcdef]",
    });
  });

  test("the update sets both id places and the feed's own name, from the finding's own attribute", () => {
    const statement: Statement =
      SecurityUserErasureFindings.toUnnameFindingsStatement({
        projectId: PROJECT_ID,
        mutation: batchFindingRewrites([
          planFindingRewrite(feedFinding(), NAMES, CONTEXT)!,
        ])[0]!,
      });

    expect(statement.query).toMatch(
      /, attributes = mapUpdate\(mapApply\(.*\), attributes\), map\(\{p\d+:String\}, \{p\d+:String\}, \{p\d+:String\}, \{p\d+:String\}\)\), attributeKeys = mapKeys\(mapUpdate\(/,
    );
    expect(statement.query).toMatch(
      /, ruleId = \{p\d+:String\}, ruleName = attributes\[\{p\d+:String\}\], eventUid = arrayStringConcat\(/,
    );
    expect(parameterValues(statement)).toEqual(
      expect.arrayContaining([
        THREAT_INDICATOR_ID_ATTRIBUTE,
        THREAT_FEED_NAME_ATTRIBUTE,
        ERASED_ID,
      ]),
    );
  });

  test("the indicator alone: its attributes and provenance, nothing else of the finding", () => {
    const statement: Statement =
      SecurityUserErasureFindings.toUnnameFindingsStatement({
        projectId: PROJECT_ID,
        mutation: {
          replacements: [],
          indicator: { id: ERASED_ID },
          ids: ["finding-a"],
          fromTime: "1",
          toTime: "1",
        },
      });

    expect(statement.query).toMatch(
      new RegExp(
        `^ALTER TABLE \\S+\\.${EVENTS}Local ON CLUSTER '[^']+' UPDATE attributes = mapUpdate\\(attributes, map\\(\\{p\\d+:String\\}, \\{p\\d+:String\\}, \\{p\\d+:String\\}, \\{p\\d+:String\\}\\)\\), attributeKeys = mapKeys\\(mapUpdate\\(attributes, map\\(`,
      ),
    );
    expect(statement.query).not.toContain("observables =");
    expect(statement.query).not.toContain("message =");
    expect(statement.query).not.toContain("eventUid =");
    expect(statement.query).toContain("ruleId = ");
    expect(statement.query).toContain("ruleName = attributes[");
  });

  test("never the indicator's id, its name, nor the person in what is sent", () => {
    const rewrite: FindingRewrite = planFindingRewrite(
      feedFinding(),
      NAMES,
      CONTEXT,
    )!;

    for (const statement of [
      SecurityUserErasureFindings.toFindingsPageStatement({
        projectId: PROJECT_ID,
        after: { time: rewrite.time, id: rewrite.id },
        limit: 10,
      }),
      SecurityUserErasureFindings.toUnnameFindingsStatement({
        projectId: PROJECT_ID,
        mutation: batchFindingRewrites([rewrite])[0]!,
      }),
    ]) {
      const sent: string = sentText(statement).toLowerCase();

      expect(sent).not.toContain("indicator--");
      expect(sent).not.toContain(STIX_ID.slice("indicator--".length));
      expect(sent).not.toContain("phishing sender");
      expect(sent).not.toContain("alice");
      expect(sent).not.toContain("example.com");
      expect(statement.query).not.toContain("oneuptime.threat");
    }
  });

  test("the read hands each finding's indicator, rule name and feed name to the plan", async () => {
    jest.spyOn(SecurityEventService, "executeQuery").mockResolvedValue({
      json: async () => {
        return {
          data: [
            {
              findingId: "f1",
              findingTime: "1764000000000000001",
              observables: [ALICE],
              findingUid: "threat-intel:x",
              findingGroupValue: "",
              findingIndicatorValue: ALICE,
              findingErased: "",
              findingRuleId: STIX_ID,
              findingRuleName: INDICATOR_NAME,
              findingIndicatorId: STIX_ID,
              findingFeedName: FEED_NAME,
            },
          ],
        };
      },
    } as never);

    const rows: Array<ErasureFindingRow> =
      await SecurityUserErasureFindings.readFindingsPage({
        projectId: PROJECT_ID,
        limit: 10,
      });

    expect(rows[0]).toMatchObject({
      ruleId: STIX_ID,
      ruleName: INDICATOR_NAME,
      indicatorId: STIX_ID,
      feedName: FEED_NAME,
    });

    jest.restoreAllMocks();
  });
});

describe("the mutations that make the changes", () => {
  function rewrite(
    id: string,
    time: string,
    position: number,
    fingerprint?: string,
  ): FindingRewrite {
    return {
      id,
      time,
      replacements: [
        { position, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
      ],
      ...(fingerprint ? { uid: { positions: [5, 9], fingerprint } } : {}),
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

  test("the same names out but another new fingerprint is another change", () => {
    const mutations: Array<FindingsMutation> = batchFindingRewrites([
      rewrite("a", "10", 1, keyed(TOKEN)),
      rewrite("b", "11", 1, keyed(`${TOKEN} / 203.0.113.7`)),
      rewrite("c", "12", 1, keyed(TOKEN)),
    ]);

    expect(
      mutations.map((mutation: FindingsMutation): Array<unknown> => {
        return [mutation.uid?.fingerprint, mutation.ids];
      }),
    ).toEqual([
      [keyed(TOKEN), ["a", "c"]],
      [keyed(`${TOKEN} / 203.0.113.7`), ["b"]],
    ]);
  });

  test("a finding planned twice - read twice - is changed once", () => {
    expect(
      batchFindingRewrites([rewrite("a", "10", 1), rewrite("a", "10", 1)]),
    ).toEqual([
      {
        replacements: [
          { position: 1, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
        ],
        ids: ["a"],
        fromTime: "10",
        toTime: "10",
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
  test("the read: the project's own Detection Findings, through the Distributed table, in the order they were written, with what they are about", () => {
    const first: Statement =
      SecurityUserErasureFindings.toFindingsPageStatement({
        projectId: PROJECT_ID,
        limit: 5000,
      });

    expect(first.query).toMatch(
      new RegExp(
        `^SELECT _id AS findingId, toString\\(toUnixTimestamp64Nano\\(time\\)\\) AS findingTime, observables, eventUid AS findingUid, attributes\\[\\{p\\d+:String\\}\\] AS findingGroupValue, attributes\\[\\{p\\d+:String\\}\\] AS findingIndicatorValue, attributes\\[\\{p\\d+:String\\}\\] AS findingErased, ruleId AS findingRuleId, ruleName AS findingRuleName, attributes\\[\\{p\\d+:String\\}\\] AS findingIndicatorId, attributes\\[\\{p\\d+:String\\}\\] AS findingFeedName FROM \\S+\\.${EVENTS} WHERE projectId = \\{p\\d+:String\\} AND className = \\{p\\d+:String\\} AND vendorName = \\{p\\d+:String\\} ORDER BY time, _id LIMIT \\{p\\d+:Int32\\}$`,
      ),
    );
    expect(first.query).not.toContain(`${EVENTS}Local`);
    expect(parameterValues(first)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        DETECTION_FINDING_CLASS_NAME,
        ERASURE_FINDINGS_VENDOR,
        DETECTION_GROUP_VALUE_ATTRIBUTE,
        THREAT_INDICATOR_VALUE_ATTRIBUTE,
        FINDING_USER_ERASED_ATTRIBUTE,
        // What a feed's finding names its indicator by (#11230).
        THREAT_INDICATOR_ID_ATTRIBUTE,
        THREAT_FEED_NAME_ATTRIBUTE,
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
    expect(statement.query).not.toContain("eventUid");
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

  test("with the id's new fingerprint: its places by position, the rest of the id its own", () => {
    const statement: Statement =
      SecurityUserErasureFindings.toUnnameFindingsStatement({
        projectId: PROJECT_ID,
        mutation: {
          replacements: [
            { position: 1, prefixBytes: 0, token: TOKEN, suffixBytes: 0 },
          ],
          uid: { positions: [5, 9], fingerprint: keyed(TOKEN) },
          ids: ["finding-a"],
          fromTime: "1",
          toTime: "1",
        },
      });

    expect(statement.query).toMatch(
      /, attributeKeys = mapKeys\(mapUpdate\(.*\)\), eventUid = arrayStringConcat\(arrayMap\(\(uidPart, uidPosition\) -> if\(uidPosition IN \(\{p\d+:Int32\}, \{p\d+:Int32\}\), \{p\d+:String\}, uidPart\), splitByChar\(\{p\d+:String\}, eventUid\), arrayEnumerate\(splitByChar\(\{p\d+:String\}, eventUid\)\)\), \{p\d+:String\}\) WHERE /,
    );
    expect(parameterValues(statement)).toEqual(
      expect.arrayContaining([5, 9, keyed(TOKEN), ":"]),
    );
  });

  test("an id alone: the one column changed, no name taken out of anything, no marker", () => {
    const statement: Statement =
      SecurityUserErasureFindings.toUnnameFindingsStatement({
        projectId: PROJECT_ID,
        mutation: {
          replacements: [],
          uid: { positions: [5], fingerprint: keyed(TOKEN) },
          ids: ["finding-a"],
          fromTime: "1",
          toTime: "1",
        },
      });

    expect(statement.query).toMatch(
      new RegExp(
        `^ALTER TABLE \\S+\\.${EVENTS}Local ON CLUSTER '[^']+' UPDATE eventUid = arrayStringConcat\\(`,
      ),
    );
    expect(statement.query).not.toContain("observables =");
    expect(statement.query).not.toContain("message =");
    expect(statement.query).not.toContain("attributes =");
    expect(parameterValues(statement)).not.toContain(USER_ERASED_ON_REQUEST);
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

  test("no value is spelt into a statement's text, none is the person, and none a fingerprint of them", () => {
    const names: Array<ErasedName> = [
      ...NAMES,
      { named: `Alice Smith <${ALICE}>`, hashed: `Alice Smith <${TOKEN}>` },
    ];
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
        eventUid: runUid(unkeyed(`Alice Smith <${ALICE}>`)),
        groupValue: `Alice Smith <${ALICE}>`,
      },
      names,
      CONTEXT,
    )!;

    expect(rewrite.uid).toBeDefined();

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

      // No fingerprint of any spelling of the person, keyed or not, for either source.
      for (const name of names) {
        for (const kind of [
          DetectionFingerprintKind.DetectionRule,
          DetectionFingerprintKind.ThreatIntel,
        ]) {
          expect(sent).not.toContain(keyed(name.named, kind));
          expect(sent).not.toContain(
            DetectionFingerprint.legacyOf({ kind, value: name.named }),
          );
        }
      }
    }
  });
});

/*
 * A project's findings, in memory, read and changed as ClickHouse would: in
 * (time, _id) order after a cursor, and a change applied once queued.
 */
class FakeFindings {
  public rows: Array<ErasureFindingRow> = [];
  public reads: Array<FindingsCursor | null> = [];
  public flushed: Array<Array<string>> = [];

  public add(count: number, namingEvery: number): void {
    for (let index: number = 0; index < count; index++) {
      const isNaming: boolean = index % namingEvery === 0;
      const value: string = isNaming ? ALICE : `user-${index}@example.org`;

      this.rows.push({
        id: `f${String(index).padStart(6, "0")}`,
        time: String(
          BigInt("1764000000000000000") + BigInt(Math.floor(index / 3)),
        ),
        observables: [value, "203.0.113.7"],
        eventUid: runUid(unkeyed(value)),
        groupValue: value,
        isMarkedErased: false,
      });
    }
  }

  public page(
    after: FindingsCursor | null,
    limit: number,
  ): Array<ErasureFindingRow> {
    this.reads.push(after);

    return this.rows
      .filter((row: ErasureFindingRow): boolean => {
        if (!after) {
          return true;
        }

        const time: bigint = BigInt(row.time);
        const afterTime: bigint = BigInt(after.time);

        return time > afterTime || (time === afterTime && row.id > after.id);
      })
      .slice(0, limit)
      .map((row: ErasureFindingRow): ErasureFindingRow => {
        return { ...row, observables: [...row.observables] };
      });
  }

  // What ClickHouse does once it holds the mutations: each finding changed as planned.
  public apply(rewrites: ReadonlyArray<FindingRewrite>): void {
    this.flushed.push(
      rewrites.map((rewrite: FindingRewrite): string => {
        return rewrite.id;
      }),
    );

    for (const rewrite of rewrites) {
      const row: ErasureFindingRow | undefined = this.rows.find(
        (candidate: ErasureFindingRow): boolean => {
          return candidate.id === rewrite.id;
        },
      );

      if (!row) {
        continue;
      }

      for (const replacement of rewrite.replacements) {
        row.observables[replacement.position - 1] = replacement.token;
        row.groupValue = replacement.token;
        row.isMarkedErased = true;
      }

      if (rewrite.uid) {
        row.eventUid = putFingerprintAt({
          text: row.eventUid!,
          places: getFindingUidPlaces(row.eventUid)!,
          fingerprint: rewrite.uid.fingerprint,
        });
      }
    }
  }

  public namingLeft(): number {
    return this.rows.filter((row: ErasureFindingRow): boolean => {
      return (
        planFindingRewrite(row, NAMES, CONTEXT) !== null ||
        row.observables.includes(ALICE)
      );
    }).length;
  }
}

describe("reading a project's findings, on from where the last read stopped (#11160)", () => {
  let findings: FakeFindings;
  let progress: Array<FindingsScanProgress>;

  function onProgress(scanned: FindingsScanProgress): Promise<void> {
    progress.push(scanned);

    return Promise.resolve();
  }

  beforeEach((): void => {
    findings = new FakeFindings();
    progress = [];

    jest
      .spyOn(SecurityUserErasureFindings, "readFindingsPage")
      .mockImplementation(
        (data: {
          after?: FindingsCursor | null | undefined;
          limit: number;
        }): Promise<Array<ErasureFindingRow>> => {
          return Promise.resolve(findings.page(data.after || null, data.limit));
        },
      );
    jest
      .spyOn(SecurityUserErasureFindings, "unnameFindings")
      .mockImplementation(
        (data: {
          rewrites: ReadonlyArray<FindingRewrite>;
        }): Promise<number> => {
          findings.apply(data.rewrites);

          return Promise.resolve(data.rewrites.length);
        },
      );
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("reads page after page to the end, changes each finding that names the person, and says where it is", async () => {
    findings.add(10, 3);

    const step: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after: null,
        onProgress,
        pageSize: 4,
      });

    expect(step).toEqual({
      after: { time: findings.rows[9]!.time, id: findings.rows[9]!.id },
      isAtEnd: true,
      changed: 4,
      unnamed: 4,
    });
    expect(findings.reads).toHaveLength(3);
    expect(findings.namingLeft()).toBe(0);
    // Every finding about the person now carries the fingerprint of the token.
    for (const row of findings.rows) {
      if (row.observables[0] === TOKEN) {
        expect(row.eventUid).toBe(runUid(keyed(TOKEN)));
      }
    }
    expect(progress[progress.length - 1]!.after).toEqual(step.after);
  });

  test("goes on from the cursor it is handed, never from the first finding", async () => {
    findings.add(10, 3);

    const after: FindingsCursor = {
      time: findings.rows[5]!.time,
      id: findings.rows[5]!.id,
    };

    const step: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after,
        onProgress,
        pageSize: 100,
      });

    expect(findings.reads[0]).toEqual(after);
    // Findings 6 and 9 name the person after it; 0 and 3 are before it.
    expect(step.changed).toBe(2);
    expect(findings.rows[0]!.observables[0]).toBe(ALICE);
    expect(findings.rows[6]!.observables[0]).toBe(TOKEN);
  });

  test("queues its changes in batches, and never says it is past one ClickHouse does not hold yet", async () => {
    findings.add(30, 2);

    await SecurityUserErasureFindings.scanFindings({
      projectId: PROJECT_ID,
      names: NAMES,
      tokens: TOKENS,
      after: null,
      onProgress,
      pageSize: 5,
      changesPerFlush: 6,
    });

    // 15 findings name the person: flushed in batches once six or more wait.
    expect(
      findings.flushed.reduce((total: number, batch: Array<string>): number => {
        return total + batch.length;
      }, 0),
    ).toBe(15);
    expect(findings.flushed.length).toBeGreaterThan(1);

    // Each place it reports is past only findings whose change was already queued.
    for (const reported of progress) {
      const queued: Set<string> = new Set<string>(
        findings.flushed.slice(0, progress.indexOf(reported) + 1).flat(),
      );

      for (const row of findings.rows) {
        const isPast: boolean =
          reported.after !== null &&
          (BigInt(row.time) < BigInt(reported.after.time) ||
            (row.time === reported.after.time && row.id <= reported.after.id));

        if (isPast && Number(row.id.slice(1)) % 2 === 0) {
          expect(queued.has(row.id)).toBe(true);
        }
      }
    }
  });

  test("stops at as many changes as one run makes, at the finding that reached it, and goes on after it next time", async () => {
    findings.add(12, 1);

    const first: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after: null,
        onProgress,
        pageSize: 100,
        maxRewrites: 5,
      });

    expect(first).toEqual({
      after: { time: findings.rows[4]!.time, id: findings.rows[4]!.id },
      isAtEnd: false,
      changed: 5,
      unnamed: 5,
      stoppedBy: "cap",
    });

    const second: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after: first.after,
        onProgress,
        pageSize: 100,
        maxRewrites: 5,
      });

    expect(second.changed).toBe(5);
    expect(second.after).toEqual({
      time: findings.rows[9]!.time,
      id: findings.rows[9]!.id,
    });
  });

  test("when its time is up it stops where it is, without failing: the next run goes on", async () => {
    findings.add(10, 1);

    const step: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after: null,
        onProgress,
        pageSize: 2,
        timeLimitMs: -1,
      });

    expect(step).toEqual({
      after: null,
      isAtEnd: false,
      changed: 0,
      unnamed: 0,
      stoppedBy: "time",
    });
    expect(findings.reads).toHaveLength(0);
    expect(progress).toHaveLength(1);
  });

  test("stops between pages once the run's deadline has passed, keeping what it queued", async () => {
    findings.add(10, 1);

    const deadline: JobDeadline = new JobDeadline();

    jest
      .spyOn(SecurityUserErasureFindings, "readFindingsPage")
      .mockImplementation(
        (data: {
          after?: FindingsCursor | null | undefined;
          limit: number;
        }): Promise<Array<ErasureFindingRow>> => {
          // The run runs out of time while the first page is read.
          deadline.end();

          return Promise.resolve(findings.page(data.after || null, data.limit));
        },
      );

    const step: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after: null,
        onProgress,
        pageSize: 3,
        deadline,
      });

    expect(step.stoppedBy).toBe("deadline");
    expect(step.changed).toBe(3);
    expect(findings.reads).toHaveLength(1);
    expect(findings.flushed).toEqual([["f000000", "f000001", "f000002"]]);
    expect(step.after).toEqual({
      time: findings.rows[2]!.time,
      id: findings.rows[2]!.id,
    });
  });

  test("a huge project is read over several runs, each on from the last, every finding changed once, and a rerun changes nothing", async () => {
    findings.add(250, 4);

    let after: FindingsCursor | null = null;
    let runs: number = 0;
    let isAtEnd: boolean = false;

    while (!isAtEnd && runs < 100) {
      const step: FindingsScanStep =
        await SecurityUserErasureFindings.scanFindings({
          projectId: PROJECT_ID,
          names: NAMES,
          tokens: TOKENS,
          after,
          onProgress,
          pageSize: 7,
          maxRewrites: 9,
          changesPerFlush: 4,
        });

      runs++;
      isAtEnd = step.isAtEnd;
      after = step.after;
    }

    expect(isAtEnd).toBe(true);
    /*
     * 63 findings name the person, at most 9 a run: seven runs change them,
     * the seventh stopping at its cap on the last of them, and an eighth
     * reads the rest and finds the end.
     */
    expect(runs).toBe(8);
    expect(findings.namingLeft()).toBe(0);
    expect(findings.flushed.flat()).toHaveLength(63);
    expect(new Set<string>(findings.flushed.flat()).size).toBe(63);

    // A second pass from the first finding: nothing left to change.
    const again: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after: null,
        onProgress,
        pageSize: 50,
      });

    expect(again.isAtEnd).toBe(true);
    expect(again.changed).toBe(0);
    expect(findings.flushed.flat()).toHaveLength(63);
  });

  test("hands over the correlations' values each batch changed, so what else carries their fingerprint is rewritten", async () => {
    findings.rows.push({
      id: "c1",
      time: "1764000000000000001",
      observables: [ALICE, "203.0.113.7"],
      eventUid: runUid(unkeyed(`${ALICE} / 203.0.113.7`)),
      groupValue: `${ALICE} / 203.0.113.7`,
    });
    findings.rows.push({
      id: "c2",
      time: "1764000000000000002",
      observables: [ALICE],
      eventUid: runUid(unkeyed(ALICE)),
      groupValue: ALICE,
    });

    await SecurityUserErasureFindings.scanFindings({
      projectId: PROJECT_ID,
      names: NAMES,
      tokens: TOKENS,
      after: null,
      onProgress,
    });

    expect(
      progress.flatMap((scanned: FindingsScanProgress): Array<ErasedName> => {
        return scanned.correlationValues;
      }),
    ).toEqual([
      { named: `${ALICE} / 203.0.113.7`, hashed: `${TOKEN} / 203.0.113.7` },
    ]);
  });

  test("hands them over before ClickHouse is told to change their findings: after it, nothing says what they were", async () => {
    findings.rows.push({
      id: "c1",
      time: "1764000000000000001",
      observables: [ALICE, "203.0.113.7"],
      eventUid: runUid(unkeyed(`${ALICE} / 203.0.113.7`)),
      groupValue: `${ALICE} / 203.0.113.7`,
    });

    const queuedWhenFound: Array<number> = [];

    await SecurityUserErasureFindings.scanFindings({
      projectId: PROJECT_ID,
      names: NAMES,
      tokens: TOKENS,
      after: null,
      onProgress,
      onChangesFound: (values: Array<ErasedName>): Promise<void> => {
        queuedWhenFound.push(findings.flushed.length);
        expect(values).toEqual([
          { named: `${ALICE} / 203.0.113.7`, hashed: `${TOKEN} / 203.0.113.7` },
        ]);

        return Promise.resolve();
      },
    });

    expect(queuedWhenFound).toEqual([0]);
    expect(findings.flushed).toEqual([["c1"]]);
  });

  test("a batch with no correlation's value hands nothing over", async () => {
    findings.add(3, 1);

    const handed: Array<Array<ErasedName>> = [];

    await SecurityUserErasureFindings.scanFindings({
      projectId: PROJECT_ID,
      names: NAMES,
      tokens: TOKENS,
      after: null,
      onProgress,
      onChangesFound: (values: Array<ErasedName>): Promise<void> => {
        handed.push(values);

        return Promise.resolve();
      },
    });

    expect(handed).toEqual([]);
    expect(findings.flushed.flat()).toHaveLength(3);
  });

  test("reads nothing for no names, and finds nothing in an empty project", async () => {
    expect(
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: [],
        tokens: TOKENS,
        after: null,
        onProgress,
      }),
    ).toEqual({ after: null, isAtEnd: true, changed: 0, unnamed: 0 });
    expect(findings.reads).toHaveLength(0);

    expect(
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after: null,
        onProgress,
      }),
    ).toEqual({ after: null, isAtEnd: true, changed: 0, unnamed: 0 });
    expect(findings.reads).toHaveLength(1);
  });

  test("a row with no id is never changed", async () => {
    findings.rows.push({ id: "", time: "10", observables: [ALICE] });

    const step: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: PROJECT_ID,
        names: NAMES,
        tokens: TOKENS,
        after: null,
        onProgress,
      });

    expect(step.changed).toBe(0);
    expect(findings.flushed).toEqual([]);
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
          CONTEXT,
        )!,
        planFindingRewrite(
          { id: "b", time: "2", observables: [ALICE] },
          NAMES,
          CONTEXT,
        )!,
        planFindingRewrite(
          { id: "c", time: "3", observables: ["x", ALICE] },
          NAMES,
          CONTEXT,
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
