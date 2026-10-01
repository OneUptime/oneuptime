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
import DatabaseServerLabelRule from "../../../Models/DatabaseModels/DatabaseServerLabelRule";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import MessageQueueLabelRule from "../../../Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueOwnerRule from "../../../Models/DatabaseModels/MessageQueueOwnerRule";
import MessageQueueOwnerTeam from "../../../Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "../../../Models/DatabaseModels/MessageQueueOwnerUser";
import MonitorLabelRule from "../../../Models/DatabaseModels/MonitorLabelRule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import BaseService from "../../../Server/Services/BaseService";
import MessageQueueLabelRuleEngineService from "../../../Server/Services/MessageQueueLabelRuleEngineService";
import MessageQueueLabelRuleService from "../../../Server/Services/MessageQueueLabelRuleService";
import MessageQueueOwnerRuleEngineService from "../../../Server/Services/MessageQueueOwnerRuleEngineService";
import MessageQueueOwnerRuleService from "../../../Server/Services/MessageQueueOwnerRuleService";
import MessageQueueOwnerTeamService from "../../../Server/Services/MessageQueueOwnerTeamService";
import MessageQueueOwnerUserService from "../../../Server/Services/MessageQueueOwnerUserService";
import MessageQueueService from "../../../Server/Services/MessageQueueService";
import Services from "../../../Server/Services/Index";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import { getAffectedResourceRelations } from "../../../Server/Utils/Database/AffectedResourceRelations";
import { ProjectScopedRelation } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RuleRunRegistry, {
  RuleRunDefinition,
} from "../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import ProjectLeaveResourceCleanup, {
  OwnerUserTable,
} from "../../../Server/Utils/TeamMember/ProjectLeaveResourceCleanup";
import { OwnedThroughMetadata } from "../../../Types/Database/AccessControl/OwnedThrough";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import {
  RULE_RUN_TYPE_METADATA,
  RuleRunAction,
  RuleRunType,
} from "../../../Types/Rules/RuleRun";
import RULE_CRITERIA_FIELDS_BY_MODEL, {
  getRuleCriteriaFieldsForModel,
} from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import LabelRuleImportExport, {
  LABEL_RULE_MODELS,
  ParsedLabelRuleImport,
} from "../../../Utils/LabelRuleImportExport";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Pins every server-side registry the Queues resource type (the
 * MessageQueue model family) has to appear in. Each of these is a hand-kept
 * list: forgetting one does not fail to compile, it silently drops the
 * feature for queues only — no workflow component or hard-delete purge, an
 * Owned scope that shows everybody every queue, a "Run now" button that
 * answers "cannot be run", a departed user still listed as an owner, and so
 * on. Every assertion names the exact object registered, not just
 * "something is there".
 *
 * Just as deliberately, what a queue is NOT: it owns no telemetry row
 * (messaging spans belong to the producing and consuming services, and a
 * queue's telemetry is selected by its entity key), so it has no
 * canOwnTelemetry entry, no TelemetryException parent and no affected-resource
 * relation on incidents, alerts or scheduled maintenance.
 */

const CRITERIA_FIELDS: Array<string> = [
  "messageQueueLabels",
  "messageQueueNamePattern",
  "messageQueueDescriptionPattern",
  "messageQueueSystemPattern",
];

const SERVICES_ROOT: string = path.join(__dirname, "../../../Server/Services");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Server/Services/Index", () => {
  test.each([
    ["MessageQueueService", MessageQueueService],
    ["MessageQueueOwnerTeamService", MessageQueueOwnerTeamService],
    ["MessageQueueOwnerUserService", MessageQueueOwnerUserService],
    ["MessageQueueLabelRuleService", MessageQueueLabelRuleService],
    ["MessageQueueOwnerRuleService", MessageQueueOwnerRuleService],
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
      MessageQueueLabelRuleEngineService as unknown as BaseService,
    );
    expect(Services).not.toContain(
      MessageQueueOwnerRuleEngineService as unknown as BaseService,
    );
  });

  test("every service is its model's", () => {
    for (const [service, modelType] of [
      [MessageQueueService, MessageQueue],
      [MessageQueueOwnerTeamService, MessageQueueOwnerTeam],
      [MessageQueueOwnerUserService, MessageQueueOwnerUser],
      [MessageQueueLabelRuleService, MessageQueueLabelRule],
      [MessageQueueOwnerRuleService, MessageQueueOwnerRule],
    ] as Array<[{ modelType: unknown }, unknown]>) {
      expect(service.modelType).toBe(modelType);
    }
  });
});

