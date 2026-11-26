import PostgresAppInstance from "../../../../../Server/Infrastructure/PostgresDatabase";
import DetectionFingerprint, {
  DetectionFingerprintKind,
} from "../../../../../Server/Utils/SecurityEvent/DetectionFingerprint";
import { getEntityRiskFingerprint } from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskCases";
import SecurityUserErasureRecords, {
  DetectionFingerprintChange,
  RewrittenFingerprintCounts,
  getEntityRiskFingerprintChanges,
  getFingerprintChanges,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureRecords";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "../../../../../Types/ObjectID";
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE FINGERPRINTS AN ERASURE REWRITES (#11130): for each value that named
 * the person - a name, or a correlation's group value - its keyed and its
 * unkeyed fingerprint, of either source, to the keyed one of the value once
 * the names are out; and how they are put in place in a detection, an
 * alert, an incident and an entity's risk. The SQL itself runs on a real
 * Postgres in SecurityUserErasurePostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11130000-0000-4000-8000-0000000000d1",
);
const RULE_ID: string = "11130000-0000-4000-8000-0000000000b1";

const ALICE: string = "alice@example.com";
const TOKEN: string = ScrubHashToken.ofValue({
  projectId: PROJECT_ID,
  value: ALICE,
});

function keyed(value: string, kind: DetectionFingerprintKind): string {
  return DetectionFingerprint.of({ projectId: PROJECT_ID, kind, value });
}

describe("getFingerprintChanges", () => {
  test("each value's keyed and unkeyed fingerprint, of both sources, to the keyed one of what it is now", () => {
    const changes: Array<DetectionFingerprintChange> = getFingerprintChanges({
      projectId: PROJECT_ID,
      groupValues: [{ named: ALICE, hashed: TOKEN }],
    });

    expect(changes).toEqual(
      expect.arrayContaining([
        {
          kind: DetectionFingerprintKind.DetectionRule,
          previous: keyed(ALICE, DetectionFingerprintKind.DetectionRule),
          next: keyed(TOKEN, DetectionFingerprintKind.DetectionRule),
        },
        {
          kind: DetectionFingerprintKind.DetectionRule,
          previous: MetricSeriesFingerprint.computeFingerprint({
            groupValue: ALICE,
          }),
          next: keyed(TOKEN, DetectionFingerprintKind.DetectionRule),
        },
        {
          kind: DetectionFingerprintKind.ThreatIntel,
          previous: keyed(ALICE, DetectionFingerprintKind.ThreatIntel),
          next: keyed(TOKEN, DetectionFingerprintKind.ThreatIntel),
        },
        {
          kind: DetectionFingerprintKind.ThreatIntel,
          previous: MetricSeriesFingerprint.computeFingerprint({
            indicatorValue: ALICE,
          }),
          next: keyed(TOKEN, DetectionFingerprintKind.ThreatIntel),
        },
      ]),
    );
    expect(changes).toHaveLength(4);
  });

  test("a correlation's value too, to the fingerprint of its values with the names out", () => {
    const changes: Array<DetectionFingerprintChange> = getFingerprintChanges({
      projectId: PROJECT_ID,
      groupValues: [
        { named: `${ALICE} / 203.0.113.7`, hashed: `${TOKEN} / 203.0.113.7` },
      ],
    });

    expect(
      changes.find((change: DetectionFingerprintChange): boolean => {
        return (
          change.kind === DetectionFingerprintKind.DetectionRule &&
          change.previous ===
            MetricSeriesFingerprint.computeFingerprint({
              groupValue: `${ALICE} / 203.0.113.7`,
            })
        );
      })?.next,
    ).toBe(
      keyed(`${TOKEN} / 203.0.113.7`, DetectionFingerprintKind.DetectionRule),
    );
  });

  test("nothing for what is no name, and each change once", () => {
    expect(
      getFingerprintChanges({
        projectId: PROJECT_ID,
        groupValues: [
          { named: "", hashed: TOKEN },
          { named: TOKEN, hashed: TOKEN },
          { named: ALICE, hashed: "" },
        ],
      }),
    ).toEqual([]);
    expect(
      getFingerprintChanges({
        projectId: PROJECT_ID,
        groupValues: [
          { named: ALICE, hashed: TOKEN },
          { named: ALICE, hashed: TOKEN },
        ],
      }),
    ).toHaveLength(4);
  });

  test("no change names the person or a fingerprint of them as what it becomes", () => {
    for (const change of getFingerprintChanges({
      projectId: PROJECT_ID,
      groupValues: [{ named: ALICE, hashed: TOKEN }],
    })) {
      expect(change.next).not.toBe(change.previous);
      expect(change.next).not.toBe(keyed(ALICE, change.kind));
      expect(change.next).not.toBe(
        DetectionFingerprint.legacyOf({ kind: change.kind, value: ALICE }),
      );
    }
  });
});

describe("getEntityRiskFingerprintChanges", () => {
  test("a risk detection's fingerprint is the name itself, case folded: it becomes the token's", () => {
    expect(
      getEntityRiskFingerprintChanges([
        { named: "Alice@Example.com", hashed: TOKEN },
      ]),
    ).toEqual(
      new Map([
        [
          getEntityRiskFingerprint("Alice@Example.com"),
          getEntityRiskFingerprint(TOKEN),
        ],
      ]),
    );
    expect(getEntityRiskFingerprint("Alice@Example.com")).toBe(
      `entity-risk:${ALICE}`,
    );
  });

  test("none for what is no name", () => {
    expect(
      getEntityRiskFingerprintChanges([{ named: TOKEN, hashed: TOKEN }]).size,
    ).toBe(0);
  });
});

/*
 * The rewrite, against a Postgres stood in: the rows a read returns, and
 * what each write is handed.
 */
describe("rewriteFingerprints", () => {
  interface Sent {
    sql: string;
    parameters: Array<unknown>;
  }

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  function standIn(answer: (sent: Sent) => unknown): Array<Sent> {
    const sent: Array<Sent> = [];

    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: async (sql: string, parameters: Array<unknown>) => {
        const one: Sent = { sql, parameters };

        sent.push(one);

        return answer(one);
      },
    } as never);

    return sent;
  }

  const unkeyedAlice: string = MetricSeriesFingerprint.computeFingerprint({
    groupValue: ALICE,
  });
  const keyedToken: string = keyed(TOKEN, DetectionFingerprintKind.DetectionRule);

  test("a detection's fingerprint, the id of its finding and the firings it took, each in its place, written only if unchanged since read", async () => {
    let read: boolean = false;
    const sent: Array<Sent> = standIn((one: Sent): unknown => {
      if (one.sql.startsWith('SELECT "_id", "fingerprint"')) {
        if (read) {
          return [];
        }

        read = true;

        return [
          {
            _id: "d1",
            fingerprint: `detection-rule:${RULE_ID}:${unkeyedAlice}`,
            eventUid: `detection:${RULE_ID}:detection-rule:${RULE_ID}:${unkeyedAlice}:run:1:each:${unkeyedAlice}`,
            recentFiringKeys: [
              `run:1:each:${unkeyedAlice}`,
              "run:2:each:0123456789abcdef",
            ],
          },
          {
            _id: "d2",
            fingerprint: getEntityRiskFingerprint(ALICE),
            eventUid: null,
            recentFiringKeys: null,
          },
        ];
      }

      if (one.sql.startsWith('UPDATE "SecurityDetection"')) {
        return [[{ _id: one.parameters[0] }], 1];
      }

      return one.sql.startsWith("SELECT") ? [] : [[], 0];
    });

    const counts: RewrittenFingerprintCounts =
      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [{ named: ALICE, hashed: TOKEN }],
      });

    expect(counts.detections).toBe(2);

    const writes: Array<Sent> = sent.filter((one: Sent): boolean => {
      return one.sql.startsWith('UPDATE "SecurityDetection"');
    });

    expect(writes[0]!.parameters.slice(0, 5)).toEqual([
      "d1",
      PROJECT_ID.toString(),
      `detection-rule:${RULE_ID}:${keyedToken}`,
      `detection:${RULE_ID}:detection-rule:${RULE_ID}:${keyedToken}:run:1:each:${keyedToken}`,
      JSON.stringify([`run:1:each:${keyedToken}`, "run:2:each:0123456789abcdef"]),
    ]);
    // Written only if it is still as it was read.
    expect(writes[0]!.sql).toContain(
      '"fingerprint" IS NOT DISTINCT FROM $6 AND "eventUid" IS NOT DISTINCT FROM $7 AND "recentFiringKeys" IS NOT DISTINCT FROM $8::jsonb',
    );
    expect(writes[1]!.parameters.slice(0, 5)).toEqual([
      "d2",
      PROJECT_ID.toString(),
      getEntityRiskFingerprint(TOKEN),
      null,
      null,
    ]);
  });

  test("alerts and incidents, by their fingerprint's place, every change in one statement each, the audit log never handed the old one", async () => {
    const sent: Array<Sent> = standIn((one: Sent): unknown => {
      if (one.sql.startsWith('UPDATE "Alert"')) {
        return [[{ _id: "a1" }, { _id: "a2" }], 2];
      }

      if (one.sql.startsWith('UPDATE "Incident"')) {
        return [[{ _id: "i1" }], 1];
      }

      return [];
    });

    const counts: RewrittenFingerprintCounts =
      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [{ named: ALICE, hashed: TOKEN }],
      });

    expect(counts.alerts).toBe(2);
    expect(counts.incidents).toBe(1);

    const alerts: Sent = sent.find((one: Sent): boolean => {
      return one.sql.startsWith('UPDATE "Alert"');
    })!;

    expect(alerts.parameters[0]).toBe(PROJECT_ID.toString());
    expect(alerts.parameters[2]).toEqual(
      expect.arrayContaining([unkeyedAlice]),
    );
    expect(alerts.parameters[3]).toEqual(expect.arrayContaining([keyedToken]));
    // Nothing else about the alert changes: not when it was last updated.
    expect(alerts.sql).not.toContain("updatedAt");
    expect(alerts.sql).toContain(
      "split_part(record.\"seriesFingerprint\", ':', 3) = change.previous",
    );
  });

  test("the firings an entity's risk counted under a previous fingerprint", async () => {
    let read: boolean = false;
    const sent: Array<Sent> = standIn((one: Sent): unknown => {
      if (one.sql.startsWith('SELECT "_id", "contributions"')) {
        if (read) {
          return [];
        }

        read = true;

        return [
          {
            _id: "r1",
            contributions: [
              {
                sourceKey: `rule:${RULE_ID}`,
                firingKeys: [`run:1:each:${unkeyedAlice}`],
              },
              { sourceKey: "intel:x", hits: 2 },
            ],
          },
        ];
      }

      if (one.sql.startsWith('UPDATE "SecurityEntityRisk"')) {
        return [[{ _id: "r1" }], 1];
      }

      return [];
    });

    const counts: RewrittenFingerprintCounts =
      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [{ named: ALICE, hashed: TOKEN }],
      });

    expect(counts.entityRisks).toBe(1);

    const write: Sent = sent.find((one: Sent): boolean => {
      return one.sql.startsWith('UPDATE "SecurityEntityRisk"');
    })!;

    expect(JSON.parse(write.parameters[2] as string)).toEqual([
      { sourceKey: `rule:${RULE_ID}`, firingKeys: [`run:1:each:${keyedToken}`] },
      { sourceKey: "intel:x", hits: 2 },
    ]);
    expect(write.sql).toContain(
      '"contributions" IS NOT DISTINCT FROM $4::jsonb',
    );
  });

  test("a row read again after it was written once is never written twice, and nothing is sent for no value", async () => {
    const sent: Array<Sent> = standIn((one: Sent): unknown => {
      return one.sql.startsWith("SELECT") ? [] : [[], 0];
    });

    expect(
      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [],
      }),
    ).toEqual({ detections: 0, alerts: 0, incidents: 0, entityRisks: 0 });
    expect(sent).toEqual([]);
  });

  test("every statement hands the name to Postgres only as a parameter, never in its text", async () => {
    const sent: Array<Sent> = standIn((one: Sent): unknown => {
      return one.sql.startsWith("SELECT") ? [] : [[], 0];
    });

    await SecurityUserErasureRecords.rewriteFingerprints({
      projectId: PROJECT_ID,
      groupValues: [{ named: ALICE, hashed: TOKEN }],
    });

    expect(sent.length).toBeGreaterThan(0);

    for (const one of sent) {
      expect(one.sql).not.toContain("alice");
      expect(one.sql).not.toContain(unkeyedAlice);
      expect(one.sql).not.toContain(PROJECT_ID.toString());
    }
  });
});
