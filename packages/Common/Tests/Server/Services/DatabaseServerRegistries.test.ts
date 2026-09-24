/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerLabelRule from "../../../Models/DatabaseModels/DatabaseServerLabelRule";
import DatabaseServerOwnerRule from "../../../Models/DatabaseModels/DatabaseServerOwnerRule";
import DatabaseServerOwnerTeam from "../../../Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerUser from "../../../Models/DatabaseModels/DatabaseServerOwnerUser";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import BaseService from "../../../Server/Services/BaseService";
import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseServerEndpointService from "../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerLabelRuleEngineService from "../../../Server/Services/DatabaseServerLabelRuleEngineService";
import DatabaseServerLabelRuleService from "../../../Server/Services/DatabaseServerLabelRuleService";
import DatabaseServerOwnerRuleEngineService from "../../../Server/Services/DatabaseServerOwnerRuleEngineService";
import DatabaseServerOwnerRuleService from "../../../Server/Services/DatabaseServerOwnerRuleService";
import DatabaseServerOwnerTeamService from "../../../Server/Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "../../../Server/Services/DatabaseServerOwnerUserService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import HostService from "../../../Server/Services/HostService";
import Services from "../../../Server/Services/Index";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import OTelIngestService from "../../../Server/Services/OpenTelemetryIngestService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ServiceService from "../../../Server/Services/ServiceService";
import TelemetryUsageBillingService from "../../../Server/Services/TelemetryUsageBillingService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import { getAffectedResourceRelations } from "../../../Server/Utils/Database/AffectedResourceRelations";
import { ProjectScopedRelation } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import { DatabaseServerIdLabelKeys } from "../../../Server/Utils/Monitor/SeriesResourceLabels";
import RuleRunRegistry, {
  RuleRunDefinition,
} from "../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import ProjectLeaveResourceCleanup, {
  OwnerUserTable,
} from "../../../Server/Utils/TeamMember/ProjectLeaveResourceCleanup";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import { OwnedThroughMetadata } from "../../../Types/Database/AccessControl/OwnedThrough";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  RULE_RUN_TYPE_METADATA,
  RuleRunAction,
  RuleRunType,
} from "../../../Types/Rules/RuleRun";
import RULE_CRITERIA_FIELDS_BY_MODEL, {
  getRuleCriteriaFieldsForModel,
} from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TelemetryServiceUtil, {
  ResolvedTelemetryResource,
} from "../../../UI/Utils/TelemetryService";
import { LABEL_RULE_MODELS } from "../../../Utils/LabelRuleImportExport";
import { MockFunction } from "../../MockType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Pins every server-side registry the Databases resource type (the
 * DatabaseServer model family) has to appear in. Each of these is a
 * hand-kept list: forgetting one does not fail to compile, it silently
 * drops the feature for databases only — no CRUD route, no Owned-scope
 * telemetry, a "Run now" button that answers "cannot be run", a departed
 * user still listed as an owner, a retention override that is ignored at
 * ingest or billed at the project default, and so on. Every assertion
 * names the exact object registered, not just "something is there".
 */

const CRITERIA_FIELDS: Array<string> = [
  "databaseServerLabels",
  "databaseServerNamePattern",
  "databaseServerDescriptionPattern",
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Server/Services/Index", () => {
  test.each([
    ["DatabaseServerService", DatabaseServerService],
    ["DatabaseServerEndpointService", DatabaseServerEndpointService],
    ["DatabaseServerFeedService", DatabaseServerFeedService],
    ["DatabaseServerOwnerTeamService", DatabaseServerOwnerTeamService],
    ["DatabaseServerOwnerUserService", DatabaseServerOwnerUserService],
    ["DatabaseServerLabelRuleService", DatabaseServerLabelRuleService],
    ["DatabaseServerOwnerRuleService", DatabaseServerOwnerRuleService],
  ])(
    "registers %s exactly once (boot-time table creation, workflows, hard delete)",
    (_name: string, service: BaseService) => {
      expect(
        Services.filter((candidate: BaseService): boolean => {
          return candidate === service;
        }),
      ).toHaveLength(1);
    },
  );

  test("does not register the rule engines, which are not DatabaseServices", () => {
    expect(Services).not.toContain(
      DatabaseServerLabelRuleEngineService as unknown as BaseService,
    );
    expect(Services).not.toContain(
      DatabaseServerOwnerRuleEngineService as unknown as BaseService,
    );
  });
});

