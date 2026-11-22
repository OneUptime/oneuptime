import { describe, expect, test } from "@jest/globals";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import ComponentMetadata from "../../../Types/Workflow/Component";
import BaseModelComponentFactory from "../../../Types/Workflow/Components/BaseModel";
import { getAuditLogResourceTypesOfModel } from "../../../Utils/AuditLog/AuditLogResourceTypes";
import { getCliResourceName } from "../../../Utils/DeveloperDocs/CliCommands";
import { getTerraformTypeName } from "../../../Utils/DeveloperDocs/TerraformSchema";
import {
  getApiPluralName,
  getApiSingularName,
  getKeptSingularName,
} from "../../../Utils/ModelApiName";

/*
 * NO TWO MODELS SHARE A NAME (#10664).
 *
 * A model's singular and plural names are what people read - a table's
 * buttons and dialogs, the workflow builder's steps, the API reference -
 * and what other things call or store it by: the OpenAPI spec tags its
 * endpoints with the singular name (the API reference's sections, the
 * Terraform provider's resources), the MCP server names its tools after
 * both, and the audit log stores the singular name as each entry's
 * resource type, which the Resource Type filter offers, the reads that hold
 * an entry to its record look its table up by (AuditLogReadAccess), and the
 * export's redaction keys its fields by (AuditLogExportRedaction).
 *
 * A status page's subscriber notification template - the row that puts a
 * template on a status page - had the template's own name until #10664: its
 * entries and the template's were one type, two tags had one name, and the
 * workflow builder told the two apart by their tables. Every name below is
 * one model's. The link's old name is kept as its former name, and the
 * names its integrations call it by did not move.
 */

interface NamedModel {
  table: string;
  singularName: string;
  pluralName: string;
  // As the OpenAPI spec, the MCP server and the audit log name it.
  apiSingularName: string;
  apiPluralName: string;
}

const databaseModels: Array<DatabaseBaseModel> = (
  DatabaseModels as Array<DatabaseBaseModelType>
).map((modelType: DatabaseBaseModelType): DatabaseBaseModel => {
  return new modelType();
});

const namedDatabaseModels: Array<NamedModel> = databaseModels.map(
  (model: DatabaseBaseModel): NamedModel => {
    return {
      table: model.tableName || "",
      singularName: model.singularName || "",
      pluralName: model.pluralName || "",
      apiSingularName: getApiSingularName(model),
      apiPluralName: getApiPluralName(model),
    };
  },
);

const named: Array<NamedModel> = [
  ...namedDatabaseModels,
  // Their tags and tools are named by their singular and plural names.
  ...(AnalyticsModels as Array<{ new (): AnalyticsBaseModel }>).map(
    (modelType: { new (): AnalyticsBaseModel }): NamedModel => {
      const model: AnalyticsBaseModel = new modelType();

      return {
        table: model.tableName || "",
        singularName: model.singularName || "",
        pluralName: model.pluralName || "",
        apiSingularName: model.singularName || model.tableName || "",
        apiPluralName: model.pluralName || `${model.singularName}s`,
      };
    },
  ),
];

// Each name more than one model has, with the tables that have it.
function sharedNames(
  models: Array<NamedModel>,
  nameOf: (model: NamedModel) => string,
): Array<string> {
  const tablesByName: Map<string, Array<string>> = new Map();

  for (const model of models) {
    const name: string = nameOf(model).trim();

    if (!name) {
      continue;
    }

    tablesByName.set(name, [...(tablesByName.get(name) || []), model.table]);
  }

  return Array.from(tablesByName.entries())
    .filter(([, tables]: [string, Array<string>]): boolean => {
      return tables.length > 1;
    })
    .map(([name, tables]: [string, Array<string>]): string => {
      return `${name}: ${tables.join(", ")}`;
    });
}

