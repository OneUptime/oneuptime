import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import {
  getRuleLimitList,
  getRuleLimitLists,
  getRuleLimitListsHolding,
  getRuleLimitListsOf,
  getRuleLimitRecordTables,
  RULE_SCOPE_LISTS_BY_MODEL,
  RuleLimitList,
  RuleLimitListKind,
} from "../../../../Server/Utils/Rules/RuleLimitLists";
import { MONITOR_RULE_ROW_KINDS } from "../../../../Types/UsedBy/UsedBy";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../../Types/Rules/RuleCriteriaFieldRegistry";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * EVERY LIST A RULE CAN BE LIMITED TO (#9066), worked out from the models.
 *
 * A rule limited through a list whose records are all deleted is switched
 * off (RuleEmptiedLimits). That only holds for the lists RuleLimitLists
 * knows, so this pins them: every match list of the API's allowlist, the AI
 * rules' scope lists, the records they hold - and that every other list a
 * rule has is something the rule DOES (labels it adds, people it pages), so
 * an emptied one does less, never more. A list added to a rule kind must be
 * one or the other, here.
 */

type ModelType = { new (): BaseModel };

const RULE_MODELS: Array<ModelType> = (AllModelTypes as Array<ModelType>)
  .filter((modelType: ModelType): boolean => {
    return new modelType() instanceof RuleBaseModel;
  })
  .sort((a: ModelType, b: ModelType): number => {
    return (new a().tableName || "").localeCompare(new b().tableName || "");
  });

/*
 * The lists of rules that limit nothing: what a rule does when it matches,
 * or what a form shows. Emptied by a delete, the rule does less.
 */
const LISTS_THAT_LIMIT_NOTHING: Readonly<Record<string, string>> = {
  labelsToAdd: "the labels a label rule adds",
  ownerUsers: "the people an owner rule makes owners",
  ownerTeams: "the teams an owner rule makes owners",
  creatorTeams:
    "the teams an owner rule makes owners when the creator is in them",
  onCallDutyPolicies: "the on-call policies a rule pages",
  episodeOwnerUsers: "the people a grouping rule makes owners of its episodes",
  episodeOwnerTeams: "the teams a grouping rule makes owners of its episodes",
  episodeMemberRoles: "the roles a grouping rule's episode form offers",
  postmortemTemplates:
    "the templates a postmortem draft may follow; none is OneUptime AI's own outline",
  commandRunners:
    "more Runners an AI rule may run commands on; none is none, beside the rule's Runner",
};

// A grouping rule's episodeLabels are the labels it puts on its episodes.
const RULES_WHOSE_EPISODE_LABELS_ARE_ADDED: ReadonlyArray<string> = [
  "IncidentGroupingRule",
  "AlertGroupingRule",
];

// A runbook rule's runbooks are the ones it starts.
const RULES_WHOSE_RUNBOOKS_ARE_STARTED: ReadonlyArray<string> = ["RunbookRule"];

function listsOf(modelType: ModelType): Array<string> {
  const model: BaseModel = new modelType();

  return model.getTableColumns().columns.filter((column: string): boolean => {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);
    return metadata?.type === TableColumnType.EntityArray;
  });
}