describe("OwnerTableRegistry", () => {
  test("registers DatabaseServer with its owner tables, FK column and model service", () => {
    const entry: OwnerTablePair | undefined =
      OwnerTableRegistry.get("DatabaseServer");

    expect(entry).toBeDefined();
    expect(entry!.ownerUserService).toBe(DatabaseServerOwnerUserService);
    expect(entry!.ownerTeamService).toBe(DatabaseServerOwnerTeamService);
    expect(entry!.fkColumn).toBe("databaseServerId");
    expect(entry!.modelService).toBe(DatabaseServerService);
  });

  test("lets a database's owners see its telemetry (canOwnTelemetry)", () => {
    /*
     * Receiver batches record the database id as the telemetry row's
     * primaryEntityId (serviceType DatabaseServer); only entries flagged
     * canOwnTelemetry are unioned into the Owned / Labels telemetry scope.
     */
    expect(OwnerTableRegistry.get("DatabaseServer")!.canOwnTelemetry).toBe(
      true,
    );
  });

  test("the registry key is the model class name the Owned scope resolves by", () => {
    // OwnedScopePermission looks entries up by `modelType.name`.
    expect(DatabaseServer.name).toBe("DatabaseServer");
  });

  test("both owner tables carry the registered FK column", () => {
    for (const ownerModel of [
      new DatabaseServerOwnerUser(),
      new DatabaseServerOwnerTeam(),
    ]) {
      expect(ownerModel.hasColumn("databaseServerId")).toBe(true);
      expect(ownerModel.hasColumn("projectId")).toBe(true);
    }
  });
});

describe("ProjectLeaveResourceCleanup", () => {
  test("removes a departed user's database owner rows, all of them", () => {
    const tables: Array<OwnerUserTable> =
      ProjectLeaveResourceCleanup.getOwnerUserTables().filter(
        (table: OwnerUserTable): boolean => {
          return (
            (table.service as unknown as BaseService) ===
            (DatabaseServerOwnerUserService as unknown as BaseService)
          );
        },
      );

    expect(tables).toHaveLength(1);
    expect(tables[0]!.resourceIdColumn).toBe("databaseServerId");
    // A database does not open and close: every owner row goes.
    expect(tables[0]!.lifecycle).toBeUndefined();
  });
});

describe("RuleRun types", () => {
  test.each([
    [RuleRunType.DatabaseServerLabelRule, RuleRunAction.AddLabels],
    [RuleRunType.DatabaseServerOwnerRule, RuleRunAction.AddOwners],
  ])(
    "%s is the rule model's tableName and reads 'database' / 'databases'",
    (ruleType: RuleRunType, action: RuleRunAction) => {
      expect(RULE_RUN_TYPE_METADATA[ruleType]).toEqual({
        action: action,
        resourceSingular: "database",
        resourcePlural: "databases",
      });
    },
  );

  test("the enum values are the rule tables' names", () => {
    expect(RuleRunType.DatabaseServerLabelRule).toBe(
      new DatabaseServerLabelRule().tableName,
    );
    expect(RuleRunType.DatabaseServerOwnerRule).toBe(
      new DatabaseServerOwnerRule().tableName,
    );
  });
});

