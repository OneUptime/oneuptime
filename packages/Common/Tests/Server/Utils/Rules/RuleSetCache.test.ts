jest.mock("isolated-vm", () => {
  return {};
});

import Entities from "../../../../Models/DatabaseModels/Index";
import AlertIncidentRule from "../../../../Models/DatabaseModels/AlertIncidentRule";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import IncidentLabelRule from "../../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentPrivacyRule from "../../../../Models/DatabaseModels/IncidentPrivacyRule";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import CacheGenerations from "../../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Redis from "../../../../Server/Infrastructure/Redis";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Select from "../../../../Server/Types/Database/Select";
import RuleSetCache, {
  RELATED_COLUMNS_READ,
  RULE_SET_MODELS,
} from "../../../../Server/Utils/Rules/RuleSetCache";
import logger from "../../../../Server/Utils/Logger";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * A PROJECT'S RULES, READ ONCE AND KEPT UNTIL ANY OF THEM CHANGES
 * (RuleSetCache): what a read hands out is what a read of the database
 * would - the same call, the same rules in the same order, copies every
 * time - and every write that can change what a read returns starts a new
 * generation: of the rule's project for a rule, of every project for a
 * record a rule names (deleted, soft deleted, or a column read from it
 * written) and for a hook-free write of a rule. Redis is a map here, and the
 * schema the hooks read is the entities' own metadata.
 */

let redis: Map<string, string>;
let now: number;
let dataSource: DataSource;

// A rule service: what RuleSetCache asks of one.
interface FakeService<TModel extends BaseModel> {
  service: DatabaseService<TModel>;
  findBy: jest.Mock<(findBy: FindBy<TModel>) => Promise<Array<TModel>>>;
}

function fakeService<TModel extends BaseModel>(
  modelType: { new (): TModel },
  rows: () => Array<TModel>,
): FakeService<TModel> {
  const model: TModel = new modelType();
  const findBy: jest.Mock<(findBy: FindBy<TModel>) => Promise<Array<TModel>>> =
    jest.fn(async (): Promise<Array<TModel>> => {
      return rows();
    });

  return {
    findBy,
    service: {
      getModel: (): TModel => {
        return model;
      },
      findBy: findBy,
    } as unknown as DatabaseService<TModel>,
  };
}

function privacyRule(
  name: string,
  labelIds: Array<string>,
): IncidentPrivacyRule {
  const rule: IncidentPrivacyRule = new IncidentPrivacyRule();
  rule._id = ObjectID.generate().toString();
  rule.name = name;
  rule.criteria = { conditionGroups: [{ labelIds: [...labelIds] }] } as never;
  rule.createdAt = new Date("2026-11-01T00:00:00.000Z");
  rule.incidentLabels = labelIds.map((id: string): Label => {
    const label: Label = new Label();
    label._id = id;
    return label;
  });
  return rule;
}

const PRIVACY_SELECT: Select<IncidentPrivacyRule> = {
  _id: true,
  name: true,
  criteria: true,
  incidentLabels: { _id: true },
};

beforeAll(async () => {
  dataSource = new DataSource({ type: "postgres", entities: Entities });

  // The entities' metadata, as a connected data source holds it.
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

beforeEach(() => {
  redis = new Map<string, string>();
  now = 1_000_000;

  RuleSetCache.clear();

  jest.spyOn(Date, "now").mockImplementation(() => {
    return now;
  });

  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(dataSource);

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) ?? null;
    });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        redis.set(`${namespace}-${key}`, value);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
  RuleSetCache.clear();
});

