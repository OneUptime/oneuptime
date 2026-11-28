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
  const keyedToken: string = keyed(
    TOKEN,
    DetectionFingerprintKind.DetectionRule,
  );

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
      JSON.stringify([
        `run:1:each:${keyedToken}`,
        "run:2:each:0123456789abcdef",
      ]),
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
      {
        sourceKey: `rule:${RULE_ID}`,
        firingKeys: [`run:1:each:${keyedToken}`],
      },
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

  /*
   * #11230: an alert or an incident a threat intel match on the person
   * opened says the feed's indicator in its description - "STIX indicator:
   * indicator--..." - and in the feed item that announced it.
   */
  describe("the feed's indicator, out of the alerts and incidents a match opened (#11230)", () => {
    const STIX_ID: string = "indicator--8e2e2d2b-17d4-4cbf-938f-98ee46b3cd3f";
    const FEED_ID: string = "11230000-0000-4000-8000-0000000000f1";
    const keyedAliceIntel: string = keyed(
      ALICE,
      DetectionFingerprintKind.ThreatIntel,
    );
    const unkeyedAliceIntel: string =
      MetricSeriesFingerprint.computeFingerprint({ indicatorValue: ALICE });
    const keyedTokenIntel: string = keyed(
      TOKEN,
      DetectionFingerprintKind.ThreatIntel,
    );
    const ERASED_ID: string = `[INDICATOR:${keyedTokenIntel}]`;

    // An alert's description, as the matcher writes it - with the indicator's score, or (#11447) without.
    function description(
      stixId: string = STIX_ID,
      scored: boolean = true,
    ): string {
      return [
        "Phishing sender",
        `Indicator ${ALICE} (email-addr${scored ? ", confidence 80" : ""}) matched 2 security events between A and B.`,
        `STIX indicator: ${stixId}`,
        `Observables: ${ALICE}`,
      ].join("\n\n");
    }

    function answerRecords(
      table: "Alert" | "Incident",
      rows: Array<Record<string, unknown>>,
    ): Array<Sent> {
      let read: boolean = false;

      return standIn((one: Sent): unknown => {
        if (
          one.sql.startsWith(
            `SELECT "_id", "description", "seriesFingerprint" FROM "${table}"`,
          )
        ) {
          if (read) {
            return [];
          }

          read = true;

          return rows;
        }

        if (one.sql.startsWith("UPDATE")) {
          return [[{ _id: one.parameters[0] }], 1];
        }

        return [];
      });
    }

    test("an alert of the match: its feed item first, then its description, written only if unchanged since read", async () => {
      for (const fingerprint of [
        keyedAliceIntel,
        unkeyedAliceIntel,
        keyedTokenIntel,
      ]) {
        jest.restoreAllMocks();

        const sent: Array<Sent> = answerRecords("Alert", [
          {
            _id: "a1",
            description: description(),
            seriesFingerprint: `threat-intel:${FEED_ID}:${fingerprint}`,
          },
        ]);

        await SecurityUserErasureRecords.rewriteFingerprints({
          projectId: PROJECT_ID,
          groupValues: [{ named: ALICE, hashed: TOKEN }],
        });

        const read: Sent = sent.find((one: Sent): boolean => {
          return one.sql.startsWith(
            'SELECT "_id", "description", "seriesFingerprint" FROM "Alert"',
          );
        })!;

        expect(read.parameters.slice(0, 2)).toEqual([
          PROJECT_ID.toString(),
          DetectionFingerprintKind.ThreatIntel,
        ]);
        expect(read.parameters[2]).toEqual(
          expect.arrayContaining([
            keyedAliceIntel,
            unkeyedAliceIntel,
            keyedTokenIntel,
          ]),
        );
        expect(read.parameters[3]).toBe("STIX indicator: indicator--");
        // And a description that still states the indicator's score (#11447).
        expect(read.parameters[4]).toBe(", confidence ");

        const feeds: Array<Sent> = sent.filter((one: Sent): boolean => {
          return one.sql.startsWith('UPDATE "AlertFeed"');
        });
        const feed: number = sent.findIndex((one: Sent): boolean => {
          return one.sql.startsWith('UPDATE "AlertFeed"');
        });
        const own: number = sent.findIndex((one: Sent): boolean => {
          return one.sql.startsWith('UPDATE "Alert" SET "description"');
        });

        expect(feed).toBeGreaterThan(-1);
        expect(own).toBeGreaterThan(feed);
        // The STIX id, then the score, each replaced where the feed item copied it.
        expect(
          feeds.map((one: Sent): Array<unknown> => {
            return one.parameters;
          }),
        ).toEqual([
          [
            PROJECT_ID.toString(),
            "a1",
            `STIX indicator: ${STIX_ID}`,
            `STIX indicator: ${ERASED_ID}`,
          ],
          [
            PROJECT_ID.toString(),
            "a1",
            "(email-addr, confidence 80)",
            "(email-addr)",
          ],
        ]);
        expect(sent[feed]!.sql).toContain('"alertId" = $2');
        expect(sent[own]!.parameters).toEqual([
          "a1",
          PROJECT_ID.toString(),
          description(ERASED_ID, false),
          description(),
        ]);
        expect(sent[own]!.sql).toContain(
          '"description" IS NOT DISTINCT FROM $4',
        );
        // Nothing else about the alert changes.
        expect(sent[own]!.sql).not.toContain("updatedAt");
      }
    });

    test("an incident of the match the same, through its own feed", async () => {
      const sent: Array<Sent> = answerRecords("Incident", [
        {
          _id: "i1",
          description: description(),
          seriesFingerprint: `threat-intel:${FEED_ID}:${keyedAliceIntel}`,
        },
      ]);

      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [{ named: ALICE, hashed: TOKEN }],
      });

      const feed: Sent = sent.find((one: Sent): boolean => {
        return one.sql.startsWith('UPDATE "IncidentFeed"');
      })!;

      expect(feed.sql).toContain('"incidentId" = $2');
      expect(feed.parameters[3]).toBe(`STIX indicator: ${ERASED_ID}`);
      expect(
        sent.find((one: Sent): boolean => {
          return one.sql.startsWith('UPDATE "Incident" SET "description"');
        })?.parameters[2],
      ).toBe(description(ERASED_ID, false));
    });

    test("a list feed's alert, with no STIX id, loses the indicator's score (#11447)", async () => {
      const listed: string = [
        `Indicator ${ALICE} (email-addr, confidence 65) matched 1 security event between A and B.`,
        `Observables: ${ALICE}`,
      ].join("\n\n");
      const sent: Array<Sent> = answerRecords("Alert", [
        {
          _id: "a1",
          description: listed,
          seriesFingerprint: `threat-intel:${FEED_ID}:${keyedAliceIntel}`,
        },
      ]);

      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [{ named: ALICE, hashed: TOKEN }],
      });

      expect(
        sent
          .filter((one: Sent): boolean => {
            return one.sql.startsWith('UPDATE "AlertFeed"');
          })
          .map((one: Sent): Array<unknown> => {
            return one.parameters.slice(2);
          }),
      ).toEqual([["(email-addr, confidence 65)", "(email-addr)"]]);
      expect(
        sent.find((one: Sent): boolean => {
          return one.sql.startsWith('UPDATE "Alert" SET "description"');
        })?.parameters[2],
      ).toBe(
        [
          `Indicator ${ALICE} (email-addr) matched 1 security event between A and B.`,
          `Observables: ${ALICE}`,
        ].join("\n\n"),
      );
    });

    test("an alert an earlier erasure cut the STIX id from, its score left, loses the score - filed again, the request finishes it (#11447)", async () => {
      const sent: Array<Sent> = answerRecords("Alert", [
        {
          _id: "a1",
          description: description(ERASED_ID),
          seriesFingerprint: `threat-intel:${FEED_ID}:${keyedTokenIntel}`,
        },
      ]);

      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [{ named: ALICE, hashed: TOKEN }],
      });

      expect(
        sent
          .find((one: Sent): boolean => {
            return one.sql.startsWith('UPDATE "Alert" SET "description"');
          })
          ?.parameters.slice(2),
      ).toEqual([description(ERASED_ID, false), description(ERASED_ID)]);
    });

    test("a record whose fingerprint is another match's, or whose description names no STIX indicator and no score, is left", async () => {
      const sent: Array<Sent> = answerRecords("Alert", [
        {
          _id: "a1",
          description: description(),
          seriesFingerprint: `threat-intel:${FEED_ID}:0123456789abcdef`,
        },
        {
          _id: "a2",
          description: "A person rewrote it.",
          seriesFingerprint: `threat-intel:${FEED_ID}:${keyedAliceIntel}`,
        },
        {
          _id: "a3",
          description: description(ERASED_ID, false),
          seriesFingerprint: `threat-intel:${FEED_ID}:${keyedTokenIntel}`,
        },
      ]);

      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [{ named: ALICE, hashed: TOKEN }],
      });

      expect(
        sent.filter((one: Sent): boolean => {
          return (
            one.sql.startsWith('UPDATE "AlertFeed"') ||
            one.sql.startsWith('UPDATE "Alert" SET "description"')
          );
        }),
      ).toEqual([]);
    });

    test("a rule's values alone: no alert is read for an indicator", async () => {
      const sent: Array<Sent> = standIn((one: Sent): unknown => {
        return one.sql.startsWith("SELECT") ? [] : [[], 0];
      });

      await SecurityUserErasureRecords.cutIndicatorFromSeries({
        projectId: PROJECT_ID,
        table: "Alert",
        changes: getFingerprintChanges({
          projectId: PROJECT_ID,
          groupValues: [{ named: ALICE, hashed: TOKEN }],
        }).filter((change: DetectionFingerprintChange): boolean => {
          return change.kind === DetectionFingerprintKind.DetectionRule;
        }),
      });

      expect(sent).toEqual([]);
    });

    test("never the person or the STIX id in a statement's text, only as a parameter", async () => {
      const sent: Array<Sent> = answerRecords("Alert", [
        {
          _id: "a1",
          description: description(),
          seriesFingerprint: `threat-intel:${FEED_ID}:${keyedAliceIntel}`,
        },
      ]);

      await SecurityUserErasureRecords.rewriteFingerprints({
        projectId: PROJECT_ID,
        groupValues: [{ named: ALICE, hashed: TOKEN }],
      });

      for (const one of sent) {
        expect(one.sql).not.toContain("alice");
        expect(one.sql).not.toContain("indicator--8e2e");
      }
    });
  });

  /*
   * #11231: a correlation that writes no Detection Findings and opens no
   * cases leaves no case detection to read its group value from.
   */
  describe("a correlation's values, when it opens no cases and writes no findings (#11231)", () => {
    const GROUP: string = `${ALICE} / 203.0.113.7`;
    const HOST_FIRST: string = `web-01 / ${ALICE}`;
    const unkeyedOf: (value: string) => string = (value: string): string => {
      return MetricSeriesFingerprint.computeFingerprint({ groupValue: value });
    };
    const keyedOf: (value: string) => string = (value: string): string => {
      return keyed(value, DetectionFingerprintKind.DetectionRule);
    };

    function answer(data: {
      alerts?: Array<Record<string, unknown>>;
      incidents?: Array<Record<string, unknown>>;
      ownRisk?: Array<Record<string, unknown>>;
      otherRisk?: Array<Record<string, unknown>>;
    }): Array<Sent> {
      return standIn((one: Sent): unknown => {
        if (
          one.sql.startsWith('SELECT "title", "seriesFingerprint" FROM "Alert"')
        ) {
          return data.alerts || [];
        }

        if (
          one.sql.startsWith(
            'SELECT "title", "seriesFingerprint" FROM "Incident"',
          )
        ) {
          return data.incidents || [];
        }

        if (
          one.sql.startsWith(
            'SELECT "_id", "contributions" FROM "SecurityEntityRisk" WHERE "projectId" = $1 AND "entityKey" = ANY',
          )
        ) {
          return data.ownRisk || [];
        }

        if (one.sql.startsWith('SELECT "entityValue", "contributions"')) {
          return data.otherRisk || [];
        }

        return [];
      });
    }

    test("from an alert's title, kept only when the alert's own fingerprint proves it - keyed or as it was before", async () => {
      for (const fingerprint of [unkeyedOf(GROUP), keyedOf(GROUP)]) {
        jest.restoreAllMocks();
        answer({
          alerts: [
            {
              title: `[Detection] Sign-in burst — ${GROUP}`,
              seriesFingerprint: `detection-rule:${RULE_ID}:${fingerprint}`,
            },
          ],
        });

        expect(
          await SecurityUserErasureRecords.findCorrelationValues({
            projectId: PROJECT_ID,
            names: [{ named: ALICE, hashed: TOKEN }],
          }),
        ).toEqual([{ named: GROUP, hashed: `${TOKEN} / 203.0.113.7` }]);
      }
    });

    test("an incident's too, its event count after the value or not", async () => {
      answer({
        incidents: [
          {
            title: `[Detection] Sign-in burst — ${GROUP} (4 events)`,
            seriesFingerprint: `detection-rule:${RULE_ID}:${keyedOf(GROUP)}`,
          },
        ],
      });

      expect(
        await SecurityUserErasureRecords.findCorrelationValues({
          projectId: PROJECT_ID,
          names: [{ named: ALICE, hashed: TOKEN }],
        }),
      ).toEqual([{ named: GROUP, hashed: `${TOKEN} / 203.0.113.7` }]);
    });

    test("a title the fingerprint does not prove, a feed's or an overflow's, a single value, or one already rewritten, offers nothing", async () => {
      answer({
        alerts: [
          // A person edited the title, or the rule's group was another value.
          {
            title: `[Detection] Sign-in burst — ${ALICE} / 198.51.100.4`,
            seriesFingerprint: `detection-rule:${RULE_ID}:${keyedOf(GROUP)}`,
          },
          // A feed's alert: its value is the indicator, a name already known.
          {
            title: `[Threat Intel] Feed — ${GROUP}`,
            seriesFingerprint: `threat-intel:${RULE_ID}:${keyedOf(GROUP)}`,
          },
          {
            title: `[Detection] Sign-in burst — more matches`,
            seriesFingerprint: `detection-rule:${RULE_ID}:overflow`,
          },
          // A rule that groups on one value: the name, which the names cover.
          {
            title: `[Detection] Sign-in burst — ${ALICE}`,
            seriesFingerprint: `detection-rule:${RULE_ID}:${keyedOf(ALICE)}`,
          },
          // Rewritten by an erasure already: the token's.
          {
            title: `[Detection] Sign-in burst — ${GROUP}`,
            seriesFingerprint: `detection-rule:${RULE_ID}:${keyedOf(`${TOKEN} / 203.0.113.7`)}`,
          },
        ],
      });

      expect(
        await SecurityUserErasureRecords.findCorrelationValues({
          projectId: PROJECT_ID,
          names: [{ named: ALICE, hashed: TOKEN }],
        }),
      ).toEqual([]);
    });

    test("from the person's risk: a firing of theirs another entity also counted, proven by its fingerprint", async () => {
      const sent: Array<Sent> = answer({
        ownRisk: [
          {
            _id: "own",
            contributions: [
              {
                sourceKey: `rule:${RULE_ID}`,
                firingKeys: [
                  `run:1:each:${unkeyedOf(HOST_FIRST)}`,
                  // Their own value's firing: the names explain it.
                  `run:2:each:${keyedOf(ALICE)}`,
                ],
              },
              // A feed's contribution counts no firing of a rule.
              {
                sourceKey: "intel:feed",
                firingKeys: ["run:3:each:0123456789abcdef"],
              },
            ],
          },
        ],
        otherRisk: [
          {
            entityValue: "web-01",
            contributions: [
              {
                sourceKey: `rule:${RULE_ID}`,
                firingKeys: [`run:1:each:${unkeyedOf(HOST_FIRST)}`],
              },
            ],
          },
          // Another firing altogether.
          {
            entityValue: "db-02",
            contributions: [
              {
                sourceKey: `rule:${RULE_ID}`,
                firingKeys: ["run:9:each:fedcba9876543210"],
              },
            ],
          },
        ],
      });

      expect(
        await SecurityUserErasureRecords.findCorrelationValues({
          projectId: PROJECT_ID,
          names: [{ named: ALICE, hashed: TOKEN }],
        }),
      ).toEqual([{ named: HOST_FIRST, hashed: `web-01 / ${TOKEN}` }]);

      const others: Sent = sent.find((one: Sent): boolean => {
        return one.sql.startsWith('SELECT "entityValue", "contributions"');
      })!;

      // Only the person's firings nothing explains are looked for.
      expect(others.parameters[2]).toEqual([unkeyedOf(HOST_FIRST)]);
      expect(others.sql).toContain('NOT ("entityKey" = ANY($2::text[]))');
    });

    test("three values: the name and both others that counted the firing", async () => {
      const three: string = `web-01 / ${ALICE} / 203.0.113.7`;

      answer({
        ownRisk: [
          {
            _id: "own",
            contributions: [
              {
                sourceKey: `rule:${RULE_ID}`,
                firingKeys: [`run:1:each:${keyedOf(three)}`],
              },
            ],
          },
        ],
        otherRisk: ["web-01", "203.0.113.7"].map(
          (entityValue: string): Record<string, unknown> => {
            return {
              entityValue,
              contributions: [
                {
                  sourceKey: `rule:${RULE_ID}`,
                  firingKeys: [`run:1:each:${keyedOf(three)}`],
                },
              ],
            };
          },
        ),
      });

      expect(
        await SecurityUserErasureRecords.findCorrelationValues({
          projectId: PROJECT_ID,
          names: [{ named: ALICE, hashed: TOKEN }],
        }),
      ).toEqual([{ named: three, hashed: `web-01 / ${TOKEN} / 203.0.113.7` }]);
    });

    test("firings a value already known explains need no other entity read", async () => {
      const sent: Array<Sent> = answer({
        alerts: [
          {
            title: `[Detection] Sign-in burst — ${GROUP}`,
            seriesFingerprint: `detection-rule:${RULE_ID}:${keyedOf(GROUP)}`,
          },
        ],
        ownRisk: [
          {
            _id: "own",
            contributions: [
              {
                sourceKey: `rule:${RULE_ID}`,
                firingKeys: [`run:1:each:${keyedOf(GROUP)}`],
              },
            ],
          },
        ],
      });

      await SecurityUserErasureRecords.findCorrelationValues({
        projectId: PROJECT_ID,
        names: [{ named: ALICE, hashed: TOKEN }],
      });

      expect(
        sent.some((one: Sent): boolean => {
          return one.sql.startsWith('SELECT "entityValue", "contributions"');
        }),
      ).toBe(false);
    });

    test("reads the person's own risk by its keys, and hands every name to Postgres only as a parameter", async () => {
      const sent: Array<Sent> = answer({});

      await SecurityUserErasureRecords.findCorrelationValues({
        projectId: PROJECT_ID,
        names: [{ named: ALICE, hashed: TOKEN }],
      });

      const own: Sent = sent.find((one: Sent): boolean => {
        return one.sql.startsWith(
          'SELECT "_id", "contributions" FROM "SecurityEntityRisk"',
        );
      })!;

      expect(own.parameters).toEqual([PROJECT_ID.toString(), [ALICE]]);

      for (const one of sent) {
        expect(one.sql).not.toContain("alice");
        expect(one.sql).not.toContain(PROJECT_ID.toString());
      }
    });
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