describe("RuleRunRegistry", () => {
  test("wires the label rule to its model, services and engine", () => {
    const definition: RuleRunDefinition | null = RuleRunRegistry.getDefinition(
      RuleRunType.DatabaseServerLabelRule,
    );

    expect(definition).not.toBeNull();
    expect(definition!.ruleModelType).toBe(DatabaseServerLabelRule);
    expect(definition!.resourceModelType).toBe(DatabaseServer);
    expect(definition!.ruleService).toBe(DatabaseServerLabelRuleService);
    expect(definition!.resourceService).toBe(DatabaseServerService);
    expect(definition!.engine).toBe(DatabaseServerLabelRuleEngineService);
    expect(definition!.ownerModelTypes).toBeUndefined();
  });

  test("wires the owner rule to its model, services, engine and owner rows", () => {
    const definition: RuleRunDefinition | null = RuleRunRegistry.getDefinition(
      RuleRunType.DatabaseServerOwnerRule,
    );

    expect(definition).not.toBeNull();
    expect(definition!.ruleModelType).toBe(DatabaseServerOwnerRule);
    expect(definition!.resourceModelType).toBe(DatabaseServer);
    expect(definition!.ruleService).toBe(DatabaseServerOwnerRuleService);
    expect(definition!.resourceService).toBe(DatabaseServerService);
    expect(definition!.engine).toBe(DatabaseServerOwnerRuleEngineService);
    expect(definition!.ownerModelTypes).toEqual([
      DatabaseServerOwnerUser,
      DatabaseServerOwnerTeam,
    ]);
  });

  test("neither database rule is a self-syncing monitor rule", () => {
    expect(
      RuleRunRegistry.isSyncRuleRunType(RuleRunType.DatabaseServerLabelRule),
    ).toBe(false);
    expect(
      RuleRunRegistry.isSyncRuleRunType(RuleRunType.DatabaseServerOwnerRule),
    ).toBe(false);
  });
});

describe("RuleCriteriaFieldRegistry", () => {
  test.each([["DatabaseServerLabelRule"], ["DatabaseServerOwnerRule"]])(
    "%s allows exactly the three database criteria fields",
    (modelName: string) => {
      expect(RULE_CRITERIA_FIELDS_BY_MODEL[modelName]).toEqual(CRITERIA_FIELDS);
      expect(getRuleCriteriaFieldsForModel(modelName)).toEqual(CRITERIA_FIELDS);
    },
  );

  test.each([
    ["DatabaseServerLabelRule", DatabaseServerLabelRule],
    ["DatabaseServerOwnerRule", DatabaseServerOwnerRule],
  ])(
    "every %s criteria field is a real column of the rule model",
    (_name: string, modelType: DatabaseBaseModelType) => {
      const model: BaseModel = new modelType();

      for (const field of CRITERIA_FIELDS) {
        expect(model.hasColumn(field)).toBe(true);
      }

      expect(model.getTableColumnMetadata("databaseServerLabels").type).toBe(
        TableColumnType.EntityArray,
      );
    },
  );

  test("both engines select every criteria field they evaluate", () => {
    for (const ruleSelect of [
      DatabaseServerLabelRuleEngineService.ruleSelect,
      DatabaseServerOwnerRuleEngineService.ruleSelect,
    ]) {
      const select: Dictionary<unknown> = ruleSelect as Dictionary<unknown>;

      expect(select["criteria"]).toBe(true);

      for (const field of CRITERIA_FIELDS) {
        expect(select[field]).toBeDefined();
      }
    }
  });
});

describe("LabelRuleImportExport", () => {
  test("database label rules travel as portable files; owner rules do not", () => {
    expect(LABEL_RULE_MODELS).toContain(DatabaseServerLabelRule);
    expect(LABEL_RULE_MODELS).not.toContain(DatabaseServerOwnerRule);
  });
});

describe("AffectedResourceRelations", () => {
  test("validates an incident / alert's databases against its own project", () => {
    const relations: Array<ProjectScopedRelation> =
      getAffectedResourceRelations().filter(
        (relation: ProjectScopedRelation): boolean => {
          return relation.column === "databaseServers";
        },
      );

    expect(relations).toHaveLength(1);
    expect(relations[0]!.modelName).toBe("Database");
    expect(relations[0]!.service as unknown as BaseService).toBe(
      DatabaseServerService as unknown as BaseService,
    );
  });

  test.each([
    ["Incident", Incident],
    ["Alert", Alert],
    ["ScheduledMaintenance", ScheduledMaintenance],
  ])(
    "%s carries the databaseServers relation to DatabaseServer",
    (_name: string, modelType: DatabaseBaseModelType) => {
      const model: BaseModel = new modelType();

      expect(model.hasColumn("databaseServers")).toBe(true);
      expect(model.getTableColumnMetadata("databaseServers").type).toBe(
        TableColumnType.EntityArray,
      );
      expect(model.getTableColumnMetadata("databaseServers").modelType).toBe(
        DatabaseServer,
      );
    },
  );

  test("keeps every pre-existing affected-resource list", () => {
    // Adding databases must not have displaced a neighbour.
    const columns: Array<string> = getAffectedResourceRelations().map(
      (relation: ProjectScopedRelation): string => {
        return relation.column;
      },
    );

    expect(columns).toEqual(
      expect.arrayContaining([
        "hosts",
        "kubernetesClusters",
        "cephClusters",
        "services",
        "databaseServers",
      ]),
    );
    expect(new Set(columns).size).toBe(columns.length);
  });
});