describe("RuleSetCache: what a read hands out", () => {
  const projectId: ObjectID = ObjectID.generate();

  test("the read is the engines' own: project, enabled, the select, every rule up to the ceiling, as OneUptime", async () => {
    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      return [];
    });

    await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
      service,
      projectId,
      select: PRIVACY_SELECT,
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toEqual({
      query: { projectId: projectId, isEnabled: true },
      select: PRIVACY_SELECT,
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
    // No sort unless one is asked for: the service's own order, as before.
    expect(Object.keys(findBy.mock.calls[0]![0])).not.toContain("sort");
  });

  test("a trigger and an order are handed on as they were given", async () => {
    const { service, findBy } = fakeService(AutoRemediationRule, () => {
      return [];
    });

    await RuleSetCache.findEnabledRules<AutoRemediationRule>({
      service,
      projectId,
      select: { _id: true, runbooks: { _id: true, name: true } },
      query: { triggerEntityType: "Incident" } as never,
      sort: { createdAt: SortOrder.Ascending },
    });

    expect(findBy.mock.calls[0]![0]).toEqual({
      query: {
        projectId: projectId,
        isEnabled: true,
        triggerEntityType: "Incident",
      },
      select: { _id: true, runbooks: { _id: true, name: true } },
      sort: { createdAt: SortOrder.Ascending },
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("the rules are read once while nothing changes, in the order read", async () => {
    const rules: Array<IncidentPrivacyRule> = [
      privacyRule("Payments", ["a"]),
      privacyRule("Security", ["b", "c"]),
    ];
    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      return rules;
    });

    const first: Array<IncidentPrivacyRule> =
      await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service,
        projectId,
        select: PRIVACY_SELECT,
      });
    const second: Array<IncidentPrivacyRule> =
      await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service,
        projectId,
        select: PRIVACY_SELECT,
      });

    expect(findBy).toHaveBeenCalledTimes(1);

    for (const handedOut of [first, second]) {
      expect(
        handedOut.map((rule: IncidentPrivacyRule) => {
          return rule.name;
        }),
      ).toEqual(["Payments", "Security"]);
      expect(
        handedOut[1]!.incidentLabels!.map((label: Label) => {
          return label.id!.toString();
        }),
      ).toEqual(["b", "c"]);
      expect(handedOut[0]!.id!.toString()).toBe(rules[0]!.id!.toString());
      expect(handedOut[0]).toBeInstanceOf(IncidentPrivacyRule);
      expect(handedOut[0]!.incidentLabels![0]).toBeInstanceOf(Label);
      expect(handedOut[0]!.createdAt).toEqual(rules[0]!.createdAt);
      expect(handedOut[0]!.criteria).toEqual(rules[0]!.criteria);
    }
  });

  test("every caller gets its own copies: nothing a caller does reaches the next", async () => {
    const rules: Array<IncidentPrivacyRule> = [privacyRule("Payments", ["a"])];
    const { service } = fakeService(IncidentPrivacyRule, () => {
      return rules;
    });

    const read: () => Promise<Array<IncidentPrivacyRule>> = async () => {
      return await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service,
        projectId,
        select: PRIVACY_SELECT,
      });
    };

    const first: Array<IncidentPrivacyRule> = await read();

    first[0]!.name = "Changed by an engine";
    first[0]!.incidentLabels!.push(new Label());
    first[0]!.incidentLabels![0]!._id = "z";
    (
      first[0]!.criteria as unknown as {
        conditionGroups: Array<{ labelIds: Array<string> }>;
      }
    ).conditionGroups[0]!.labelIds.push("z");
    first[0]!.createdAt!.setFullYear(1999);
    first.push(privacyRule("Pushed", []));

    const second: Array<IncidentPrivacyRule> = await read();

    expect(second).toHaveLength(1);
    expect(second[0]!.name).toBe("Payments");
    expect(second[0]!.incidentLabels).toHaveLength(1);
    expect(second[0]!.incidentLabels![0]!.id!.toString()).toBe("a");
    expect(second[0]!.criteria).toEqual({
      conditionGroups: [{ labelIds: ["a"] }],
    });
    expect(second[0]!.createdAt!.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(second[0]).not.toBe(first[0]);
    // Nor what the read itself returned.
    expect(second[0]).not.toBe(rules[0]);
    expect(rules[0]!.name).toBe("Payments");
  });

  test("a copy keeps ids, maps and sets apart too", () => {
    const rule: IncidentPrivacyRule = privacyRule("Payments", ["a"]);
    const id: ObjectID = ObjectID.generate();
    (rule as unknown as Record<string, unknown>)["extra"] = {
      id: id,
      byName: new Map<string, Array<string>>([["x", ["1"]]]),
      names: new Set<string>(["y"]),
    };

    const copy: IncidentPrivacyRule = RuleSetCache.copy(rule);
    const extra: {
      id: ObjectID;
      byName: Map<string, Array<string>>;
      names: Set<string>;
    } = (copy as unknown as Record<string, never>)["extra"];

    expect(extra.id).not.toBe(id);
    expect(extra.id.toString()).toBe(id.toString());
    expect(extra.byName.get("x")).toEqual(["1"]);
    extra.byName.get("x")!.push("2");
    extra.names.add("z");

    const original: {
      byName: Map<string, Array<string>>;
      names: Set<string>;
    } = (rule as unknown as Record<string, never>)["extra"];
    expect(original.byName.get("x")).toEqual(["1"]);
    expect(Array.from(original.names)).toEqual(["y"]);
  });

  test("callers that ask together share one read", async () => {
    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      return [privacyRule("Payments", ["a"])];
    });

    const results: Array<Array<IncidentPrivacyRule>> = await Promise.all(
      [1, 2, 3, 4, 5].map(() => {
        return RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
          service,
          projectId,
          select: PRIVACY_SELECT,
        });
      }),
    );

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(
      results.map((rules: Array<IncidentPrivacyRule>) => {
        return rules[0]!.name;
      }),
    ).toEqual(["Payments", "Payments", "Payments", "Payments", "Payments"]);
  });

  test("projects, selects, triggers and orders are kept apart", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();
    const { service, findBy } = fakeService(AutoRemediationRule, () => {
      return [];
    });

    const reads: Array<{
      projectId: ObjectID;
      select: Select<AutoRemediationRule>;
      trigger: string;
      sort?: Record<string, SortOrder>;
    }> = [
      { projectId, select: { _id: true }, trigger: "Incident" },
      { projectId: otherProjectId, select: { _id: true }, trigger: "Incident" },
      { projectId, select: { _id: true, name: true }, trigger: "Incident" },
      { projectId, select: { _id: true }, trigger: "Alert" },
      {
        projectId,
        select: { _id: true },
        trigger: "Incident",
        sort: { createdAt: SortOrder.Ascending },
      },
    ];

    for (const read of reads) {
      await RuleSetCache.findEnabledRules<AutoRemediationRule>({
        service,
        projectId: read.projectId,
        select: read.select,
        query: { triggerEntityType: read.trigger } as never,
        sort: read.sort as never,
      });
    }

    expect(findBy).toHaveBeenCalledTimes(reads.length);

    // And each is kept: none is read again.
    for (const read of reads) {
      await RuleSetCache.findEnabledRules<AutoRemediationRule>({
        service,
        projectId: read.projectId,
        select: { ...read.select },
        query: { triggerEntityType: read.trigger } as never,
        sort: read.sort as never,
      });
    }

    expect(findBy).toHaveBeenCalledTimes(reads.length);
  });

  test("a project id is one key however it is written", async () => {
    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      return [];
    });

    await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
      service,
      projectId: new ObjectID(projectId.toString().toUpperCase()),
      select: PRIVACY_SELECT,
    });
    await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
      service,
      projectId: projectId,
      select: PRIVACY_SELECT,
    });

    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("a read that failed is not kept", async () => {
    let fails: boolean = true;
    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      if (fails) {
        throw new Error("connection terminated");
      }

      return [privacyRule("Payments", ["a"])];
    });

    await expect(
      RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service,
        projectId,
        select: PRIVACY_SELECT,
      }),
    ).rejects.toThrow("connection terminated");

    fails = false;

    expect(
      await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service,
        projectId,
        select: PRIVACY_SELECT,
      }),
    ).toHaveLength(1);
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("nothing is kept while Redis is not connected: the rules are read every time", async () => {
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);

    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      return [privacyRule("Payments", ["a"])];
    });

    for (let i: number = 0; i < 3; i++) {
      await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service,
        projectId,
        select: PRIVACY_SELECT,
      });
    }

    expect(findBy).toHaveBeenCalledTimes(3);
    expect(GlobalCache.getString).not.toHaveBeenCalled();
  });

  test("an entry runs out after ENTRY_TTL_MS, whatever its generation says", async () => {
    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      return [];
    });

    const read: () => Promise<unknown> = async () => {
      return await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service,
        projectId,
        select: PRIVACY_SELECT,
      });
    };

    await read();
    now += RuleSetCache.ENTRY_TTL_MS - 1;
    await read();
    expect(findBy).toHaveBeenCalledTimes(1);

    now += 2;
    await read();
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a read of a model outside RULE_SET_MODELS is read every time, and said once", async () => {
    const { service, findBy } = fakeService(TelemetryException, () => {
      return [];
    });

    for (let i: number = 0; i < 3; i++) {
      await RuleSetCache.findEnabledRules<TelemetryException>({
        service,
        projectId,
        select: { _id: true },
      });
    }

    expect(findBy).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("a read that takes a column of a named record outside RELATED_COLUMNS_READ is read every time", async () => {
    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      return [];
    });

    for (let i: number = 0; i < 2; i++) {
      await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service,
        projectId,
        // A label's name is not watched: a rename would start no generation.
        select: { _id: true, incidentLabels: { _id: true, name: true } },
      });
    }

    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a read with a condition that is not a plain value is read every time", async () => {
    const { service, findBy } = fakeService(AutoRemediationRule, () => {
      return [];
    });

    for (let i: number = 0; i < 2; i++) {
      await RuleSetCache.findEnabledRules<AutoRemediationRule>({
        service,
        projectId,
        select: { _id: true },
        query: {
          triggerEntityType: QueryHelper.any(["Incident", "Alert"]),
        } as never,
      });
    }

    expect(findBy).toHaveBeenCalledTimes(2);
  });
});