describe("OwnerTableRegistry", () => {
  test("registers MessageQueue with its owner tables and FK column", () => {
    const entry: OwnerTablePair | undefined =
      OwnerTableRegistry.get("MessageQueue");

    expect(entry).toBeDefined();
    expect(entry!.ownerUserService).toBe(MessageQueueOwnerUserService);
    expect(entry!.ownerTeamService).toBe(MessageQueueOwnerTeamService);
    expect(entry!.fkColumn).toBe("messageQueueId");
  });

  test("owns no telemetry: no canOwnTelemetry, no model service", () => {
    /*
     * Only entries flagged canOwnTelemetry are unioned into the Owned /
     * Labels telemetry scope; a queue is never a telemetry row's
     * primaryEntityId, so flagging it would scope on nothing.
     */
    const entry: OwnerTablePair = OwnerTableRegistry.get("MessageQueue")!;

    expect(entry.canOwnTelemetry).toBeFalsy();
    expect(entry.modelService).toBeUndefined();
  });

  test("the registry key is the model class name the Owned scope resolves by", () => {
    // OwnedScopePermission looks entries up by `modelType.name`.
    expect(MessageQueue.name).toBe("MessageQueue");
  });

  test("both owner tables carry the registered FK column", () => {
    for (const ownerModel of [
      new MessageQueueOwnerUser(),
      new MessageQueueOwnerTeam(),
    ]) {
      expect(ownerModel.hasColumn("messageQueueId")).toBe(true);
      expect(ownerModel.hasColumn("projectId")).toBe(true);
    }
  });
});

describe("ProjectLeaveResourceCleanup", () => {
  test("removes a departed user's queue owner rows, all of them", () => {
    const tables: Array<OwnerUserTable> =
      ProjectLeaveResourceCleanup.getOwnerUserTables().filter(
        (table: OwnerUserTable): boolean => {
          return (
            (table.service as unknown as BaseService) ===
            (MessageQueueOwnerUserService as unknown as BaseService)
          );
        },
      );

    expect(tables).toHaveLength(1);
    expect(tables[0]!.resourceIdColumn).toBe("messageQueueId");
    // A queue does not open and close: every owner row goes.
    expect(tables[0]!.lifecycle).toBeUndefined();
  });
});

describe("RuleRun types", () => {
  test.each([
    [RuleRunType.MessageQueueLabelRule, RuleRunAction.AddLabels],
    [RuleRunType.MessageQueueOwnerRule, RuleRunAction.AddOwners],
  ])(
    "%s is the rule model's tableName and reads 'queue' / 'queues'",
    (ruleType: RuleRunType, action: RuleRunAction) => {
      expect(RULE_RUN_TYPE_METADATA[ruleType]).toEqual({
        action: action,
        resourceSingular: "queue",
        resourcePlural: "queues",
      });
    },
  );

  test("the enum values are the rule tables' names", () => {
    expect(RuleRunType.MessageQueueLabelRule).toBe(
      new MessageQueueLabelRule().tableName,
    );
    expect(RuleRunType.MessageQueueOwnerRule).toBe(
      new MessageQueueOwnerRule().tableName,
    );
  });

  test("no other runnable rule already reads 'queues'", () => {
    const owners: Array<string> = Object.values(RuleRunType).filter(
      (ruleType: RuleRunType): boolean => {
        return RULE_RUN_TYPE_METADATA[ruleType].resourcePlural === "queues";
      },
    );

    expect(owners.sort()).toEqual([
      RuleRunType.MessageQueueLabelRule,
      RuleRunType.MessageQueueOwnerRule,
    ]);
  });
});

