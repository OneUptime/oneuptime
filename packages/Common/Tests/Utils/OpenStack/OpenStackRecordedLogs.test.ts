import { describe, expect, test } from "@jest/globals";
import LogMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import { OPENSTACK_DEFAULT_DROP_FILTERS } from "../../../Server/Utils/OpenStack/OpenStackLogDefaults";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor from "../../../Types/Monitor/MonitorStepLogMonitor";
import {
  OpenStackLogAlertTemplate,
  getAllOpenStackLogAlertTemplates,
} from "../../../Types/Monitor/OpenStackLogAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackLogAttribute,
  OpenStackLogFormat,
  OpenStackLogStamp,
  stampOpenStackLogRecord,
} from "../../../Utils/OpenStack/OpenStackLogs";
import { OPENSTACK_SCRUBBED_VALUE } from "../../../Utils/OpenStack/OpenStackLogScrub";
import {
  OpenStackRequestJoin,
  OpenStackRequestSummary,
  OpenStackTrailRow,
  joinOpenStackRequest,
  summarizeOpenStackRequests,
} from "../../../Utils/OpenStack/OpenStackRequestTrail";
import {
  CompiledFilter,
  compileFilter,
  evaluateCompiledFilter,
} from "../../../../App/FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import {
  OPENSTACK_LOG_RELEASES,
  OpenStackLogPhase,
  RecordedFailure,
  RecordedFileLine,
  RecordedIds,
  RecordedJournalEntry,
  RecordedOtlpRecord,
  RecordedScene,
  StoredLogRow,
  failureTime,
  journalAttributesOf,
  journalTime,
  readRecordedFailures,
  readRecordedFiles,
  readRecordedIds,
  readRecordedJournal,
  readRecordedNotifications,
  readRecordedOtlp,
  severityTextOf,
  stampFailure,
  stampFileLine,
  stampOtlpRecord,
  storedRowOf,
} from "../../Helpers/OpenStackServiceLogs";

/*
 * What real DevStacks' services wrote, on three releases, as the rig recorded it
 * (Tests/Ops/openstack-e2e/logs-record.sh) and import-log-recording.py kept it, each record given
 * to the ingest's own stamp as the agent's collector would hand it over. OpenStackLogs.test.ts
 * says what each format means. This says it is what real services write.
 *
 * Every word here came from a real cloud. Nothing here ran against a live OneUptime: the stamp,
 * the join and the criteria are the real code, reading what was recorded.
 */

const ESCAPE: string = String.fromCharCode(27);
const COLOUR: RegExp = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g");
const UUID: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REQUEST: RegExp = new RegExp(`req-${UUID}`);
// A line's own request, in the context after its logger: a message can name another's.
const REQUEST_IN_CONTEXT: RegExp = new RegExp(
  `^(?:DEBUG|INFO|WARNING|ERROR|CRITICAL) \\S+ \\[(?:None |req-${UUID} )?(req-${UUID})`,
);
const INSTANCE_PREFIX: RegExp = new RegExp(`\\[instance: (${UUID})\\]`);
const LEVEL_AT_START: RegExp =
  /^(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \d+ )?(DEBUG|INFO|WARNING|ERROR|CRITICAL) /;
const PLANTED: string = "planted-secret-9f8e7d6c";
const MASKED_PASSWORD: RegExp = /password\s*=\s*\*{3,}/;

const DROP_FILTERS: Array<{ name: string; compiled: CompiledFilter }> =
  OPENSTACK_DEFAULT_DROP_FILTERS.map(
    (filter: (typeof OPENSTACK_DEFAULT_DROP_FILTERS)[number]) => {
      return {
        name: filter.name,
        compiled: compileFilter(filter.filterQuery, {
          emptyQueryMatches: false,
        }),
      };
    },
  );

// Whether a project that changed nothing keeps this row.
function isKept(row: StoredLogRow): boolean {
  return !DROP_FILTERS.some(
    (filter: { name: string; compiled: CompiledFilter }): boolean => {
      return evaluateCompiledFilter(
        {
          severityText: row.severityText,
          body: row.body,
          attributes: row.attributes,
        },
        filter.compiled,
      );
    },
  );
}

function everyRowOf(
  release: string,
  phase: OpenStackLogPhase,
): Array<StoredLogRow> {
  return [
    ...readRecordedJournal(release, phase),
    ...readRecordedNotifications(release, phase),
  ]
    .sort((a: RecordedJournalEntry, b: RecordedJournalEntry): number => {
      return journalTime(a) - journalTime(b);
    })
    .map((entry: RecordedJournalEntry): StoredLogRow => {
      return storedRowOf(entry);
    });
}