describe("RuleSetCache: what starts a new generation", () => {
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  // Reads the project's privacy rules, and says how many reads were made.
  function reader(): {
    read: (project?: ObjectID) => Promise<Array<IncidentPrivacyRule>>;
    reads: () => number;
  } {
    const { service, findBy } = fakeService(IncidentPrivacyRule, () => {
      return [privacyRule("Payments", ["a"])];
    });

    return {
      read: async (project?: ObjectID) => {
        return await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
          service,
          projectId: project || projectId,
          select: PRIVACY_SELECT,
        });
      },
      reads: () => {
        return findBy.mock.calls.length;
      },
    };
  }

  function projectRow(id: ObjectID): Record<string, unknown> {
    return { _id: ObjectID.generate().toString(), projectId: id };
  }

  test("a rule created: its project's rules are read again here at once, the other project's are kept", async () => {
    const { read, reads } = reader();

    await read(projectId);
    await read(otherProjectId);

    await RuleSetCache.afterCreate({
      tableName: "IncidentPrivacyRule",
      row: projectRow(projectId),
    });

    await read(projectId);
    await read(otherProjectId);

    expect(reads()).toBe(3);
  });

  test.each(
    RULE_SET_MODELS.map((modelType: { new (): BaseModel }) => {
      return new modelType().tableName!;
    }),
  )(
    "a %s created, updated or deleted starts a new generation of its project",
    async (tableName: string) => {
      const { read, reads } = reader();

      await read();
      await RuleSetCache.afterCreate({ tableName, row: projectRow(projectId) });
      await read();
      expect(reads()).toBe(2);

      await RuleSetCache.afterUpdate({
        tableName,
        rows: [projectRow(projectId)],
        written: { name: "Renamed" },
      });
      await read();
      expect(reads()).toBe(3);

      await RuleSetCache.afterDelete({
        tableName,
        rows: [projectRow(projectId)],
      });
      await read();
      expect(reads()).toBe(4);

      // Hook-free: the write does not say whose, so every project's.
      await RuleSetCache.afterWriteWithoutHooks({
        tableName,
        written: { isEnabled: false },
      });
      await read();
      expect(reads()).toBe(5);
    },
  );

  test("a rule written in another process is read once Redis is read again", async () => {
    const { read, reads } = reader();

    await read();

    // Another process's bump: a new shared generation of the project.
    redis.set(
      `rule-set-generation-${projectId.toString().toLowerCase()}`,
      CacheGenerations.newToken(),
    );

    await read();
    expect(reads()).toBe(1);

    now += CacheGenerations.SHARED_READ_TTL_MS + 1;

    await read();
    expect(reads()).toBe(2);
  });

  test("a rule of unknown project starts a new generation of every project", async () => {
    const { read, reads } = reader();

    await read(projectId);
    await read(otherProjectId);

    await RuleSetCache.afterUpdate({
      tableName: "IncidentPrivacyRule",
      rows: [{ _id: ObjectID.generate().toString() }],
      written: { name: "Renamed" },
    });

    await read(projectId);
    await read(otherProjectId);

    expect(reads()).toBe(4);
  });

  test.each([
    ["Label"],
    ["Monitor"],
    ["IncidentSeverity"],
    ["AlertSeverity"],
    ["Team"],
    ["User"],
    ["OnCallDutyPolicy"],
    ["Runbook"],
    ["Service"],
    ["Runner"],
    ["ExternalMcpServer"],
    ["CodeRepository"],
    ["LlmProvider"],
    ["IncidentRole"],
    ["IncidentPrivacyRuleIncidentLabel"],
    ["IncidentOwnerRuleOwnerTeam"],
    ["Project"],
    // A person's picture: the database deletes the person with it.
    ["File"],
  ])(
    "a %s deleted starts a new generation of every project: the database takes it out of the rules",
    async (tableName: string) => {
      const { read, reads } = reader();

      await read(projectId);
      await read(otherProjectId);

      await RuleSetCache.afterDelete({
        tableName,
        rows: [projectRow(ObjectID.generate())],
      });

      await read(projectId);
      await read(otherProjectId);

      expect(reads()).toBe(4);
    },
  );

  test.each([
    ["Probe"],
    ["IncidentNote"],
    ["MonitorStatus"],
    ["TelemetryException"],
  ])("a %s deleted keeps every project's rules", async (tableName: string) => {
    const { read, reads } = reader();

    await read();

    await RuleSetCache.afterDelete({
      tableName,
      rows: [projectRow(projectId)],
    });

    await read();

    expect(reads()).toBe(1);
  });

  test("a delete that removed nothing starts nothing", async () => {
    const { read, reads } = reader();

    await read();
    await RuleSetCache.afterDelete({ tableName: "Label", rows: [] });
    await RuleSetCache.afterDelete({
      tableName: "IncidentPrivacyRule",
      rows: [],
    });
    await read();

    expect(reads()).toBe(1);
  });

  test("a runbook renamed starts a new generation of every project; any other runbook write does not", async () => {
    expect(RELATED_COLUMNS_READ["Runbook"]).toEqual(["name"]);

    const { read, reads } = reader();

    await read();

    await RuleSetCache.afterUpdate({
      tableName: "Runbook",
      rows: [projectRow(projectId)],
      written: { description: "Steps" },
    });
    await read();
    expect(reads()).toBe(1);

    await RuleSetCache.afterUpdate({
      tableName: "Runbook",
      rows: [projectRow(projectId)],
      written: { name: "Restart the payments pods" },
    });
    await read();
    expect(reads()).toBe(2);

    await RuleSetCache.afterWriteWithoutHooks({
      tableName: "Runbook",
      written: { name: "Restart the payments pods again" },
    });
    await read();
    expect(reads()).toBe(3);
  });

  test("a named record soft deleted (or brought back) starts a new generation of every project", async () => {
    const { read, reads } = reader();

    await read();

    await RuleSetCache.afterUpdate({
      tableName: "Label",
      rows: [projectRow(projectId)],
      written: { deletedAt: new Date() },
    });
    await read();
    expect(reads()).toBe(2);

    await RuleSetCache.afterWriteWithoutHooks({
      tableName: "Monitor",
      written: { deletedAt: null },
    });
    await read();
    expect(reads()).toBe(3);
  });

  test("the writes a monitor check makes keep every project's rules", async () => {
    const { read, reads } = reader();

    await read();

    await RuleSetCache.afterUpdate({
      tableName: "Monitor",
      rows: [projectRow(projectId)],
      written: { currentMonitorStatusId: ObjectID.generate(), name: "API" },
    });
    await RuleSetCache.afterWriteWithoutHooks({
      tableName: "Monitor",
      written: { lastMonitoredAt: new Date() },
    });
    await RuleSetCache.afterCreate({
      tableName: "Monitor",
      row: projectRow(projectId),
    });
    await RuleSetCache.afterCreate({
      tableName: "Label",
      row: projectRow(projectId),
    });
    await read();

    expect(reads()).toBe(1);
  });

  test("a hook that cannot work out the schema starts a new generation of every project, and never throws", async () => {
    const { read, reads } = reader();

    await read(projectId);
    await read(otherProjectId);

    jest.spyOn(PostgresAppInstance, "getDataSource").mockImplementation(() => {
      throw new Error("no data source");
    });

    await expect(
      RuleSetCache.afterDelete({
        tableName: "Label",
        rows: [projectRow(projectId)],
      }),
    ).resolves.toBeUndefined();

    await read(projectId);
    await read(otherProjectId);

    expect(reads()).toBe(4);
  });

  test("a change Redis did not take still counts in this process", async () => {
    const { read, reads } = reader();

    await read();

    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Redis is down"));

    await RuleSetCache.afterCreate({
      tableName: "IncidentPrivacyRule",
      row: projectRow(projectId),
    });

    await read();
    expect(reads()).toBe(2);
  });
});

