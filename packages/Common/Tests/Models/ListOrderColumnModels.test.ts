import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../Types/Database/ListOrderColumn";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import { ModelSchema } from "../../Utils/Schema/ModelSchema";

/*
 * The lists people put in order by dragging rows (@ListOrderColumn). For
 * each, DatabaseService keeps the order column: a new row without one goes
 * to the end of its list. That only works if no client ever sends a number
 * it did not mean, so every such column must be:
 *
 *   - a number, not required, with no declared default - the OpenAPI spec,
 *     the MCP tools and the Terraform provider are generated from this
 *     metadata, and a published default is a value the provider sends on
 *     every create (it would put every new row at that number);
 *   - writable by whoever can create and edit the row, because dragging a
 *     row is an edit of its order column;
 *   - scoped by columns that exist, so "its list" means something.
 *
 * And the set itself is pinned: a list that gains or loses the decorator is
 * a change somebody should notice.
 */

type ModelType = { new (): BaseModel };

const EXPECTED: Record<string, ListOrderSettings> = {
  IncidentCustomField: {
    column: "sortOrder",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  IncidentMeasurement: {
    column: "order",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  AlertMeasurement: {
    column: "order",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  ScheduledMaintenanceMeasurement: {
    column: "order",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  IncidentReminderRule: {
    column: "order",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  AlertReminderRule: {
    column: "order",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  ScheduledMaintenanceReminderRule: {
    column: "order",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  IncidentSlaRule: {
    column: "order",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  IncidentGroupingRule: {
    column: "priority",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  AlertGroupingRule: {
    column: "priority",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  NetworkDeviceRole: {
    column: "order",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  // The highest priority wins, so the top of this list is its highest number.
  NetworkSiteAssignmentRule: {
    column: "priority",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Descending,
  },
  LogPipeline: {
    column: "sortOrder",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  LogPipelineProcessor: {
    column: "sortOrder",
    scopeColumns: ["logPipelineId"],
    sortOrder: SortOrder.Ascending,
  },
  LogDropFilter: {
    column: "sortOrder",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  LogScrubRule: {
    column: "sortOrder",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  TracePipeline: {
    column: "sortOrder",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  TracePipelineProcessor: {
    column: "sortOrder",
    scopeColumns: ["tracePipelineId"],
    sortOrder: SortOrder.Ascending,
  },
  TraceDropFilter: {
    column: "sortOrder",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  TraceScrubRule: {
    column: "sortOrder",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  MetricPipelineRule: {
    column: "sortOrder",
    scopeColumns: ["projectId"],
    sortOrder: SortOrder.Ascending,
  },
  StatusPageHeaderLink: {
    column: "order",
    scopeColumns: ["statusPageId"],
    sortOrder: SortOrder.Ascending,
  },
  StatusPageFooterLink: {
    column: "order",
    scopeColumns: ["statusPageId"],
    sortOrder: SortOrder.Ascending,
  },
  StatusPageHistoryChartBarColorRule: {
    column: "order",
    scopeColumns: ["statusPageId"],
    sortOrder: SortOrder.Ascending,
  },
  IncomingCallPolicyEscalationRule: {
    column: "order",
    scopeColumns: ["incomingCallPolicyId"],
    sortOrder: SortOrder.Ascending,
  },
};

const listModels: Array<ModelType> = (
  AllModelTypes as unknown as Array<ModelType>
).filter((modelType: ModelType) => {
  return Boolean(new modelType().getListOrder());
});

const nameOf: (modelType: ModelType) => string = (
  modelType: ModelType,
): string => {
  return new modelType().tableName || modelType.name;
};

const createSchemaOf: (modelType: ModelType) => JSONObject = (
  modelType: ModelType,
): JSONObject => {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register(
    "Schema",
    ModelSchema.getCreateModelSchema({ modelType: modelType }),
  );

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    "Schema"
  ] as JSONObject;
};

describe("drag-ordered lists (@ListOrderColumn)", () => {
  test("are exactly the lists people put in order by dragging", () => {
    expect(listModels.map(nameOf).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test.each(Object.entries(EXPECTED))(
    "%s keeps its order as the dashboard drags it",
    (table: string, expected: ListOrderSettings) => {
      const modelType: ModelType | undefined = listModels.find(
        (candidate: ModelType) => {
          return nameOf(candidate) === table;
        },
      );

      expect(modelType).toBeDefined();
      expect(new modelType!().getListOrder()).toEqual(expected);
    },
  );

  describe.each(
    listModels.map((modelType: ModelType) => {
      return [nameOf(modelType), modelType] as [string, ModelType];
    }),
  )("%s", (_table: string, modelType: ModelType) => {
    const model: BaseModel = new modelType();
    const settings: ListOrderSettings = model.getListOrder()!;
    const column: TableColumnMetadata = model.getTableColumnMetadata(
      settings.column,
    );

    test("its order column is a number", () => {
      expect(column).toBeDefined();
      expect(column.type).toBe(TableColumnType.Number);
    });

    test("its order column is not required, so a new row can leave it out", () => {
      expect(column.required).toBeFalsy();
    });

    test("its order column declares no default a client would send", () => {
      expect(column.defaultValue).toBeUndefined();

      const property: JSONObject | undefined = (
        createSchemaOf(modelType)["properties"] as JSONObject | undefined
      )?.[settings.column] as JSONObject | undefined;

      if (property) {
        expect(property).not.toHaveProperty("default");
      }

      expect(
        (createSchemaOf(modelType)["required"] as Array<string> | undefined) ||
          [],
      ).not.toContain(settings.column);
    });

    test("its order column describes how the list keeps it", () => {
      expect(column.description || "").toContain(
        "drag the rows to reorder them",
      );
    });

    test("whoever can edit a row can move it", () => {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(settings.column);

      expect(access?.update?.length || 0).toBeGreaterThan(0);
      expect(access?.create?.length || 0).toBeGreaterThan(0);
    });

    test("the columns that say which list a row is in exist", () => {
      expect(settings.scopeColumns.length).toBeGreaterThan(0);

      for (const scopeColumn of settings.scopeColumns) {
        expect(model.getTableColumnMetadata(scopeColumn)?.type).toBe(
          TableColumnType.ObjectID,
        );
      }
    });
  });

  test("a model that is not a drag-ordered list has none", () => {
    const others: Array<ModelType> = (
      AllModelTypes as unknown as Array<ModelType>
    ).filter((modelType: ModelType) => {
      return !EXPECTED[nameOf(modelType)];
    });

    expect(others.length).toBeGreaterThan(100);

    for (const modelType of others) {
      expect(new modelType().getListOrder()).toBeNull();
    }
  });
});