function toTrailRow(row: StoredLogRow): OpenStackTrailRow {
  return {
    time: row.time,
    severityText: row.severityText,
    attributes: row.attributes,
  };
}

function sceneOf(
  ids: RecordedIds,
  phase: string,
  name: string,
): RecordedScene | undefined {
  return (ids.scenes[phase] || []).find((scene: RecordedScene): boolean => {
    return scene.scene === name;
  });
}

describe.each(OPENSTACK_LOG_RELEASES)("%s", (release: string) => {
  const ids: RecordedIds = readRecordedIds(release);
  const devstack: Array<StoredLogRow> = everyRowOf(release, "devstack");

  describe("every format reads as the same thing", () => {
    // What a line says for itself, against what the stamp stored.
    function expectItsOwnWords(body: string, stamp: OpenStackLogStamp): void {
      const level: RegExpMatchArray | null = body.match(LEVEL_AT_START);

      if (level) {
        expect(stamp.attributes[OpenStackLogAttribute.Level]).toBe(level[1]);
        expect(stamp.severityNumber).not.toBeNull();
      }

      const instance: RegExpMatchArray | null = body.match(INSTANCE_PREFIX);

      if (instance && level) {
        expect(stamp.attributes[OpenStackLogAttribute.InstanceId]).toBe(
          instance[1],
        );
      }

      expect(stamp.body).not.toContain(`${ESCAPE}[`);
      expect(stamp.attributes[OpenStackLogAttribute.Service]).toBeTruthy();
    }

    test("DevStack's colour format in the journal", () => {
      const entries: Array<RecordedJournalEntry> = readRecordedJournal(
        release,
        "devstack",
      );
      const read: Array<OpenStackLogStamp> = entries.map(
        (entry: RecordedJournalEntry): OpenStackLogStamp => {
          const row: StoredLogRow = storedRowOf(entry);

          expectItsOwnWords(entry.MESSAGE.replace(COLOUR, ""), row.stamp);

          return row.stamp;
        },
      );

      expect(entries.length).toBeGreaterThan(100);
      expect(
        read.filter((stamp: OpenStackLogStamp): boolean => {
          return (
            stamp.attributes[OpenStackLogAttribute.Format] ===
            OpenStackLogFormat.Oslo
          );
        }).length,
      ).toBeGreaterThan(entries.length * 0.8);

      // A line with a request in its context says which, and what it has in common.
      const withRequest: Array<OpenStackLogStamp> = read.filter(
        (stamp: OpenStackLogStamp): boolean => {
          return REQUEST_IN_CONTEXT.test(stamp.body.slice(0, 200));
        },
      );

      expect(withRequest.length).toBeGreaterThan(50);

      for (const stamp of withRequest) {
        const first: string = stamp.body.match(REQUEST)![0];
        const said: Array<string | undefined> = [
          stamp.attributes[OpenStackLogAttribute.RequestId],
          stamp.attributes[OpenStackLogAttribute.GlobalRequestId],
        ];

        expect(said).toContain(first);
        expect(stamp.attributes[OpenStackLogAttribute.RequestRootId]).toBe(
          stamp.attributes[OpenStackLogAttribute.GlobalRequestId] ||
            stamp.attributes[OpenStackLogAttribute.RequestId],
        );
      }
    });

    test("oslo.log's default format in a service's file, as Kolla-Ansible's are", () => {
      const lines: Array<RecordedFileLine> = readRecordedFiles(release);
      const read: Array<OpenStackLogStamp> = lines
        .filter((line: RecordedFileLine): boolean => {
          return LEVEL_AT_START.test(line.line);
        })
        .map((line: RecordedFileLine): OpenStackLogStamp => {
          const stamp: OpenStackLogStamp = stampFileLine(line);

          expectItsOwnWords(line.line, stamp);
          expect(stamp.attributes[OpenStackLogAttribute.Format]).toBe(
            OpenStackLogFormat.Oslo,
          );
          // The file's name says the service, and the line its own time.
          expect(stamp.time).not.toBeNull();
          expect(stamp.attributes[OpenStackLogAttribute.Service]).not.toBe(
            "unknown",
          );

          return stamp;
        });

      expect(read.length).toBeGreaterThan(50);
      expect(
        read.some((stamp: OpenStackLogStamp): boolean => {
          return Boolean(stamp.attributes[OpenStackLogAttribute.RequestId]);
        }),
      ).toBe(true);
    });

    test("oslo.log's JSON formatter", () => {
      const entries: Array<RecordedJournalEntry> = readRecordedJournal(
        release,
        "json",
      ).filter((entry: RecordedJournalEntry): boolean => {
        return entry.MESSAGE.charAt(0) === "{";
      });

      expect(entries.length).toBeGreaterThan(20);

      for (const entry of entries) {
        const written: Record<string, unknown> = JSON.parse(entry.MESSAGE);
        const stamp: OpenStackLogStamp = storedRowOf(entry).stamp;
        const context: Record<string, unknown> =
          (written["context"] as Record<string, unknown>) || {};

        expect(stamp.attributes[OpenStackLogAttribute.Format]).toBe(
          OpenStackLogFormat.OsloJson,
        );
        expect(stamp.attributes[OpenStackLogAttribute.Level]).toBe(
          written["levelname"],
        );
        expect(stamp.attributes[OpenStackLogAttribute.Logger]).toBe(
          written["name"],
        );
        // Its asctime holds no fraction of a second, and its msecs do.
        expect(Math.floor((stamp.time?.getTime() || 0) / 1000) * 1000).toBe(
          new Date(
            `${String(written["asctime"]).replace(" ", "T")}Z`,
          ).getTime(),
        );

        if (context["request_id"]) {
          expect(stamp.attributes[OpenStackLogAttribute.RequestId]).toBe(
            context["request_id"],
          );
        }

        if (context["global_request_id"]) {
          expect(stamp.attributes[OpenStackLogAttribute.GlobalRequestId]).toBe(
            context["global_request_id"],
          );
        }
      }
    });

    test("oslo.log's journal handler, whose fields stand beside the line", () => {
      const entries: Array<RecordedJournalEntry> = readRecordedJournal(
        release,
        "journal-native",
      ).filter((entry: RecordedJournalEntry): boolean => {
        return Boolean(entry.LOGGER_NAME);
      });

      expect(entries.length).toBeGreaterThan(20);

      for (const entry of entries) {
        const stamp: OpenStackLogStamp = storedRowOf(entry).stamp;

        expect(stamp.attributes[OpenStackLogAttribute.Logger]).toBe(
          entry.LOGGER_NAME,
        );
        expect(stamp.attributes[OpenStackLogAttribute.Level]).toBe(
          entry.LOGGER_LEVEL,
        );

        if (entry.REQUEST_ID) {
          expect(stamp.attributes[OpenStackLogAttribute.RequestId]).toBe(
            entry.REQUEST_ID,
          );
        }

        if (entry.GLOBAL_REQUEST_ID) {
          expect(stamp.attributes[OpenStackLogAttribute.GlobalRequestId]).toBe(
            entry.GLOBAL_REQUEST_ID,
          );
        }

        if (entry.USER_NAME) {
          expect(stamp.attributes[OpenStackLogAttribute.UserName]).toBe(
            entry.USER_NAME,
          );
        }

        if (entry.PROJECT_NAME) {
          expect(stamp.attributes[OpenStackLogAttribute.ProjectName]).toBe(
            entry.PROJECT_NAME,
          );
        }
      }
    });

    test("a traceback the journal handler keeps beside its line goes in the body, once", () => {
      const entries: Array<RecordedJournalEntry> = readRecordedJournal(
        release,
        "journal-native",
      ).filter((entry: RecordedJournalEntry): boolean => {
        return Boolean(entry.EXCEPTION_INFO);
      });

      for (const entry of entries) {
        const row: StoredLogRow = storedRowOf(entry);

        // A chained exception holds several of its own, and each is there once.
        const tracebacksIn: (text: string) => number = (
          text: string,
        ): number => {
          return text.split("Traceback (most recent call last)").length - 1;
        };

        expect(tracebacksIn(row.body)).toBe(
          tracebacksIn(entry.MESSAGE) ||
            tracebacksIn(entry.EXCEPTION_INFO as string),
        );
        expect(row.stamp.removedAttributes).toContain(
          "journald.exception_info",
        );
        expect(row.attributes["journald.exception_info"]).toBeUndefined();
      }
    });
  });

  describe("what a real collector sent", () => {
    const phases: Array<OpenStackLogPhase> = [
      "devstack",
      "oslo-default",
      "journal-native",
    ];

    test.each(phases)("%s: a stack trace is one record", (phase: string) => {
      const records: Array<RecordedOtlpRecord> = readRecordedOtlp(
        release,
        phase as OpenStackLogPhase,
      );
      const bodies: Array<string> = records.map(
        (record: RecordedOtlpRecord): string => {
          return stampOtlpRecord(record).body;
        },
      );

      expect(records.length).toBeGreaterThan(0);

      // No record starts part way through someone else's.
      for (const body of bodies) {
        expect(body).not.toMatch(/^\s*Traceback \(most recent call last\)/);
        expect(body).not.toMatch(/^\s+File "/);
      }

      for (const body of bodies) {
        // A notification holds a failure's traceback in its JSON, on its one line.
        if (
          body.indexOf("Traceback (most recent call last)") !== -1 &&
          body.indexOf("oslo.messaging.notification.") === -1
        ) {
          expect(body).toContain("\n");
          expect(body).toMatch(/File "/);
        }
      }
    });

    test("every record it sent says its cloud and its service", () => {
      for (const phase of phases) {
        for (const record of readRecordedOtlp(release, phase)) {
          const stamp: OpenStackLogStamp = stampOtlpRecord(record);

          expect(stamp.attributes[OpenStackLogAttribute.Service]).toBeTruthy();
          expect(
            record.resource.attributes.some(
              (attribute: { key: string }): boolean => {
                return attribute.key === "openstack.cloud.name";
              },
            ),
          ).toBe(true);
        }
      }
    });
  });

  describe("a failed build, followed from its instance", () => {
    const failed: string =
      ids.ids["devstack"]?.["instance_no_valid_host"] || "";
    const kept: Array<StoredLogRow> = devstack.filter(isKept);
    const ofInstance: Array<StoredLogRow> = kept.filter(
      (row: StoredLogRow): boolean => {
        return row.attributes[OpenStackLogAttribute.InstanceId] === failed;
      },
    );

    test("the scene really failed on the scheduler", () => {
      expect(failed).not.toBe("");
      expect(sceneOf(ids, "devstack", "failed-build-scheduler")?.exitCode).toBe(
        0,
      );
    });

    test("its instance's first request is the one that failed", () => {
      const requests: Array<OpenStackRequestSummary> =
        summarizeOpenStackRequests(ofInstance.map(toTrailRow));

      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0]!.failed).toBe(true);
    });

    test("that request joins nova-api, nova-conductor and the scheduler's own line, with DEBUG dropped", () => {
      const requests: Array<OpenStackRequestSummary> =
        summarizeOpenStackRequests(ofInstance.map(toTrailRow));
      const rootId: string = requests[0]!.rootId;
      const requestRows: Array<StoredLogRow> = kept.filter(
        (row: StoredLogRow): boolean => {
          return row.attributes[OpenStackLogAttribute.RequestRootId] === rootId;
        },
      );
      const join: OpenStackRequestJoin = joinOpenStackRequest({
        requestRows: requestRows.map(toTrailRow),
        windowRows: kept.map(toTrailRow),
      });
      const services: Array<string> = join.joined.map(
        (joined: { service: string }): string => {
          return joined.service;
        },
      );

      expect(services).toEqual(
        expect.arrayContaining([
          "nova-api",
          "nova-conductor",
          "nova-scheduler",
        ]),
      );
      expect(
        requestRows.some((row: StoredLogRow): boolean => {
          return (
            row.attributes[OpenStackLogAttribute.Service] ===
              "nova-scheduler" &&
            row.attributes[OpenStackLogAttribute.Level] !== "DEBUG"
          );
        }),
      ).toBe(true);
    });
  });

  describe("each log alert fires and recovers on what really happened", () => {
    const ARGS: Parameters<OpenStackLogAlertTemplate["getMonitorStep"]>[0] = {
      monitorName: "devstack",
      cloudIdentifier: "devstack",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
    } as unknown as Parameters<OpenStackLogAlertTemplate["getMonitorStep"]>[0];

    interface TimedRow {
      at: number;
      severityText: string;
      attributes: Record<string, string>;
    }

    // Everything the cloud said, by time: every failure in full, and every notification.
    const timed: Array<TimedRow> = [
      ...readRecordedFailures(release).map(
        (failure: RecordedFailure): TimedRow => {
          const stamp: OpenStackLogStamp = stampFailure(failure);

          return {
            at: failureTime(failure),
            severityText: severityTextOf(stamp.severityNumber),
            attributes: {
              ...failure.attributes,
              ...stamp.attributes,
              "resource.openstack.cloud.name": "devstack",
            },
          };
        },
      ),
      ...readRecordedNotifications(release, "devstack").map(
        (entry: RecordedJournalEntry): TimedRow => {
          const row: StoredLogRow = storedRowOf(entry);

          return {
            at: journalTime(entry),
            severityText: row.severityText,
            attributes: row.attributes,
          };
        },
      ),
    ].sort((a: TimedRow, b: TimedRow): number => {
      return a.at - b.at;
    });

    function monitorOf(id: string): {
      logMonitor: MonitorStepLogMonitor;
      fire: CriteriaFilter;
      recover: CriteriaFilter;
    } {
      const template: OpenStackLogAlertTemplate =
        getAllOpenStackLogAlertTemplates().find(
          (candidate: OpenStackLogAlertTemplate): boolean => {
            return candidate.id === id;
          },
        ) as OpenStackLogAlertTemplate;
      const step: MonitorStep = template.getMonitorStep(ARGS);
      const instances: Array<MonitorCriteriaInstance> =
        step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

      return {
        logMonitor: step.data!.logMonitor as MonitorStepLogMonitor,
        fire: instances[0]!.data!.filters[0]!,
        recover: instances[1]!.data!.filters[0]!,
      };
    }

    function matches(
      logMonitor: MonitorStepLogMonitor,
      row: TimedRow,
    ): boolean {
      const severities: Array<LogSeverity> = logMonitor.severityTexts || [];

      return (
        Object.entries(logMonitor.attributes).every(
          ([key, value]: [string, unknown]): boolean => {
            return row.attributes[key] === value;
          },
        ) &&
        (severities.length === 0 ||
          severities.includes(row.severityText as LogSeverity))
      );
    }

    // What the monitor's query counts at one moment: for a grouped monitor, its busiest group.
    function countAt(logMonitor: MonitorStepLogMonitor, at: number): number {
      const from: number = at - logMonitor.lastXSecondsOfLogs * 1000;
      const groups: Map<string, number> = new Map();

      for (const row of timed) {
        if (row.at > from && row.at <= at && matches(logMonitor, row)) {
          const key: string = (logMonitor.groupByAttributes || [])
            .map((name: string): string => {
              return row.attributes[name] || "";
            })
            .join("/");

          groups.set(key, (groups.get(key) || 0) + 1);
        }
      }

      return Math.max(0, ...Array.from(groups.values()));
    }

    function responseOf(logCount: number): LogMonitorResponse {
      return {
        projectId: ObjectID.generate(),
        logCount,
        logQuery: {},
        monitorId: ObjectID.generate(),
      };
    }

    async function isMet(
      filter: CriteriaFilter,
      logCount: number,
    ): Promise<boolean> {
      return (
        (await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: responseOf(logCount),
          criteriaFilter: filter,
        })) !== null
      );
    }

    test.each([
      ["openstack-no-valid-host", ["failed-build-scheduler"]],
      ["openstack-rabbitmq-connection-lost", ["rabbit-down"]],
      ["openstack-database-connection-lost", ["database-down"]],
      [
        "openstack-too-many-errors-from-a-service",
        ["rabbit-down", "database-down", "conductor-down"],
      ],
      ["openstack-token-validation-failing", ["token-validation"]],
      [
        "openstack-instance-action-failed",
        ["failed-build-compute", "failed-rebuild"],
      ],
      ["openstack-scheduling-failed", ["failed-build-scheduler"]],
    ])(
      "%s fires in %j, and recovers a window after",
      async (id: string, sceneNames: Array<string>) => {
        const { logMonitor, fire, recover } = monitorOf(id);
        const scenes: Array<RecordedScene> = sceneNames
          .map((name: string): RecordedScene | undefined => {
            return sceneOf(ids, "devstack", name);
          })
          .filter((scene: RecordedScene | undefined): boolean => {
            return Boolean(scene);
          }) as Array<RecordedScene>;

        expect(scenes.length).toBeGreaterThan(0);

        const from: number = Math.min(
          ...scenes.map((scene: RecordedScene): number => {
            return new Date(scene.startedAt).getTime();
          }),
        );
        // A service goes on saying so for a moment after a scene puts it right.
        const until: number =
          Math.max(
            ...scenes.map((scene: RecordedScene): number => {
              return new Date(scene.endedAt).getTime();
            }),
          ) + 120000;

        const moments: Array<number> = timed
          .filter((row: TimedRow): boolean => {
            return (
              row.at >= from && row.at <= until && matches(logMonitor, row)
            );
          })
          .map((row: TimedRow): number => {
            return row.at;
          });

        expect(moments.length).toBeGreaterThan(0);

        const peak: number = Math.max(
          ...moments.map((at: number): number => {
            return countAt(logMonitor, at);
          }),
        );

        expect(await isMet(fire, peak)).toBe(true);
        expect(await isMet(recover, peak)).toBe(false);

        /*
         * A window after the last line it counted, with the rig's other scenes still to come: so
         * each is read at the last line of its own, across the whole recording.
         */
        const lastLine: number = Math.max(
          ...timed
            .filter((row: TimedRow): boolean => {
              return matches(logMonitor, row);
            })
            .map((row: TimedRow): number => {
              return row.at;
            }),
        );
        const quiet: number = countAt(
          logMonitor,
          lastLine + logMonitor.lastXSecondsOfLogs * 1000 + 1000,
        );

        expect(await isMet(fire, quiet)).toBe(false);
        expect(await isMet(recover, quiet)).toBe(true);
      },
    );
  });

  describe("what never gets stored", () => {
    const phases: Array<OpenStackLogPhase> = [
      "devstack",
      "oslo-default",
      "json",
      "journal-native",
      "keystone-defaults",
    ];
    const entriesOf: () => Array<RecordedJournalEntry> =
      (): Array<RecordedJournalEntry> => {
        return phases.flatMap(
          (phase: OpenStackLogPhase): Array<RecordedJournalEntry> => {
            return [
              ...readRecordedJournal(release, phase),
              ...readRecordedNotifications(release, phase),
            ];
          },
        );
      };

    function storedText(entry: RecordedJournalEntry, body?: string): string {
      const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
        attributes: journalAttributesOf(entry),
        body: body === undefined ? entry.MESSAGE : body,
        severityNumber: 0,
      });

      return `${stamp.body} ${JSON.stringify(stamp.attributes)}`;
    }

    test("a token or a password the recording held at the import's fakes does not stay", () => {
      const held: RegExp =
        /fake-[a-z]+-[a-z-]+|gAAAAA[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
      const left: Array<string> = [];

      for (const entry of entriesOf()) {
        const found: Array<string> = entry.MESSAGE.match(held) || [];

        if (found.length === 0) {
          continue;
        }

        const stored: string = storedText(entry);

        for (const value of found) {
          if (stored.indexOf(value) !== -1) {
            left.push(
              `${value.slice(0, 40)} in ${entry.MESSAGE.slice(0, 120)}`,
            );
          }
        }
      }

      expect(left).toEqual([]);
    });

    test("where oslo masked a value, a secret it had missed would not stay either", () => {
      let planted: number = 0;
      const left: Array<string> = [];

      for (const entry of entriesOf()) {
        // Only a value: oslo.config's own banner is a line of stars.
        const body: string = entry.MESSAGE.replace(
          /(['"]?[A-Za-z_.-]+['"]?\s*[=:]\s*['"]?)\*{3,}/g,
          `$1${PLANTED}`,
        );

        if (body === entry.MESSAGE) {
          continue;
        }

        planted += 1;

        const stored: string = storedText(entry, body);

        if (stored.indexOf(PLANTED) !== -1) {
          left.push(body.slice(0, 200));
        }
      }

      expect(planted).toBeGreaterThan(10);
      expect(left).toEqual([]);
    });

    test("what is taken out says so", () => {
      const line: RecordedJournalEntry | undefined = entriesOf().find(
        (entry: RecordedJournalEntry): boolean => {
          return MASKED_PASSWORD.test(entry.MESSAGE);
        },
      );

      if (line) {
        expect(
          storedText(
            line,
            line.MESSAGE.replace(/(password\s*=\s*)\*{3,}/, `$1${PLANTED}`),
          ),
        ).toContain(OPENSTACK_SCRUBBED_VALUE);
      }
    });
  });
});

describe("the recordings themselves", () => {
  test("there is one for each release the tests hold to", () => {
    expect(OPENSTACK_LOG_RELEASES.length).toBeGreaterThanOrEqual(1);
  });
});