describe("RuleSetCache: the tables whose writes start a new generation", () => {
  test("the rules' tables, their lists' and every record they name - and what the database deletes those with", () => {
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(dataSource);

    const tables: ReturnType<typeof RuleSetCache.getTables> =
      RuleSetCache.getTables();

    expect(tables).not.toBeNull();

    for (const modelType of RULE_SET_MODELS) {
      expect(tables!.ruleTables.has(new modelType().tableName!)).toBe(true);
    }

    // Every list of every rule kept.
    for (const metadata of dataSource.entityMetadatas) {
      if (!tables!.ruleTables.has(metadata.tableName)) {
        continue;
      }

      for (const relation of metadata.relations) {
        expect(
          tables!.namedTables.has(relation.inverseEntityMetadata.tableName),
        ).toBe(true);
        expect(
          tables!.deleteTables.has(relation.inverseEntityMetadata.tableName),
        ).toBe(true);

        if (relation.junctionEntityMetadata) {
          expect(
            tables!.ruleTables.has(relation.junctionEntityMetadata.tableName),
          ).toBe(true);
        }
      }
    }

    for (const tableName of [
      "IncidentPrivacyRuleMonitor",
      "AutoRemediationRuleRunbook",
      "IncidentGroupingRuleEpisodeMemberRole",
    ]) {
      expect(tables!.ruleTables.has(tableName)).toBe(true);
    }

    for (const tableName of [
      "Label",
      "Monitor",
      "IncidentSeverity",
      "AlertSeverity",
      "Team",
      "User",
      "OnCallDutyPolicy",
      "Runbook",
      "Service",
      "Runner",
      "ExternalMcpServer",
      "CodeRepository",
      "LlmProvider",
      "IncidentRole",
    ]) {
      expect(tables!.namedTables.has(tableName)).toBe(true);
    }

    // Deleted with a named record: a person with their picture, and the project.
    expect(tables!.deleteTables.has("File")).toBe(true);
    expect(tables!.deleteTables.has("Project")).toBe(true);

    for (const tableName of [
      "Probe",
      "IncidentNote",
      "MonitorStatus",
      "TelemetryException",
      "Incident",
      "Alert",
    ]) {
      expect(tables!.deleteTables.has(tableName)).toBe(false);
    }
  });

  test("the tables are worked out once per data source", () => {
    const build: jest.SpiedFunction<typeof RuleSetCache.buildTables> =
      jest.spyOn(RuleSetCache, "buildTables");

    RuleSetCache.getTables();
    RuleSetCache.getTables();

    expect(build).toHaveBeenCalledTimes(1);
  });

  test("before there is a data source, nothing is worked out", () => {
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);

    expect(RuleSetCache.getTables()).toBeNull();
  });

  test("a rule's SET NULL parent counts, a named record's does not", () => {
    const tables: ReturnType<typeof RuleSetCache.buildTables> =
      RuleSetCache.buildTables(dataSource.entityMetadatas);

    // Monitor.monitorTemplateId is SET NULL: a template deleted changes no rule.
    expect(tables.deleteTables.has("MonitorTemplate")).toBe(false);
  });

  test("every model kept reads through a select RuleSetCache keeps (the engines' own selects)", () => {
    expect(
      RULE_SET_MODELS.map((modelType: { new (): BaseModel }) => {
        return modelType.name;
      }),
    ).toEqual([
      "IncidentPrivacyRule",
      "IncidentOwnerRule",
      "IncidentLabelRule",
      "IncidentOnCallRule",
      "IncidentGroupingRule",
      "AlertPrivacyRule",
      "AlertOwnerRule",
      "AlertLabelRule",
      "AlertOnCallRule",
      "AlertGroupingRule",
      "AlertIncidentRule",
      "RunbookRule",
      "AutoRemediationRule",
    ]);

    // A select of a model kept, with a runbook's name, is keyed.
    const { service } = fakeService(AutoRemediationRule, () => {
      return [];
    });

    expect(
      RuleSetCache.getReadKey<AutoRemediationRule>({
        service,
        projectId: ObjectID.generate(),
        select: { _id: true, runbooks: { _id: true, name: true } },
      }),
    ).not.toBeNull();

    const { service: alertIncidentRules } = fakeService(
      AlertIncidentRule,
      () => {
        return [];
      },
    );

    expect(
      RuleSetCache.getReadKey<AlertIncidentRule>({
        service: alertIncidentRules,
        projectId: ObjectID.generate(),
        select: { _id: true, monitors: { _id: true } },
        sort: { order: SortOrder.Ascending },
      }),
    ).not.toBeNull();

    const { service: labelRules } = fakeService(IncidentLabelRule, () => {
      return [];
    });

    expect(
      RuleSetCache.getReadKey<IncidentLabelRule>({
        service: labelRules,
        projectId: ObjectID.generate(),
        // A monitor's name is not watched.
        select: { _id: true, monitors: { _id: true, name: true } },
      }),
    ).toBeNull();

    expect(new Runbook().tableName).toBe("Runbook");
    expect(new Monitor().tableName).toBe("Monitor");
  });
});