describe("RuleLimitLists", () => {
  const lists: Array<RuleLimitList> = getRuleLimitLists();

  test("every list of every rule kind either limits it or is something it does", () => {
    const unclassified: Array<string> = [];

    for (const modelType of RULE_MODELS) {
      const ruleTable: string = new modelType().tableName!;

      for (const column of listsOf(modelType)) {
        const isLimit: boolean = lists.some((list: RuleLimitList): boolean => {
          return list.ruleTable === ruleTable && list.list === column;
        });

        const doesSomething: boolean =
          Boolean(LISTS_THAT_LIMIT_NOTHING[column]) ||
          (column === "episodeLabels" &&
            RULES_WHOSE_EPISODE_LABELS_ARE_ADDED.includes(ruleTable)) ||
          (column === "runbooks" &&
            RULES_WHOSE_RUNBOOKS_ARE_STARTED.includes(ruleTable));

        if (isLimit === doesSomething) {
          unclassified.push(`${ruleTable}.${column}`);
        }
      }
    }

    expect(unclassified).toEqual([]);
  });

  test("every list among a rule kind's match fields is a match list", () => {
    for (const [ruleTable, fields] of Object.entries(
      RULE_CRITERIA_FIELDS_BY_MODEL,
    ) as Array<[string, ReadonlyArray<string>]>) {
      const modelType: ModelType | undefined = RULE_MODELS.find(
        (candidate: ModelType): boolean => {
          return new candidate().tableName === ruleTable;
        },
      );

      expect(modelType).toBeDefined();

      for (const field of fields) {
        const isList: boolean = listsOf(modelType!).includes(field);
        const list: RuleLimitList | undefined = lists.find(
          (candidate: RuleLimitList): boolean => {
            return (
              candidate.ruleTable === ruleTable && candidate.list === field
            );
          },
        );

        expect({
          field: `${ruleTable}.${field}`,
          isLimit: Boolean(list),
        }).toEqual({
          field: `${ruleTable}.${field}`,
          isLimit: isList,
        });

        if (list) {
          expect(list.kind).toBe(RuleLimitListKind.Match);
        }
      }
    }
  });

  test("the AI rules' scope lists are the runbooks, repositories and MCP servers they may use", () => {
    expect(RULE_SCOPE_LISTS_BY_MODEL).toEqual({
      AutoRemediationRule: [
        "runbooks",
        "codeRepositories",
        "externalMcpServers",
      ],
    });

    expect(
      lists
        .filter((list: RuleLimitList): boolean => {
          return list.kind === RuleLimitListKind.Scope;
        })
        .map((list: RuleLimitList): string => {
          return `${list.ruleTable}.${list.list} -> ${list.recordTable}`;
        }),
    ).toEqual([
      "AutoRemediationRule.runbooks -> Runbook",
      "AutoRemediationRule.codeRepositories -> CodeRepository",
      "AutoRemediationRule.externalMcpServers -> ExternalMcpServer",
    ]);
  });

  test("a scope list's column says an empty list means all of the project's", () => {
    for (const [ruleTable, fields] of Object.entries(
      RULE_SCOPE_LISTS_BY_MODEL,
    ) as Array<[string, ReadonlyArray<string>]>) {
      const modelType: ModelType = RULE_MODELS.find(
        (candidate: ModelType): boolean => {
          return new candidate().tableName === ruleTable;
        },
      )!;

      for (const field of fields) {
        expect(
          new modelType().getTableColumnMetadata(field).description,
        ).toMatch(/Leave empty to let it (pick|use) (any|every|all)/);
      }
    }
  });

  test("the records rules are limited to", () => {
    expect(getRuleLimitRecordTables()).toEqual([
      "AlertSeverity",
      "CodeRepository",
      "ExternalMcpServer",
      "IncidentSeverity",
      "Label",
      "Monitor",
      "NetworkSite",
      "Runbook",
      "Service",
    ]);
  });

  test("every kind of rule the Used by card lists as limited to monitors has its monitors list here", () => {
    const monitorLists: Array<string> = getRuleLimitListsHolding("Monitor")
      .map((list: RuleLimitList): string => {
        return `${list.ruleTable}.${list.list}`;
      })
      .sort();

    expect(monitorLists).toEqual(
      [
        "AIPostmortemRule",
        "AlertGroupingRule",
        "AlertIncidentRule",
        "AlertLabelRule",
        "AlertOnCallRule",
        "AlertOwnerRule",
        "AlertPrivacyRule",
        "AutoRemediationRule",
        "IncidentGroupingRule",
        "IncidentLabelRule",
        "IncidentOnCallRule",
        "IncidentOwnerRule",
        "IncidentPrivacyRule",
        "IncidentSlaRule",
        "RunbookRule",
        "ScheduledMaintenanceLabelRule",
        "ScheduledMaintenanceOwnerRule",
      ]
        .map((ruleTable: string): string => {
          return `${ruleTable}.monitors`;
        })
        .sort(),
    );
    // 17 rule kinds; the card names an AI and a runbook rule by its trigger.
    expect(MONITOR_RULE_ROW_KINDS.length).toBeGreaterThanOrEqual(17);
  });

  test("every list names its join table's columns as the model does", () => {
    for (const list of lists) {
      const joinTable: JoinTableMetadataArgs | undefined =
        getMetadataArgsStorage().joinTables.find(
          (args: JoinTableMetadataArgs): boolean => {
            return (
              (args.target as ModelType).name === list.ruleTable &&
              args.propertyName === list.list
            );
          },
        );

      expect(joinTable?.name).toBe(list.joinTable);
      expect(joinTable?.joinColumns?.[0]?.name).toBe(list.ruleColumn);
      expect(joinTable?.inverseJoinColumns?.[0]?.name).toBe(list.recordColumn);
    }
  });

  test("a list is one of its rule kind's, and of the records it holds", () => {
    // 156: the latest, an AI rule's data store labels (#10494).
    expect(lists.length).toBe(156);

    for (const list of lists) {
      expect(getRuleLimitListsOf(list.ruleTable)).toContain(list);
      expect(getRuleLimitListsHolding(list.recordTable)).toContain(list);
    }

    expect(getRuleLimitListsOf("Monitor")).toEqual([]);
    expect(getRuleLimitListsOf(undefined)).toEqual([]);
    expect(getRuleLimitListsHolding("Incident")).toEqual([]);
    expect(getRuleLimitListsHolding(null)).toEqual([]);
  });

  test("a column that is not a list of records is no list", () => {
    expect(
      getRuleLimitList({
        ruleTable: "IncidentOnCallRule",
        list: "incidentTitlePattern",
        kind: RuleLimitListKind.Match,
      }),
    ).toBeNull();
    expect(
      getRuleLimitList({
        ruleTable: "NoSuchRule",
        list: "monitors",
        kind: RuleLimitListKind.Match,
      }),
    ).toBeNull();
  });

  /*
   * Every delete of a record a rule can be limited to goes through
   * DatabaseService, which switches the rule off - unless the database
   * deletes the record itself, carrying on the delete of another record.
   * The only one is its project, whose delete takes the rules too.
   */
  test("no record a rule is limited to is deleted by the database with anything but its project", () => {
    const carriedOn: Array<string> = [];

    for (const recordTable of getRuleLimitRecordTables()) {
      const modelType: ModelType = (AllModelTypes as Array<ModelType>).find(
        (candidate: ModelType): boolean => {
          return new candidate().tableName === recordTable;
        },
      )!;

      const relations: Array<RelationMetadataArgs> =
        getMetadataArgsStorage().relations.filter(
          (relation: RelationMetadataArgs): boolean => {
            return (
              relation.target === modelType &&
              relation.relationType === "many-to-one" &&
              relation.options.onDelete === "CASCADE"
            );
          },
        );

      for (const relation of relations) {
        const referenced: ModelType = (relation.type as () => ModelType)();

        if (new referenced().tableName !== "Project") {
          carriedOn.push(`${recordTable}.${relation.propertyName}`);
        }
      }
    }

    expect(carriedOn).toEqual([]);
  });
});