describe("OpenTelemetryIngestService.findResourceRetention", () => {
  type FindResourceRetention = (
    resourceId: ObjectID,
    primaryEntityType: ServiceType,
  ) => Promise<{
    retainTelemetryDataForDays: number | null;
    telemetryRetentionConfig: unknown;
  }>;

  function findResourceRetention(): FindResourceRetention {
    return (
      OTelIngestService as unknown as {
        findResourceRetention: FindResourceRetention;
      }
    ).findResourceRetention.bind(OTelIngestService);
  }

  test("reads a database's retention override from the database row", async () => {
    const databaseServerId: ObjectID = ObjectID.generate();
    const findOneById: MockFunction = jest
      .spyOn(DatabaseServerService, "findOneById")
      .mockResolvedValue(
        Object.assign(new DatabaseServer(), {
          retainTelemetryDataForDays: 45,
          telemetryRetentionConfig: { logs: { default: 7 } },
        }),
      ) as unknown as MockFunction;
    const cephLookup: MockFunction = jest.spyOn(
      CephClusterService,
      "findOneById",
    ) as unknown as MockFunction;

    const retention: {
      retainTelemetryDataForDays: number | null;
      telemetryRetentionConfig: unknown;
    } = await findResourceRetention()(
      databaseServerId,
      ServiceType.DatabaseServer,
    );

    expect(retention).toEqual({
      retainTelemetryDataForDays: 45,
      telemetryRetentionConfig: { logs: { default: 7 } },
    });
    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith({
      id: databaseServerId,
      select: {
        retainTelemetryDataForDays: true,
        telemetryRetentionConfig: true,
      },
      props: { isRoot: true },
    });
    expect(cephLookup).not.toHaveBeenCalled();
  });

  test("falls back to no override when the database row is gone", async () => {
    jest.spyOn(DatabaseServerService, "findOneById").mockResolvedValue(null);

    await expect(
      findResourceRetention()(ObjectID.generate(), ServiceType.DatabaseServer),
    ).resolves.toEqual({
      retainTelemetryDataForDays: null,
      telemetryRetentionConfig: null,
    });
  });
});

