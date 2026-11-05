import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  ColumnUse,
  requiredWritableColumns,
} from "Common/UI/Components/Workflow/ColumnEditor/ColumnUse";
import {
  controlForColumn,
  getColumnTitle,
  isOfferableColumn,
} from "Common/UI/Components/Workflow/ColumnEditor/ColumnControl";
import { ModelColumnControl } from "Common/UI/Components/Workflow/ColumnEditor/ColumnRow";
import { ModelSchemaColumn } from "Common/UI/Components/Workflow/ModelSchema";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Issue #5943, from the real models through the real /model-schema endpoint to
 * the record editor's own policy: Create One Incident's severity is picked from
 * the incident severities, and a query's ID from the records themselves.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

import ModelSchemaAPI from "../../../FeatureSet/Workflow/API/ModelSchema";

type FindColumnFunction = (
  columns: Array<ModelSchemaColumn>,
  columnId: string,
) => ModelSchemaColumn | undefined;

const findColumn: FindColumnFunction = (
  columns: Array<ModelSchemaColumn>,
  columnId: string,
): ModelSchemaColumn | undefined => {
  return columns.find((column: ModelSchemaColumn): boolean => {
    return column.id === columnId;
  });
};

type GetColumnsForFunction = (
  tableName: string,
  access: "read" | "write",
) => Promise<Array<ModelSchemaColumn>>;

const getColumnsFor: GetColumnsForFunction = async (
  tableName: string,
  access: "read" | "write",
): Promise<Array<ModelSchemaColumn>> => {
  const api: ModelSchemaAPI = new ModelSchemaAPI();

  const req: ExpressRequest = {
    params: { tableName: tableName },
    query: { access: access },
  } as unknown as ExpressRequest;

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  sendJsonObjectResponse.mockClear();

  await api.getModelSchema(req, {} as ExpressResponse, next);

  expect(next).not.toHaveBeenCalled();

  const body: JSONObject = sendJsonObjectResponse.mock
    .calls[0]?.[2] as JSONObject;

  return body["columns"] as JSONArray as unknown as Array<ModelSchemaColumn>;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Create One Incident, from the real model", () => {
  test("its required severity is a list of the incident severities", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "write",
    );

    const severity: ModelSchemaColumn | undefined = findColumn(
      columns,
      "incidentSeverityId",
    );

    expect(severity?.linkedTableName).toBe("IncidentSeverity");
    expect(getColumnTitle(severity)).toBe("Incident Severity");
    expect(controlForColumn(severity)).toBe(ModelColumnControl.Record);
    expect(
      requiredWritableColumns(columns).map((column: ModelSchemaColumn) => {
        return column.id;
      }),
    ).toContain("incidentSeverityId");
  });

  test("its labels and monitors are lists to pick from", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "write",
    );

    for (const [columnId, tableName] of [
      ["labels", "Label"],
      ["monitors", "Monitor"],
    ] as Array<[string, string]>) {
      const column: ModelSchemaColumn | undefined = findColumn(
        columns,
        columnId,
      );

      expect(column?.linkedTableName).toBe(tableName);
      expect(controlForColumn(column)).toBe(ModelColumnControl.RecordList);
      expect(isOfferableColumn(column!, ColumnUse.Create)).toBe(true);
    }
  });

  test("its project is never offered, and points at nothing", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "write",
    );

    const project: ModelSchemaColumn | undefined = findColumn(
      columns,
      "projectId",
    );

    expect(project?.linkedTableName).toBeUndefined();
    expect(project ? isOfferableColumn(project, ColumnUse.Create) : false).toBe(
      false,
    );
  });

  test("a plain column says nothing about records", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "write",
    );

    const title: ModelSchemaColumn | undefined = findColumn(columns, "title");

    expect(title?.linkedTableName).toBeUndefined();
    expect(title?.linkedTitle).toBeUndefined();
    expect(controlForColumn(title)).not.toBe(ModelColumnControl.Record);
  });
});

describe("a query on incidents, from the real model", () => {
  test("its ID lists the incidents, and is still called ID", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "read",
    );

    const id: ModelSchemaColumn | undefined = findColumn(columns, "_id");

    expect(id?.linkedTableName).toBe("Incident");
    expect(id?.linkedTitle).toBeUndefined();
    expect(getColumnTitle(id)).toBe(id?.title);
    expect(controlForColumn(id)).toBe(ModelColumnControl.Record);
    expect(isOfferableColumn(id!, ColumnUse.Filter)).toBe(true);
  });

  test("its severity lists the incident severities here too", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "read",
    );

    expect(findColumn(columns, "incidentSeverityId")?.linkedTableName).toBe(
      "IncidentSeverity",
    );
  });

  test("who created it lists the project's people", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "read",
    );

    expect(findColumn(columns, "createdByUserId")?.linkedTableName).toBe(
      "User",
    );
  });

  test("its labels are not offered as a filter", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "read",
    );

    const labels: ModelSchemaColumn | undefined = findColumn(columns, "labels");

    expect(labels ? isOfferableColumn(labels, ColumnUse.Filter) : false).toBe(
      false,
    );
  });

  test("a related record's own columns point at nothing: they are only read", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "read",
    );

    const relation: ModelSchemaColumn | undefined = findColumn(
      columns,
      "incidentSeverity",
    );

    expect(relation?.relatedColumns?.length).toBeGreaterThan(0);

    for (const column of relation?.relatedColumns || []) {
      expect(column.linkedTableName).toBeUndefined();
    }
  });
});

describe("other models", () => {
  test("a monitor's status lists the monitor statuses", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Monitor",
      "write",
    );

    expect(findColumn(columns, "currentMonitorStatusId")?.linkedTableName).toBe(
      "MonitorStatus",
    );
  });

  test("an alert's severity lists the alert severities", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Alert",
      "write",
    );

    expect(findColumn(columns, "alertSeverityId")?.linkedTableName).toBe(
      "AlertSeverity",
    );
  });
});
