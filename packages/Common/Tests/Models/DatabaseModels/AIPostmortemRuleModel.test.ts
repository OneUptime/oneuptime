import Models from "../../../Models/DatabaseModels/Index";
import AIPostmortemRule from "../../../Models/DatabaseModels/AIPostmortemRule";
import IncidentPostmortemTemplate from "../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MAX_POSTMORTEM_RULE_TEMPLATES } from "../../../Types/AI/PostmortemRuleTemplates";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import { getRuleCriteriaFieldsForModel } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import {
  getRuleCriteriaSubjectForModel,
  RuleCriteriaSubject,
} from "../../../Types/Rules/RuleCriteriaSubject";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * AIPostmortemRule: which resolved incidents OneUptime AI drafts a
 * postmortem for, and the postmortem templates each draft may follow -
 * "rules, like investigation rules, for which incidents get a drafted
 * postmortem and which templates it may use".
 *
 *   - a project's rule, changed by whoever may change what AI does (Project
 *     Owner or Admin) and read by the project's members;
 *   - put in order by dragging (@ListOrderColumn): the first enabled rule
 *     that matches decides;
 *   - the conditions an incident AI rule has (investigation rules were
 *     merged into the AI rules), read by the same matcher;
 *   - the templates in a join table of their own.
 */

const OWNER_OR_ADMIN: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

// The incident conditions an AI rule offers, by column.
const INCIDENT_CONDITIONS: Array<string> = [
  "monitors",
  "incidentSeverities",
  "labels",
  "monitorLabels",
  "titlePattern",
  "descriptionPattern",
];