describe("RuleRunRegistry", () => {
  test("wires the label rule to its model, services and engine", () => {
    const definition: RuleRunDefinition | null = RuleRunRegistry.getDefinition(
      RuleRunType.MessageQueueLabelRule,
    );

    expect(definition).not.toBeNull();
    expect(definition!.ruleModelType).toBe(MessageQueueLabelRule);
    expect(definition!.resourceModelType).toBe(MessageQueue);
    expect(definition!.ruleService).toBe(MessageQueueLabelRuleService);
    expect(definition!.resourceService).toBe(MessageQueueService);
    expect(definition!.engine).toBe(MessageQueueLabelRuleEngineService);
    expect(definition!.ownerModelTypes).toBeUndefined();
  });

  test("wires the owner rule to its model, services, engine and owner rows", () => {
    const definition: RuleRunDefinition | null = RuleRunRegistry.getDefinition(
      RuleRunType.MessageQueueOwnerRule,
    );

    expect(definition).not.toBeNull();
    expect(definition!.ruleModelType).toBe(MessageQueueOwnerRule);
    expect(definition!.resourceModelType).toBe(MessageQueue);
    expect(definition!.ruleService).toBe(MessageQueueOwnerRuleService);
    expect(definition!.resourceService).toBe(MessageQueueService);
    expect(definition!.engine).toBe(MessageQueueOwnerRuleEngineService);
    expect(definition!.ownerModelTypes).toEqual([
      MessageQueueOwnerUser,
      MessageQueueOwnerTeam,
    ]);
  });

  test("neither queue rule is a self-syncing monitor rule", () => {
    expect(
      RuleRunRegistry.isSyncRuleRunType(RuleRunType.MessageQueueLabelRule),
    ).toBe(false);
    expect(
      RuleRunRegistry.isSyncRuleRunType(RuleRunType.MessageQueueOwnerRule),
    ).toBe(false);
  });

  test("a run hands the engines only the queue's id and project - they re-read the rest", () => {
    for (const engine of [
      MessageQueueLabelRuleEngineService,
      MessageQueueOwnerRuleEngineService,
    ]) {
      expect(engine.resourceSelectForRuleRun).toEqual({
        _id: true,
        projectId: true,
      });
    }
  });
});