describe("no two models share a name", () => {
  test("every model is read", () => {
    expect(databaseModels.length).toBeGreaterThan(400);
    expect(named.length).toBeGreaterThan(databaseModels.length);
  });

  test("on screen: no two have one singular name, nor one plural name", () => {
    expect(
      sharedNames(namedDatabaseModels, (model: NamedModel): string => {
        return model.singularName;
      }),
    ).toEqual([]);
    expect(
      sharedNames(namedDatabaseModels, (model: NamedModel): string => {
        return model.pluralName;
      }),
    ).toEqual([]);
  });

  test("outside the screens: no two have one tag, tool or audit log type, analytics models included", () => {
    expect(
      sharedNames(named, (model: NamedModel): string => {
        return model.apiSingularName;
      }),
    ).toEqual([]);
    expect(
      sharedNames(named, (model: NamedModel): string => {
        return model.apiPluralName;
      }),
    ).toEqual([]);
  });

  /*
   * The audit log reads a type by either of a renamed model's names
   * (getKeptSingularName): a name on screen that is another model's kept
   * name would find that model's entries.
   */
  test("no model's name on screen is another model's kept name", () => {
    const tablesByKept: Map<string, string> = new Map(
      databaseModels.map((model: DatabaseBaseModel): [string, string] => {
        return [getApiSingularName(model), model.tableName || ""];
      }),
    );

    const crossed: Array<string> = databaseModels
      .filter((model: DatabaseBaseModel): boolean => {
        const other: string | undefined = tablesByKept.get(
          getKeptSingularName(model.singularName || ""),
        );

        return other !== undefined && other !== model.tableName;
      })
      .map((model: DatabaseBaseModel): string => {
        return `${model.singularName}: ${model.tableName}`;
      });

    expect(crossed).toEqual([]);
  });

  test("a model's former name is not its name today", () => {
    const formerAsToday: Array<string> = databaseModels
      .filter((model: DatabaseBaseModel): boolean => {
        return (
          Boolean(model.formerSingularName) &&
          (model.formerSingularName === model.singularName ||
            model.formerSingularName === getApiSingularName(model))
        );
      })
      .map((model: DatabaseBaseModel): string => {
        return model.tableName || "";
      });

    expect(formerAsToday).toEqual([]);
  });
});

describe("the template and its link to a status page", () => {
  const template: DatabaseBaseModel =
    new StatusPageSubscriberNotificationTemplate();
  const link: DatabaseBaseModel =
    new StatusPageSubscriberNotificationTemplateStatusPage();

  test("the template keeps its name, and the link has one of its own", () => {
    expect(template.singularName).toBe("Subscriber Notification Template");
    expect(template.pluralName).toBe("Subscriber Notification Templates");
    expect(template.formerSingularName).toBeFalsy();

    expect(link.singularName).toBe(
      "Status Page Subscriber Notification Template",
    );
    expect(link.pluralName).toBe(
      "Status Page Subscriber Notification Templates",
    );
    expect(link.formerSingularName).toBe("Subscriber Notification Template");
    expect(link.apiSingularName).toBeFalsy();
  });

  /*
   * What integrations call the two by does not move: the API's paths and
   * its reference pages, the Terraform provider's resources, the CLI's
   * commands and the workflow steps a saved workflow names.
   */
  test("their paths, resources, commands and workflow steps are as they were", () => {
    expect(template.crudApiPath?.toString()).toBe(
      "/status-page-subscriber-notification-template",
    );
    expect(link.crudApiPath?.toString()).toBe(
      "/status-page-subscriber-notification-template-status-page",
    );
    expect(link.getAPIDocumentationPath()).toBe(
      "status-page-subscriber-notification-template-status-page",
    );

    expect(
      getTerraformTypeName(StatusPageSubscriberNotificationTemplate),
    ).toBe("oneuptime_subscriber_notification_template");
    expect(
      getTerraformTypeName(StatusPageSubscriberNotificationTemplateStatusPage),
    ).toBe("oneuptime_status_page_subscriber_notification_template");

    expect(getCliResourceName(template)).toBe(
      "subscriber-notification-template",
    );
    expect(getCliResourceName(link)).toBe(
      "status-page-subscriber-notification-template",
    );

    const stepIds: Array<string> = BaseModelComponentFactory.getComponents(
      link,
    ).map((component: ComponentMetadata): string => {
      return component.id;
    });

    expect(stepIds.sort()).toEqual(
      [
        "find-one",
        "find-many",
        "on-delete",
        "delete-one",
        "delete-many",
        "on-create",
        "create-one",
        "create-many",
        "on-update",
        "update-one",
        "update-many",
        "on-create-or-update",
      ]
        .map((step: string): string => {
          return `status-page-subscriber-notification-template-status-page-${step}`;
        })
        .sort(),
    );
  });

  test("the workflow builder names the link's steps by its own name", () => {
    const titles: Array<string> = BaseModelComponentFactory.getComponents(
      link,
    ).map((component: ComponentMetadata): string => {
      return component.title;
    });

    expect(titles).toContain("Find One Status Page Subscriber Notification Template");
    expect(titles).toContain(
      "Find Many Status Page Subscriber Notification Templates",
    );
  });

  /*
   * The audit log records a link as "Status Page Subscriber Notification
   * Template" from now on; its entries from before keep the template's
   * name, and are found by it.
   */
  test("the audit log records each under its own name, and finds a link's older entries by the template's", () => {
    expect(getAuditLogResourceTypesOfModel(template)).toEqual([
      "Subscriber Notification Template",
    ]);
    expect(getAuditLogResourceTypesOfModel(link)).toEqual([
      "Status Page Subscriber Notification Template",
      "Subscriber Notification Template",
    ]);
  });
});