describe("AIPostmortemRule", () => {
  const model: AIPostmortemRule = new AIPostmortemRule();

  it("is a rule with the shared conditions column, registered so its table is created", () => {
    expect(model).toBeInstanceOf(RuleBaseModel);
    expect(model.getTableColumns().columns).toContain("criteria");
    expect(model.getTableColumnMetadata("criteria").type).toBe(
      TableColumnType.JSON,
    );
    expect(
      Models.some((registered: { new (): BaseModel }) => {
        return registered === AIPostmortemRule;
      }),
    ).toBe(true);
  });

  it("is scoped to a project, and served from its own endpoint", () => {
    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.getCrudApiPath()?.toString()).toBe("/ai-postmortem-rule");
    expect(model.tableName).toBe("AIPostmortemRule");
    expect(model.singularName).toBe("Postmortem Rule");
    expect(model.pluralName).toBe("Postmortem Rules");
  });

  it("is changed by a Project Owner or Admin, and read by the project's members", () => {
    expect(model.getCreatePermissions()).toEqual(OWNER_OR_ADMIN);
    expect(model.getUpdatePermissions()).toEqual(OWNER_OR_ADMIN);
    expect(model.getDeletePermissions()).toEqual(OWNER_OR_ADMIN);
    expect(model.getReadPermissions()).toEqual(READERS);
  });

  it("is on every plan: no plan gates the rule itself, only the templates it names", () => {
    expect(model.getCreateBillingPlan()).toBeFalsy();
    expect(model.getReadBillingPlan()).toBeFalsy();
    expect(new IncidentPostmortemTemplate().getReadBillingPlan()).toBeTruthy();
  });

  it("criteria take the table's own permissions", () => {
    expect(model.getColumnAccessControlFor("criteria")).toEqual({
      create: model.getCreatePermissions(),
      read: model.getReadPermissions(),
      update: model.getUpdatePermissions(),
    });
  });

  it("is a list put in order by dragging, one list per project, top first", () => {
    const listOrder: ListOrderSettings | null = model.getListOrder();

    expect(listOrder).toEqual({
      column: "order",
      scopeColumns: ["projectId"],
      sortOrder: SortOrder.Ascending,
    });

    const order: ReturnType<AIPostmortemRule["getTableColumnMetadata"]> =
      model.getTableColumnMetadata("order");

    expect(order.type).toBe(TableColumnType.Number);
    // The server keeps the number: no default a client or Terraform would send.
    expect(order.required).toBe(false);
    expect(order.defaultValue).toBeUndefined();
    expect(order.description).toContain("the first one that matches wins");
  });

  it("holds a name, a switch that starts on, the incident conditions and the templates", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "name",
      "description",
      "isEnabled",
      "order",
      "criteria",
      ...INCIDENT_CONDITIONS,
      "postmortemTemplates",
    ]) {
      expect([column, columns.includes(column)]).toEqual([column, true]);
    }

    expect(model.getTableColumnMetadata("isEnabled").defaultValue).toBe(true);
    expect(model.getTableColumnMetadata("name").required).toBe(true);
  });

  it("is about incidents alone: no trigger, no alert severities", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    expect(columns).not.toContain("triggerEntityType");
    expect(columns).not.toContain("alertSeverities");
    expect(getRuleCriteriaSubjectForModel("AIPostmortemRule")).toBe(
      RuleCriteriaSubject.Incidents,
    );
  });

  it("matches on exactly the incident conditions an AI rule offers", () => {
    expect(getRuleCriteriaFieldsForModel("AIPostmortemRule")).toEqual(
      INCIDENT_CONDITIONS,
    );

    // The AI rule's share for incidents, in the same order.
    expect(
      (getRuleCriteriaFieldsForModel("AutoRemediationRule") || []).filter(
        (field: string): boolean => {
          return field !== "alertSeverities";
        },
      ),
    ).toEqual(INCIDENT_CONDITIONS);
  });

  it("names postmortem templates, and says what none and several mean", () => {
    const templates: ReturnType<AIPostmortemRule["getTableColumnMetadata"]> =
      model.getTableColumnMetadata("postmortemTemplates");

    expect(templates.type).toBe(TableColumnType.EntityArray);
    expect(templates.modelType).toBe(IncidentPostmortemTemplate);
    expect(templates.required).toBe(false);
    expect(templates.description).toContain("standard outline");
    expect(templates.description).toContain("fits the incident best");
    // The limit the service holds a rule to, said where the API documents it.
    expect(templates.description).toContain(
      `At most ${MAX_POSTMORTEM_RULE_TEMPLATES}.`,
    );
  });

  it.each([...INCIDENT_CONDITIONS, "postmortemTemplates", "name", "isEnabled"])(
    "%s may be read by the project's members, and changed only by an owner or admin",
    (column: string) => {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect(accessControl?.create).toEqual(OWNER_OR_ADMIN);
      expect(accessControl?.update).toEqual(OWNER_OR_ADMIN);
      expect(accessControl?.read).toEqual(READERS);
    },
  );

  it("never moves to another project, and never says who deleted it", () => {
    expect(model.getColumnAccessControlFor("projectId")?.update).toEqual([]);
    expect(model.getColumnAccessControlFor("deletedByUserId")).toEqual({
      create: [],
      read: [],
      update: [],
    });
  });

  it("keeps each list it names in a join table of its own", () => {
    const joinTables: Array<JoinTableMetadataArgs> =
      getMetadataArgsStorage().joinTables.filter(
        (joinTable: JoinTableMetadataArgs): boolean => {
          return joinTable.target === AIPostmortemRule;
        },
      );

    expect(
      joinTables
        .map((joinTable: JoinTableMetadataArgs): string => {
          return `${joinTable.name} ${joinTable.joinColumns?.[0]?.name} ${joinTable.inverseJoinColumns?.[0]?.name}`;
        })
        .sort(),
    ).toEqual([
      "AIPostmortemRuleIncidentPostmortemTemplate aiPostmortemRuleId incidentPostmortemTemplateId",
      "AIPostmortemRuleIncidentSeverity aiPostmortemRuleId incidentSeverityId",
      "AIPostmortemRuleLabel aiPostmortemRuleId labelId",
      "AIPostmortemRuleMonitor aiPostmortemRuleId monitorId",
      "AIPostmortemRuleMonitorLabel aiPostmortemRuleId labelId",
    ]);
  });

  it("the template a rule names can be read through the rule by name", () => {
    const template: IncidentPostmortemTemplate =
      new IncidentPostmortemTemplate();

    // The table's Templates column reads it through the relation.
    expect(
      template.getTableColumnMetadata("templateName").canReadOnRelationQuery,
    ).toBe(true);
  });
});