describe("RuleCriteriaFieldRegistry", () => {
  test.each([["MessageQueueLabelRule"], ["MessageQueueOwnerRule"]])(
    "%s allows exactly the four queue criteria fields",
    (modelName: string) => {
      expect(RULE_CRITERIA_FIELDS_BY_MODEL[modelName]).toEqual(CRITERIA_FIELDS);
      expect(getRuleCriteriaFieldsForModel(modelName)).toEqual(CRITERIA_FIELDS);
    },
  );

  test.each([
    ["MessageQueueLabelRule", MessageQueueLabelRule],
    ["MessageQueueOwnerRule", MessageQueueOwnerRule],
  ])(
    "every %s criteria field is a real column of the rule model",
    (_name: string, modelType: DatabaseBaseModelType) => {
      const model: BaseModel = new modelType();

      for (const field of CRITERIA_FIELDS) {
        expect(model.hasColumn(field)).toBe(true);
      }

      expect(model.getTableColumnMetadata("messageQueueLabels").type).toBe(
        TableColumnType.EntityArray,
      );
      expect(
        model.getTableColumnMetadata("messageQueueSystemPattern").type,
      ).toBe(TableColumnType.LongText);
    },
  );

  test("both engines select every criteria field they evaluate", () => {
    for (const ruleSelect of [
      MessageQueueLabelRuleEngineService.ruleSelect,
      MessageQueueOwnerRuleEngineService.ruleSelect,
    ]) {
      const select: Dictionary<unknown> = ruleSelect as Dictionary<unknown>;

      expect(select["criteria"]).toBe(true);

      for (const field of CRITERIA_FIELDS) {
        expect(select[field]).toBeDefined();
      }
    }
  });

  test.each([
    ["MessageQueueLabelRuleEngineService.ts"],
    ["MessageQueueOwnerRuleEngineService.ts"],
  ])(
    "%s evaluates exactly the registered fields through the shared matcher",
    (fileName: string) => {
      /*
       * StaticRuleCriteriaRuntimeCoverage resolves the evaluator by this
       * file name and compares its legacyFields with the dashboard form;
       * here the same list is held against the registry itself, so the two
       * sides agree before any form exists.
       */
      const source: string = fs.readFileSync(
        path.join(SERVICES_ROOT, fileName),
        "utf8",
      );
      const legacyFields: RegExpMatchArray | null = source.match(
        /legacyFields\s*:\s*\[([\s\S]*?)\]/,
      );

      expect(source).toContain("RuleCriteriaMatcher.matchesWithLegacySync(");
      expect(source).toMatch(/criteria\s*:\s*true/);
      expect(legacyFields).not.toBeNull();
      expect(
        [...legacyFields![1]!.matchAll(/"([A-Za-z]+)"/g)].map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ).toEqual(CRITERIA_FIELDS);
    },
  );
});

