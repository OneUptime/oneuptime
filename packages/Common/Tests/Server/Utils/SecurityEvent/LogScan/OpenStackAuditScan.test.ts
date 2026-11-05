import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OpenStackCloud from "../../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../../../Models/DatabaseModels/OpenStackResource";
import SecurityLogSource from "../../../../../Models/DatabaseModels/SecurityLogSource";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import LogService, {
  FindSecurityLogCandidatesData,
} from "../../../../../Server/Services/LogService";
import OpenStackCloudService from "../../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../../Server/Services/OpenStackResourceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityLogSourceService from "../../../../../Server/Services/SecurityLogSourceService";
import { DetectionMatchGroup } from "../../../../../Server/Services/SecurityEventService";
import DetectionRule from "../../../../../Models/DatabaseModels/DetectionRule";
import DetectionRuleEvaluator from "../../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import RealTimeDetections from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityLogScanner, {
  SecurityLogScanResult,
} from "../../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../../Types/OpenStack/OpenStackResourceKind";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../../Types/SecurityCase/SecurityEntity";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { readSecurityLogResource } from "../../../../../Utils/SecurityCase/SecurityConnectionMatch";
import { OpenStackAuditAttribute } from "../../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import { matchesSecurityLogPrefilter } from "../../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  OPENSTACK_AUDIT_RECORDED_RELEASES,
  PhaseFacts,
  RecordedLine,
  readRecordedFacts,
  readRecordedPhase,
} from "../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditFixtures";

/*
 * THE WHOLE WAY, ON WHAT REAL CLOUDS WROTE: a recorded line, as ingest stored it, read by the log
 * scan, joined to the cloud's inventory, stored as a row, and named on a case. Only the databases
 * are stood in for. This is the "Done when" of the audit trail, short of a live stack: a role
 * grant and an opened security group each reach Security Events with who, what and on what, and a
 * case names the project.
 */

const NOW: Date = new Date("2026-11-04T23:30:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000a101",
);
const CLOUD_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-00000000c101");
const LOGS_SERVICE_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000e101",
);
const LOG_RETENTION_IN_DAYS: number = 7;
const SECURITY_RETENTION_IN_DAYS: number = 400;

function installInventory(rows: Array<Partial<OpenStackResource>>): void {
  const cloud: OpenStackCloud = new OpenStackCloud();

  cloud.id = CLOUD_ID;
  cloud.name = "devstack";

  jest.spyOn(OpenStackCloudService, "findBy").mockImplementation((async () => {
    return [cloud];
  }) as never);
  jest
    .spyOn(OpenStackResourceService, "findBy")
    .mockImplementation((async () => {
      return rows;
    }) as never);
}

function installScan(lines: Array<RecordedLine>): Array<JSONObject> {
  const inserted: Array<JSONObject> = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest
    .spyOn(LogService, "findSecurityLogCandidates")
    .mockImplementation(
      async (
        data: FindSecurityLogCandidatesData,
      ): Promise<Array<JSONObject>> => {
        // What the database asks of a line: nothing else ever leaves it.
        return lines
          .filter((line: RecordedLine): boolean => {
            return matchesSecurityLogPrefilter(line.body);
          })
          .slice(data.offset, data.offset + data.limit)
          .map((line: RecordedLine, index: number): JSONObject => {
            return {
              _id: `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`,
              time: "2026-11-04 23:29:00.000",
              attributes: line.attributes,
              body: line.body,
              // Whose logs these are: the agent's profile names the cloud.
              primaryEntityId: CLOUD_ID.toString(),
              primaryEntityType: ServiceType.OpenStackCloud,
              traceId: "",
              spanId: "",
              sessionId: "",
            };
          });
      },
    );
  jest.spyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue({
    serviceName: "OneUptime Logs",
    primaryEntityId: LOGS_SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: LOG_RETENTION_IN_DAYS,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: {
      logs: { default: LOG_RETENTION_IN_DAYS },
      securityEvents: { default: SECURITY_RETENTION_IN_DAYS },
    },
    projectRetentionInDays: LOG_RETENTION_IN_DAYS,
  } as unknown as TelemetryServiceMetadata);
  jest
    .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
    .mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 });
  jest.spyOn(RealTimeDetections, "screen").mockResolvedValue(0);
  jest
    .spyOn(SecurityEventService, "insertJsonRows")
    .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
      inserted.push(...rows);
    });
  jest.spyOn(SecurityLogSourceService, "updateOneById").mockResolvedValue(1);
  jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
    _namespace: string,
    keys: Array<string>,
  ) => {
    return keys.map((): null => {
      return null;
    });
  }) as never);
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);

  return inserted;
}