describe("TelemetryUsageBillingService.buildTelemetryRetentionMap", () => {
  type BuildTelemetryRetentionMap = (
    projectId: ObjectID,
  ) => Promise<Map<string, number>>;

  // Every other resource type answers "no rows" so only databases contribute.
  function stubOtherResourceTypes(): void {
    for (const service of [
      ServiceService,
      HostService,
      DockerHostService,
      PodmanHostService,
      KubernetesClusterService,
      ProxmoxClusterService,
      VMwareVCenterService,
      CephClusterService,
      IoTFleetService,
    ]) {
      jest
        .spyOn(service as unknown as { findBy: () => unknown }, "findBy")
        .mockResolvedValue([] as never);
    }
  }

  test("bills a database's telemetry at its own retention override", async () => {
    stubOtherResourceTypes();

    const projectId: ObjectID = ObjectID.generate();
    const withOverride: DatabaseServer = new DatabaseServer();
    withOverride._id = ObjectID.generate().toString();
    withOverride.retainTelemetryDataForDays = 90;

    const findBy: MockFunction = jest
      .spyOn(DatabaseServerService, "findBy")
      .mockResolvedValue([withOverride]) as unknown as MockFunction;

    const retention: Map<string, number> = await (
      TelemetryUsageBillingService as unknown as {
        buildTelemetryRetentionMap: BuildTelemetryRetentionMap;
      }
    ).buildTelemetryRetentionMap.call(TelemetryUsageBillingService, projectId);

    expect(retention.get(withOverride._id)).toBe(90);
    expect(retention.size).toBe(1);

    expect(findBy).toHaveBeenCalledTimes(1);
    const args: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      props: Dictionary<unknown>;
    } = findBy.mock.calls[0]![0] as {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      props: Dictionary<unknown>;
    };
    expect(args.query["projectId"]).toBe(projectId);
    // Only rows that carry an override are read — discovery can create hundreds.
    expect(args.query["retainTelemetryDataForDays"]).toBeDefined();
    expect(args.select).toEqual({
      _id: true,
      retainTelemetryDataForDays: true,
    });
    expect(args.props).toEqual({ isRoot: true });
  });

  test("ignores a database row without an override", async () => {
    stubOtherResourceTypes();

    const withoutOverride: DatabaseServer = new DatabaseServer();
    withoutOverride._id = ObjectID.generate().toString();

    jest
      .spyOn(DatabaseServerService, "findBy")
      .mockResolvedValue([withoutOverride]);

    const retention: Map<string, number> = await (
      TelemetryUsageBillingService as unknown as {
        buildTelemetryRetentionMap: BuildTelemetryRetentionMap;
      }
    ).buildTelemetryRetentionMap.call(
      TelemetryUsageBillingService,
      ObjectID.generate(),
    );

    expect(retention.size).toBe(0);
  });
});

describe("TelemetryServiceUtil.resolveTelemetryResource", () => {
  test("labels database telemetry, which has no Service row", () => {
    const resolved: ResolvedTelemetryResource =
      TelemetryServiceUtil.resolveTelemetryResource({
        primaryEntityId: ObjectID.generate(),
        primaryEntityType: ServiceType.DatabaseServer,
        services: [],
        projectId: ObjectID.generate(),
      });

    expect(resolved).toEqual({ label: "Database telemetry" });
  });
});

describe("TelemetryException @OwnedThrough", () => {
  const ownedThrough: OwnedThroughMetadata = (
    TelemetryException.prototype as unknown as {
      ownedThrough: OwnedThroughMetadata;
    }
  ).ownedThrough;

  test("a database's owners see the exceptions its telemetry raised", () => {
    expect(ownedThrough.fkColumn).toBe("primaryEntityId");
    expect(ownedThrough.parentModels).toContain(DatabaseServer);
    // Unattributed exceptions stay visible project-wide.
    expect(ownedThrough.includeProjectScope).toBe(true);
  });

  test("every parent resolves through a registered owner table", () => {
    for (const parentModel of ownedThrough.parentModels) {
      expect(OwnerTableRegistry.has(parentModel.name)).toBe(true);
    }
  });
});

describe("TelemetryUtil.getAttributesForDatabaseServerIdAndName", () => {
  test("stamps the database id and name, like the host stamp", () => {
    const databaseServerId: ObjectID = ObjectID.generate();

    expect(
      TelemetryUtil.getAttributesForDatabaseServerIdAndName({
        databaseServerId: databaseServerId,
        databaseServerName: "PostgreSQL db.prod:5432",
      }),
    ).toEqual({
      "oneuptime.database.server.id": databaseServerId.toString(),
      "oneuptime.database.server.name": "PostgreSQL db.prod:5432",
    });
  });

  test("the id stamp is the key monitor linking reads", () => {
    /*
     * Stamp (ingest) and read (SeriesResourceLabels) must agree on the
     * spelling, or a monitor grouped by the stamp links no database.
     */
    const stamped: Array<string> = Object.keys(
      TelemetryUtil.getAttributesForDatabaseServerIdAndName({
        databaseServerId: ObjectID.generate(),
        databaseServerName: "x",
      }),
    );

    const idKey: string | undefined = stamped.find((key: string): boolean => {
      return key.endsWith(".id");
    });

    expect(idKey).toBeDefined();
    expect(DatabaseServerIdLabelKeys).toContain(idKey);
    expect(DatabaseServerIdLabelKeys).toContain(`resource.${idKey}`);
  });
});