describe("LabelRuleImportExport", () => {
  test("queue label rules travel as portable files; owner rules do not", () => {
    expect(LABEL_RULE_MODELS).toContain(MessageQueueLabelRule);
    expect(LABEL_RULE_MODELS).not.toContain(MessageQueueOwnerRule);
    expect(
      LABEL_RULE_MODELS.filter((modelType: DatabaseBaseModelType): boolean => {
        return modelType === MessageQueueLabelRule;
      }),
    ).toHaveLength(1);
  });

  /*
   * The messaging system pattern is the one criteria field queue rules have
   * beyond the name, description and labels every label rule shares, so the
   * shared round-trip sweep (LabelRuleImportExport.test.ts) never sets it.
   * Were it to drop out of the file - an empty create or read permission is
   * enough (ModelImportExport.getImportExportableColumnNames) - an exported
   * "Kafka only" rule would re-import as one that labels every queue.
   */
  function kafkaTopicsRule(): MessageQueueLabelRule {
    const label: Label = new Label();
    label._id = "11111111-1111-4111-8111-111111111111";
    label.name = "Kafka";

    const rule: MessageQueueLabelRule = new MessageQueueLabelRule();
    rule._id = "22222222-2222-4222-8222-222222222222";
    rule.name = "Kafka topics";
    rule.isEnabled = true;
    rule.messageQueueLabels = [];
    rule.labelsToAdd = [label];
    rule.messageQueueSystemPattern = "^kafka$";
    return rule;
  }

  function exportFile(rule: MessageQueueLabelRule): string {
    return JSON.stringify(
      LabelRuleImportExport.buildExportEnvelope({
        modelType: MessageQueueLabelRule,
        items: [rule],
      }),
    );
  }

  test("the file carries every criteria field of a queue rule", () => {
    expect(LabelRuleImportExport.getColumns(MessageQueueLabelRule)).toEqual(
      expect.arrayContaining([...CRITERIA_FIELDS, "criteria"]),
    );
  });

  test("a messaging system pattern survives export and import", () => {
    const fileText: string = exportFile(kafkaTopicsRule());

    expect(
      (JSON.parse(fileText)["items"] as Array<JSONObject>)[0],
    ).toMatchObject({
      name: "Kafka topics",
      messageQueueSystemPattern: "^kafka$",
      labelsToAdd: ["Kafka"],
    });

    const parsed: ParsedLabelRuleImport = LabelRuleImportExport.parse({
      modelType: MessageQueueLabelRule,
      fileText,
    });

    expect(parsed.items[0]!.json).toMatchObject({
      name: "Kafka topics",
      isEnabled: true,
      messageQueueSystemPattern: "^kafka$",
      messageQueueLabels: [],
      labelsToAdd: ["Kafka"],
    });
  });

  test("a match-criteria filter on the messaging system survives export and import", () => {
    const rule: MessageQueueLabelRule = kafkaTopicsRule();
    const criteria: RuleCriteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "messageQueueSystemPattern",
          operator: RuleCriteriaOperator.MatchesPattern,
          value: "^kafka$",
        },
        {
          field: "messageQueueNamePattern",
          operator: RuleCriteriaOperator.StartsWith,
          value: "orders.",
        },
      ],
    };
    delete rule.messageQueueSystemPattern;
    rule.criteria = criteria;

    const fileText: string = exportFile(rule);

    expect(
      (JSON.parse(fileText)["items"] as Array<JSONObject>)[0]!["criteria"],
    ).toEqual(criteria);
    expect(
      LabelRuleImportExport.parse({
        modelType: MessageQueueLabelRule,
        fileText,
      }).items[0]!.json["criteria"],
    ).toEqual(criteria);
  });

  test.each([
    ["Database", DatabaseServerLabelRule],
    ["Monitor", MonitorLabelRule],
  ] as Array<[string, DatabaseBaseModelType]>)(
    "a rule naming a messaging system is refused as a %s rule instead of matching everything",
    (_name: string, modelType: DatabaseBaseModelType) => {
      expect(() => {
        LabelRuleImportExport.parse({
          modelType,
          fileText: exportFile(kafkaTopicsRule()),
        });
      }).toThrow("Messaging System Pattern is configured but is not supported");

      const rule: MessageQueueLabelRule = kafkaTopicsRule();
      delete rule.messageQueueSystemPattern;
      rule.criteria = {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            field: "messageQueueSystemPattern",
            operator: RuleCriteriaOperator.MatchesPattern,
            value: "^kafka$",
          },
        ],
      };

      expect(() => {
        LabelRuleImportExport.parse({
          modelType,
          fileText: exportFile(rule),
        });
      }).toThrow(
        "Messaging System Pattern is configured in Match Criteria but is not supported",
      );
    },
  );

  test("an empty messaging system pattern moves to another rule type and is left behind", () => {
    const rule: MessageQueueLabelRule = kafkaTopicsRule();
    rule.messageQueueSystemPattern = "";

    const json: JSONObject = LabelRuleImportExport.parse({
      modelType: DatabaseServerLabelRule,
      fileText: exportFile(rule),
    }).items[0]!.json;

    expect(json).toMatchObject({
      name: "Kafka topics",
      databaseServerLabels: [],
      labelsToAdd: ["Kafka"],
    });
    expect(json["messageQueueSystemPattern"]).toBeUndefined();
  });
});

describe("what a queue is not", () => {
  test.each([
    ["Incident", Incident],
    ["Alert", Alert],
    ["ScheduledMaintenance", ScheduledMaintenance],
  ])(
    "not an affected resource of a %s (no relation, no validation)",
    (_name: string, modelType: DatabaseBaseModelType) => {
      const model: BaseModel = new modelType();

      expect(model.hasColumn("messageQueues")).toBe(false);
      expect(
        getAffectedResourceRelations(model).filter(
          (relation: ProjectScopedRelation): boolean => {
            return (
              (relation.service as unknown as BaseService) ===
              (MessageQueueService as unknown as BaseService)
            );
          },
        ),
      ).toEqual([]);
    },
  );

  test("not a TelemetryException parent: a queue raises no exceptions of its own", () => {
    const ownedThrough: OwnedThroughMetadata = (
      TelemetryException.prototype as unknown as {
        ownedThrough: OwnedThroughMetadata;
      }
    ).ownedThrough;

    expect(ownedThrough.parentModels).not.toContain(MessageQueue);
  });
});