function source(): SecurityLogSource {
  const model: SecurityLogSource = new SecurityLogSource();

  model.id = ObjectID.generate();
  model.projectId = PROJECT_ID;
  model.isEnabled = true;
  model.cursor = new Date(NOW.getTime() - 4 * 60 * 1000).toISOString();

  return model;
}

function attributeOf(row: JSONObject, key: string): unknown {
  return (row["attributes"] as JSONObject)[key];
}

// What a case holds for a detection that matched these rows, as the evaluator builds it.
function entitiesOf(data: {
  groupByField: string;
  rows: Array<JSONObject>;
}): Array<string> {
  const rule: DetectionRule = new DetectionRule();

  rule.groupByField = data.groupByField;

  const group: DetectionMatchGroup = {
    groupValue: String(data.rows[0]?.[data.groupByField]),
    matchCount: data.rows.length,
    distinctCount: 0,
    sampleMessage: String(data.rows[0]?.["message"]),
    sampleObservables: data.rows.flatMap((row: JSONObject): Array<string> => {
      return row["observables"] as Array<string>;
    }),
  };

  return DetectionRuleEvaluator.getMatchGroupEntities({
    rule,
    matchGroup: group,
  }).map((entity: SecurityEntity): string => {
    return entity.value;
  });
}

describe.each(OPENSTACK_AUDIT_RECORDED_RELEASES)(
  "%s, from the line to the case",
  (release: string) => {
    const facts: Record<string, PhaseFacts> = readRecordedFacts(release);
    const ids: Record<string, string> = (facts["devstack"] as PhaseFacts).ids;
    const lines: Array<RecordedLine> = readRecordedPhase(release, "devstack");
    const ADMIN_PROJECT: string = ids["admin_project"] as string;

    let inserted: Array<JSONObject> = [];
    let result: SecurityLogScanResult;

    beforeEach(async () => {
      // The project the security group's rule says it is in, which no scene wrote down.
      const paymentsId: string = String(
        lines
          .flatMap((line: RecordedLine) => {
            return line.events;
          })
          .find((event: { attributes: JSONObject }): boolean => {
            return (
              event.attributes[OpenStackAuditAttribute.EventType] ===
              "security_group_rule.create.end"
            );
          })?.attributes[OpenStackAuditAttribute.ProjectId],
      );

      installInventory([
        {
          kind: OpenStackResourceKind.Project,
          externalId: ADMIN_PROJECT,
          name: "admin",
        },
        {
          kind: OpenStackResourceKind.Project,
          externalId: paymentsId,
          name: "ou-payments",
        },
        {
          kind: OpenStackResourceKind.Instance,
          externalId: ids["instance_ok"] as string,
          name: "ou-log-vm",
          openStackProjectId: paymentsId,
        },
      ]);
      inserted = installScan(lines);
      result = await SecurityLogScanner.scanSource(source());
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function rowsOf(type: string): Array<JSONObject> {
      return inserted.filter((row: JSONObject): boolean => {
        return attributeOf(row, OpenStackAuditAttribute.EventType) === type;
      });
    }

    test("the scan finds them, under their own kind", () => {
      expect(result.eventsFound).toBeGreaterThan(0);
      expect(result.byFormat["openstack-audit"]).toBeGreaterThan(0);
    });

    test("a role grant is stored saying who, what and on what, by name", () => {
      const grant: JSONObject | undefined = rowsOf(
        "identity.role_assignment.created",
      ).find((row: JSONObject): boolean => {
        return (
          attributeOf(row, OpenStackAuditAttribute.ProjectId) === ADMIN_PROJECT
        );
      });

      expect(grant?.["principalUser"]).toBe("admin");
      expect(grant?.["targetResource"]).toBe("project admin");
      expect(grant?.["targetHost"]).toBe("devstack");
      expect(attributeOf(grant!, OpenStackAuditAttribute.ProjectName)).toBe(
        "admin",
      );
      expect(grant?.["message"]).toContain("granted role");
      expect(grant?.["message"]).toContain("on project admin");
    });

    test("a case about a grant names the project and the cloud", () => {
      const grants: Array<JSONObject> = rowsOf(
        "identity.role_assignment.created",
      ).filter((row: JSONObject): boolean => {
        return (
          attributeOf(row, OpenStackAuditAttribute.ProjectId) === ADMIN_PROJECT
        );
      });

      expect(
        entitiesOf({ groupByField: "targetResource", rows: grants }),
      ).toEqual(expect.arrayContaining(["project admin", "admin", "devstack"]));
    });

    test("failed logins are stored saying who, from where and against what", () => {
      const failed: Array<JSONObject> = rowsOf("identity.authenticate").filter(
        (row: JSONObject): boolean => {
          return row["statusName"] === "Failure";
        },
      );

      expect(failed).toHaveLength(24);
      expect(
        new Set(
          failed.map((row: JSONObject): unknown => {
            return row["principalUser"];
          }),
        ),
      ).toEqual(new Set(["admin", "ou-nobody"]));

      for (const row of failed) {
        expect(row["principalIp"]).toBeTruthy();
        expect(row["targetResource"]).toBe("Keystone");
        expect(row["targetHost"]).toBe("devstack");
        expect(row["message"]).toContain("failed to sign in to OpenStack");
      }
    });

    test("a case about a burst of them names the address and the accounts", () => {
      const failed: Array<JSONObject> = rowsOf("identity.authenticate").filter(
        (row: JSONObject): boolean => {
          return row["statusName"] === "Failure";
        },
      );
      const rule: DetectionRule = new DetectionRule();

      rule.groupByField = OpenStackAuditAttribute.InitiatorAddress;

      const address: string = String(
        attributeOf(
          failed[0] as JSONObject,
          OpenStackAuditAttribute.InitiatorAddress,
        ),
      );
      const entities: Array<SecurityEntity> =
        DetectionRuleEvaluator.getMatchGroupEntities({
          rule,
          matchGroup: {
            groupValue: address,
            matchCount: failed.length,
            distinctCount: 0,
            sampleMessage: String(failed[0]?.["message"]),
            sampleObservables: failed.flatMap(
              (row: JSONObject): Array<string> => {
                return row["observables"] as Array<string>;
              },
            ),
          },
        });

      expect(
        entities.find((entity: SecurityEntity): boolean => {
          return entity.value === address;
        })?.type,
      ).toBe(SecurityEntityType.IpAddress);
      expect(
        entities.map((entity: SecurityEntity): string => {
          return entity.value;
        }),
      ).toEqual(expect.arrayContaining(["admin", "ou-nobody", "devstack"]));
    });

    test("an opened security group is stored saying who, what and on what, by name", () => {
      const opened: Array<JSONObject> = rowsOf(
        "security_group_rule.create.end",
      );

      expect(opened.length).toBeGreaterThanOrEqual(3);

      for (const row of opened) {
        expect(row["principalUser"]).toBe("admin");
        expect(row["targetResource"]).toBe(
          `project ou-payments security group ${ids["security_group"]}`,
        );
        expect(row["message"]).toContain("in project ou-payments");
      }
    });

    test("a case about an opened security group names the project and the group", () => {
      const entities: Array<string> = entitiesOf({
        groupByField: "targetResource",
        rows: rowsOf("security_group_rule.create.end"),
      });

      expect(entities).toEqual(
        expect.arrayContaining([
          "project ou-payments",
          `project ou-payments security group ${ids["security_group"]}`,
        ]),
      );
    });

    test("an API call names the instance and the project it is in", () => {
      const stopped: JSONObject | undefined = rowsOf(
        "audit.http.response",
      ).find((row: JSONObject): boolean => {
        return row["activityName"] === "update/os-stop";
      });

      expect(stopped?.["message"]).toBe(
        "admin update/os-stop on instance ou-log-vm",
      );
      expect(stopped?.["targetResource"]).toBe(
        "project ou-payments instance ou-log-vm",
      );
      expect(attributeOf(stopped!, OpenStackAuditAttribute.PartId)).toBe(
        ids["instance_ok"],
      );
      expect(stopped?.["observables"]).toEqual(
        expect.arrayContaining(["instance ou-log-vm", "project ou-payments"]),
      );
    });

    test("each is connected to the cloud whose logs it came from, exactly", () => {
      for (const row of inserted) {
        expect(
          readSecurityLogResource(row["attributes"] as JSONObject),
        ).toEqual({
          type: ServiceType.OpenStackCloud,
          id: CLOUD_ID.toString(),
        });
      }
    });

    test("each keeps Security Events' own retention, and not the logs' it came from", () => {
      const days: number =
        (new Date(inserted[0]?.["retentionDate"] as string).getTime() -
          NOW.getTime()) /
        (24 * 60 * 60 * 1000);

      expect(Math.round(days)).toBe(SECURITY_RETENTION_IN_DAYS);
      expect(SECURITY_RETENTION_IN_DAYS).not.toBe(LOG_RETENTION_IN_DAYS);
    });

    test("no stored row holds anything of a credential", () => {
      for (const row of inserted) {
        const text: string = JSON.stringify(row);

        expect(text).not.toContain('"credential"');
        expect(text).not.toContain('"attachments"');
        expect(text).not.toContain("partial_password_hash");
        expect(text).not.toContain("gAAAA");
        expect(text).not.toContain("fake-");
      }
    });
  },
);
