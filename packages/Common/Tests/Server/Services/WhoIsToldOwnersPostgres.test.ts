/*
 * The resolver renders titles through MonitorTemplateUtil, which pulls the
 * native isolated-vm addon in through VMAPI. Nothing here runs the sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import NetworkDeviceOwnerUserService, {
  NetworkDeviceOwners,
} from "../../../Server/Services/NetworkDeviceOwnerUserService";
import WhoIsToldService from "../../../Server/Services/WhoIsToldService";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import InheritedOwners, {
  InheritedOwnersCache,
} from "../../../Server/Utils/Rules/InheritedOwners";
import { OwnerIdSets } from "../../../Server/Utils/Rules/OwnerRulePlan";
import MonitorRuleCriteriaCache from "../../../Server/Utils/Rules/MonitorRuleCriteriaCache";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  WhoIsToldEvent,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerNotReached,
  WhoIsToldOwnerProblem,
  WhoIsToldResult,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger, QueryRunner } from "typeorm";

/*
 * WHO OWNS WHAT A MONITOR OPENS, READ FROM POSTGRES (#9407, #9371).
 *
 * "When this goes down" matches an alert's Alert Owner rules on the owners
 * the alert will have, and Setup health lists the owners no Created email
 * reaches, both from the owners worked out for every monitor of a project
 * at once (WhoIsToldService.resolveProject). Here those reads are SQL: the
 * project's teams and who is in them (readOwnersReached, readTeamNames),
 * every network device's owners (getDeviceOwnersForDevices), every
 * monitor's own owners for an owner rule that inherits them
 * (InheritedOwnersCache) - on copies of the migrated tables:
 *
 *   - each alert's owners are the owner rows its create would write - the
 *     members of the project and the project's teams, of everyone its
 *     criteria, its device and its owner rules name - and an Alert Owner
 *     rule is matched on them as the real engine matches a saved alert's
 *     rows;
 *   - who isn't reached is said, with why;
 *   - a device's owner row of another project is never read;
 *   - the statements the owners cost do not grow with the monitors.
 *
 * Opt in with RUN_POSTGRES_WHO_IS_TOLD_OWNERS_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The tables are cloned into a
 * schema of their own, dropped afterwards, and every row is synthetic.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * WHO_IS_TOLD_OWNERS_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * WHO_IS_TOLD_OWNERS_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WHO_IS_TOLD_OWNERS_TESTS"] === "true"
    ? describe
    : describe.skip;

// The owners' tables, and what an alert needs to open at all.
const OWNER_TABLES: Array<string> = [
  "Team",
  "TeamMember",
  "NetworkDeviceOwnerUser",
  "NetworkDeviceOwnerTeam",
  "MonitorOwnerUser",
  "MonitorOwnerTeam",
  "AlertOwnerUser",
  "AlertOwnerTeam",
];
const TABLES: Array<string> = [
  ...OWNER_TABLES,
  "AlertSeverity",
  "OnCallDutyPolicy",
];

const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK)/i;

// Every statement the DataSource runs while counting is on.
class StatementLog implements Logger {
  public statements: Array<string> = [];
  public isCounting: boolean = false;

  public logQuery(
    query: string,
    _parameters?: Array<unknown>,
    _queryRunner?: QueryRunner,
  ): void {
    if (this.isCounting && !TRANSACTION_CONTROL.test(query)) {
      this.statements.push(query);
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

interface Seeded {
  projectId: ObjectID;
  otherProjectId: ObjectID;
  // Members of the project.
  ana: string;
  ben: string;
  // Invited, never accepted: not a member.
  cara: string;
  // In no team of the project.
  dan: string;
  // The project's teams: Payments has Ana, Night shift nobody who accepted, Staff Ben.
  payments: string;
  nightShift: string;
  staff: string;
  // Another project's team.
  elsewhere: string;
  device: string;
  severity: string;
  anyOfPolicy: string;
  noneOfPolicy: string;
}

describePostgres(
  "who owns what a monitor opens, against a migrated Postgres",
  () => {
    const schema: string = `who_is_told_owners_${ObjectID.generate().toString().replace(/-/g, "")}`;
    const statementLog: StatementLog = new StatementLog();
    let database: DataSource;
    let seeded: Seeded;
    let alertOwnerRules: Array<AlertOwnerRule> = [];

    async function insert(
      table: string,
      row: Record<string, unknown>,
    ): Promise<void> {
      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        Object.values(row),
      );
    }

    async function seed(): Promise<Seeded> {
      const id: () => string = (): string => {
        return ObjectID.generate().toString();
      };
      const data: Seeded = {
        projectId: ObjectID.generate(),
        otherProjectId: ObjectID.generate(),
        ana: id(),
        ben: id(),
        cara: id(),
        dan: id(),
        payments: id(),
        nightShift: id(),
        staff: id(),
        elsewhere: id(),
        device: id(),
        severity: id(),
        anyOfPolicy: id(),
        noneOfPolicy: id(),
      };
      const project: string = data.projectId.toString();

      for (const [teamId, projectId, name] of [
        [data.payments, project, "Payments"],
        [data.nightShift, project, "Night shift"],
        [data.staff, project, "Staff"],
        [data.elsewhere, data.otherProjectId.toString(), "Elsewhere"],
      ] as Array<[string, string, string]>) {
        await insert("Team", {
          _id: teamId,
          projectId: projectId,
          name: name,
          slug: `team-${teamId}`,
          version: 1,
        });
      }

      for (const [teamId, userId, accepted] of [
        [data.payments, data.ana, true],
        [data.staff, data.ben, true],
        // Cara was invited to Night shift and never accepted.
        [data.nightShift, data.cara, false],
      ] as Array<[string, string, boolean]>) {
        await insert("TeamMember", {
          _id: id(),
          projectId: project,
          teamId: teamId,
          userId: userId,
          hasAcceptedInvitation: accepted,
          version: 1,
        });
      }

      // The device's owners: Dan and Payments here; Ben in another project's row.
      await insert("NetworkDeviceOwnerUser", {
        _id: id(),
        projectId: project,
        networkDeviceId: data.device,
        userId: data.dan,
        version: 1,
      });
      await insert("NetworkDeviceOwnerTeam", {
        _id: id(),
        projectId: project,
        networkDeviceId: data.device,
        teamId: data.payments,
        version: 1,
      });
      await insert("NetworkDeviceOwnerUser", {
        _id: id(),
        projectId: data.otherProjectId.toString(),
        networkDeviceId: data.device,
        userId: data.ben,
        version: 1,
      });

      await insert("AlertSeverity", {
        _id: data.severity,
        projectId: project,
        name: "Warning",
        slug: `severity-${data.severity}`,
        color: "#ffaa00",
        order: 1,
        version: 1,
      });

      for (const [policyId, name] of [
        [data.anyOfPolicy, "Payments on-call"],
        [data.noneOfPolicy, "Everyone else"],
      ] as Array<[string, string]>) {
        await insert("OnCallDutyPolicy", {
          _id: policyId,
          projectId: project,
          name: name,
          slug: `policy-${policyId}`,
          version: 1,
        });
      }

      return data;
    }

    // "Alert Owner is any of Payments" and "is none of Payments".
    function onCallRules(): Array<AlertOnCallRule> {
      return [
        [RuleCriteriaOperator.HasAnyOf, seeded.anyOfPolicy, "Payments' alerts"],
        [RuleCriteriaOperator.HasNoneOf, seeded.noneOfPolicy, "Not Payments'"],
      ].map(([operator, policyId, name]: Array<string>): AlertOnCallRule => {
        const rule: AlertOnCallRule = new AlertOnCallRule();
        rule._id = ObjectID.generate().toString();
        rule.name = name!;
        rule.projectId = seeded.projectId;
        rule.criteria = {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: [
            {
              field: "alertOwners",
              operator: operator as RuleCriteriaOperator,
              value: [seeded.payments],
            },
          ],
        };
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy._id = policyId!;
        rule.onCallDutyPolicies = [policy];
        return rule;
      });
    }

    // A monitor whose one criteria opens an alert naming these owners.
    function monitor(data: {
      name: string;
      userIds?: Array<string>;
      teamIds?: Array<string>;
      networkDeviceId?: string;
    }): Monitor {
      const item: Monitor = new Monitor();
      item._id = ObjectID.generate().toString();
      item.name = data.name;
      item.monitorType = MonitorType.Website;
      item.projectId = seeded.projectId;
      item.labels = [];
      item.monitorSteps = {
        data: {
          monitorStepsInstanceArray: [
            {
              data: {
                ...(data.networkDeviceId
                  ? {
                      networkDeviceMonitor: {
                        networkDeviceId: data.networkDeviceId,
                      },
                    }
                  : {}),
                monitorCriteria: {
                  data: {
                    monitorCriteriaInstanceArray: [
                      {
                        data: {
                          id: "offline",
                          name: "Offline",
                          filterCondition: "All",
                          filters: [],
                          description: "",
                          changeMonitorStatus: false,
                          createIncidents: false,
                          createAlerts: true,
                          incidents: [],
                          alerts: [
                            {
                              id: "alert-template",
                              title: `${data.name} is down`,
                              description: "",
                              alertSeverityId: new ObjectID(seeded.severity),
                              ownerUserIds: (data.userIds || []).map(
                                (userId: string): ObjectID => {
                                  return new ObjectID(userId);
                                },
                              ),
                              ownerTeamIds: (data.teamIds || []).map(
                                (teamId: string): ObjectID => {
                                  return new ObjectID(teamId);
                                },
                              ),
                            },
                          ],
                        },
                      } as unknown as MonitorCriteriaInstance,
                    ],
                  },
                },
              },
            },
          ],
        },
      } as unknown as MonitorSteps;
      return item;
    }

    // The four kinds of monitor this project has, `copies` of each.
    function monitors(copies: number): Array<Monitor> {
      const made: Array<Monitor> = [];

      for (let index: number = 0; index < copies; index++) {
        made.push(
          // Payments: the any-of rule pages.
          monitor({ name: `Checkout ${index}`, teamIds: [seeded.payments] }),
          // Cara never accepted, Elsewhere is another project's: nobody owns it.
          monitor({
            name: `Search ${index}`,
            userIds: [seeded.cara],
            teamIds: [seeded.elsewhere],
          }),
          // The device's owners: Dan (in no team) and Payments.
          monitor({
            name: `Core switch ${index}`,
            networkDeviceId: seeded.device,
          }),
          // Night shift (nobody accepted) and Ana: owners, but not Payments.
          monitor({
            name: `Billing ${index}`,
            userIds: [seeded.ana],
            teamIds: [seeded.nightShift],
          }),
        );
      }

      return made;
    }

    function alertOf(result: WhoIsToldResult): WhoIsToldEvent {
      return result.criteria[0]!.events[0]!;
    }

    function ruleNames(event: WhoIsToldEvent): Array<string> {
      return event.rules
        .map((rule: { name: string }): string => {
          return rule.name;
        })
        .sort();
    }

    async function resolveAll(
      items: Array<Monitor>,
    ): Promise<Array<WhoIsToldResult>> {
      return await WhoIsToldService.resolveProject({
        projectId: seeded.projectId,
        monitors: items,
      });
    }

    // The statements that read an owners' table.
    function ownerStatements(): Array<string> {
      return statementLog.statements.filter((statement: string): boolean => {
        return OWNER_TABLES.some((table: string): boolean => {
          return statement.includes(`"${table}"`);
        });
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WHO_IS_TOLD_OWNERS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["WHO_IS_TOLD_OWNERS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WHO_IS_TOLD_OWNERS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        /*
         * No schema of its own: table names stay unqualified, so the tables
         * copied into the test schema are found first and every other table
         * a read joins is found, empty, in public.
         */
        synchronize: false,
        logging: ["query"],
        logger: statementLog,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
    });

    beforeEach(async () => {
      statementLog.statements = [];
      statementLog.isCounting = false;
      alertOwnerRules = [];
      WhoIsToldService.clearCache();

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Nothing is cached between the reads.
      jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
      jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockResolvedValue(undefined as never);

      // The server's sending is not what is read here.
      jest.spyOn(ServerSendingStatus, "getStatuses").mockResolvedValue([]);

      // The on-call and owner rules, as the engines hand them out.
      jest
        .spyOn(AlertOnCallRuleEngineService, "readEnabledRules")
        .mockImplementation((async () => {
          return onCallRules();
        }) as never);
      jest
        .spyOn(IncidentOnCallRuleEngineService, "readEnabledRules")
        .mockResolvedValue([] as never);
      jest
        .spyOn(AlertOwnerRuleEngineService, "getEnabledRules")
        .mockImplementation((async () => {
          return alertOwnerRules;
        }) as never);

      seeded = await seed();
    });

    afterEach(async () => {
      jest.restoreAllMocks();

      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("each alert's owners are the rows its create would write, and Alert Owner rules match on them", async () => {
      const [checkout, search, coreSwitch, billing]: Array<WhoIsToldResult> =
        await resolveAll(monitors(1));

      expect(alertOf(checkout!).ownerIds).toEqual({
        userIds: [],
        teamIds: [seeded.payments],
      });
      expect(ruleNames(alertOf(checkout!))).toEqual(["Payments' alerts"]);

      // Cara never accepted, Elsewhere is another project's: nobody owns it.
      expect(alertOf(search!).ownerIds).toEqual({ userIds: [], teamIds: [] });
      expect(ruleNames(alertOf(search!))).toEqual(["Not Payments'"]);

      // The device's Payments owns it; Dan, in no team, does not; Ben's row is another project's.
      expect(alertOf(coreSwitch!).ownerIds).toEqual({
        userIds: [],
        teamIds: [seeded.payments],
      });
      expect(ruleNames(alertOf(coreSwitch!))).toEqual(["Payments' alerts"]);

      // Ana and Night shift own it - not Payments.
      expect(alertOf(billing!).ownerIds).toEqual({
        userIds: [seeded.ana],
        teamIds: [seeded.nightShift],
      });
      expect(ruleNames(alertOf(billing!))).toEqual(["Not Payments'"]);
    });

    test("the card's matching is the real engine's on a saved alert with those owner rows", async () => {
      const results: Array<WhoIsToldResult> = await resolveAll(monitors(1));

      for (const result of results) {
        const event: WhoIsToldEvent = alertOf(result);
        const alertId: ObjectID = ObjectID.generate();

        // The rows the create writes: written here as SQL, read back by the engine.
        for (const userId of event.ownerIds!.userIds) {
          await insert("AlertOwnerUser", {
            _id: ObjectID.generate().toString(),
            projectId: seeded.projectId.toString(),
            alertId: alertId.toString(),
            userId: userId,
            version: 1,
          });
        }

        for (const teamId of event.ownerIds!.teamIds) {
          await insert("AlertOwnerTeam", {
            _id: ObjectID.generate().toString(),
            projectId: seeded.projectId.toString(),
            alertId: alertId.toString(),
            teamId: teamId,
            version: 1,
          });
        }

        const saved: Alert = new Alert();
        saved.id = alertId;
        saved.projectId = seeded.projectId;
        saved.monitorId = new ObjectID(result.monitorId);
        saved.alertSeverityId = new ObjectID(seeded.severity);
        saved.title = event.title;

        const monitorCache: MonitorRuleCriteriaCache =
          new MonitorRuleCriteriaCache();
        const matched: Array<AlertOnCallRule> =
          await AlertOnCallRuleEngineService.getMatchingRules(saved, {
            rules: onCallRules(),
            monitorCache: monitorCache,
          });

        expect({
          monitor: result.monitorName,
          real: matched
            .map((rule: AlertOnCallRule): string => {
              return rule.name || "";
            })
            .sort(),
        }).toEqual({ monitor: result.monitorName, real: ruleNames(event) });
      }
    });

    test("who isn't reached is said, with why and what named them", async () => {
      const [checkout, search, coreSwitch, billing]: Array<WhoIsToldResult> =
        await resolveAll(monitors(1));

      const notReached: (result: WhoIsToldResult) => Array<string> = (
        result: WhoIsToldResult,
      ): Array<string> => {
        return (alertOf(result).owners.notReached || [])
          .map((owner: WhoIsToldOwnerNotReached): string => {
            return `${owner.id}|${owner.problem}|${owner.addedBy}`;
          })
          .sort();
      };

      expect(notReached(checkout!)).toEqual([]);
      expect(notReached(search!)).toEqual(
        [
          `${seeded.cara}|${WhoIsToldOwnerProblem.NotInProject}|${WhoIsToldOwnerAddedBy.Criteria}`,
          `${seeded.elsewhere}|${WhoIsToldOwnerProblem.TeamOfAnotherProject}|${WhoIsToldOwnerAddedBy.Criteria}`,
        ].sort(),
      );
      expect(notReached(coreSwitch!)).toEqual([
        `${seeded.dan}|${WhoIsToldOwnerProblem.NotInProject}|${WhoIsToldOwnerAddedBy.NetworkDevice}`,
      ]);
      expect(notReached(billing!)).toEqual([
        `${seeded.nightShift}|${WhoIsToldOwnerProblem.TeamHasNobodyInProject}|${WhoIsToldOwnerAddedBy.Criteria}`,
      ]);
    });

    test("every device's owners in two reads, the project's rows only", async () => {
      const other: string = ObjectID.generate().toString();

      statementLog.isCounting = true;
      const owners: Map<string, NetworkDeviceOwners> =
        await NetworkDeviceOwnerUserService.getDeviceOwnersForDevices({
          projectId: seeded.projectId,
          networkDeviceIds: [
            new ObjectID(seeded.device),
            new ObjectID(other),
            new ObjectID(seeded.device.toUpperCase()),
          ],
        });
      statementLog.isCounting = false;

      expect(ownerStatements()).toHaveLength(2);
      expect(Array.from(owners.keys()).sort()).toEqual(
        [seeded.device.toLowerCase(), other.toLowerCase()].sort(),
      );
      expect(
        owners
          .get(seeded.device.toLowerCase())!
          .ownerUserIds.map((id: ObjectID): string => {
            return id.toString();
          }),
      ).toEqual([seeded.dan]);
      expect(
        owners
          .get(seeded.device.toLowerCase())!
          .ownerTeamIds.map((id: ObjectID): string => {
            return id.toString();
          }),
      ).toEqual([seeded.payments]);
      expect(owners.get(other.toLowerCase())).toEqual({
        ownerUserIds: [],
        ownerTeamIds: [],
      });
    });

    test("a monitor's own owners, read once for every monitor, are what InheritedOwners reads for each", async () => {
      const items: Array<Monitor> = monitors(2);

      for (const [index, item] of items.entries()) {
        await insert("MonitorOwnerUser", {
          _id: ObjectID.generate().toString(),
          projectId: seeded.projectId.toString(),
          monitorId: item.id!.toString(),
          userId: index % 2 === 0 ? seeded.ben : seeded.ana,
          version: 1,
        });
      }

      await insert("MonitorOwnerTeam", {
        _id: ObjectID.generate().toString(),
        projectId: seeded.projectId.toString(),
        monitorId: items[0]!.id!.toString(),
        teamId: seeded.staff,
        version: 1,
      });

      const cache: InheritedOwnersCache = new InheritedOwnersCache();

      statementLog.isCounting = true;
      await cache.preload({
        source: "monitors",
        resourceIds: items.map((item: Monitor): ObjectID => {
          return item.id!;
        }),
      });
      statementLog.isCounting = false;

      expect(ownerStatements()).toHaveLength(2);

      for (const item of items) {
        const sources: Set<"monitors"> = new Set<"monitors">(["monitors"]);
        const resources: Parameters<
          typeof InheritedOwners.read
        >[0]["resources"] = {
          monitorIds: [item.id!],
          hostIds: [],
          kubernetesClusterIds: [],
          dockerHostIds: [],
          podmanHostIds: [],
          serviceIds: [],
        };

        statementLog.statements = [];
        statementLog.isCounting = true;
        const cached: OwnerIdSets = (
          await cache.read({
            sources: sources,
            resources: resources,
          })
        ).get("monitors")!;
        statementLog.isCounting = false;

        // Read once: nothing more for any monitor.
        expect(ownerStatements()).toHaveLength(0);

        const read: OwnerIdSets = (
          await InheritedOwners.read({
            sources: sources,
            resources: resources,
          })
        ).get("monitors")!;

        expect(Array.from(cached.userIds).sort()).toEqual(
          Array.from(read.userIds).sort(),
        );
        expect(Array.from(cached.teamIds).sort()).toEqual(
          Array.from(read.teamIds).sort(),
        );
      }
    });

    test("an owner rule that inherits the monitor's owners: they own its alerts, read in one go", async () => {
      const rule: AlertOwnerRule = new AlertOwnerRule();
      rule._id = ObjectID.generate().toString();
      rule.name = "The monitor's owners";
      rule.projectId = seeded.projectId;
      rule.isEnabled = true;
      rule.notifyOwners = true;
      rule.monitors = [];
      rule.alertSeverities = [];
      rule.alertLabels = [];
      rule.monitorLabels = [];
      rule.ownerUsers = [];
      rule.ownerTeams = [];
      rule.inheritOwnersFromMonitors = true;
      alertOwnerRules = [rule];

      const items: Array<Monitor> = monitors(1);

      // Search is owned by Payments: the any-of rule pages it now.
      await insert("MonitorOwnerTeam", {
        _id: ObjectID.generate().toString(),
        projectId: seeded.projectId.toString(),
        monitorId: items[1]!.id!.toString(),
        teamId: seeded.payments,
        version: 1,
      });

      const [, search]: Array<WhoIsToldResult> = await resolveAll(items);

      expect(alertOf(search!).ownerIds?.teamIds).toEqual([seeded.payments]);
      expect(ruleNames(alertOf(search!))).toEqual(["Payments' alerts"]);
    });

    test("the statements the owners cost do not grow with the monitors", async () => {
      const rule: AlertOwnerRule = new AlertOwnerRule();
      rule._id = ObjectID.generate().toString();
      rule.name = "Staff, and the monitor's owners";
      rule.projectId = seeded.projectId;
      rule.isEnabled = true;
      rule.notifyOwners = true;
      rule.monitors = [];
      rule.alertSeverities = [];
      rule.alertLabels = [];
      rule.monitorLabels = [];
      rule.ownerUsers = [];
      const staff: Team = new Team();
      staff._id = seeded.staff;
      rule.ownerTeams = [staff];
      rule.inheritOwnersFromMonitors = true;
      alertOwnerRules = [rule];

      const counted: (copies: number) => Promise<number> = async (
        copies: number,
      ): Promise<number> => {
        statementLog.statements = [];
        statementLog.isCounting = true;
        await resolveAll(monitors(copies));
        statementLog.isCounting = false;

        return ownerStatements().length;
      };

      const few: number = await counted(1);
      const many: number = await counted(25);

      expect(few).toBeGreaterThan(0);
      expect(many).toBe(few);
    });
  },
);
