import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import Entities from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  TableColumnMetadata,
  getTableColumns,
} from "Common/Types/Database/TableColumn";
import Dictionary from "Common/Types/Dictionary";
import {
  isAlwaysEmptyColumnId,
  isSystemColumnId,
} from "Common/Types/Workflow/SystemColumns";
import {
  ColumnUse,
  isSystemColumn,
  requiredWritableColumns,
} from "Common/UI/Components/Workflow/ColumnEditor/ColumnUse";
import {
  isOfferableColumn,
  jsonOnlyColumns,
} from "Common/UI/Components/Workflow/ColumnEditor/ColumnControl";
import { ModelSchemaColumn } from "Common/UI/Components/Workflow/ModelSchema";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The fields a database step's settings offer, worked out from the real
 * models: the /model-schema endpoint describes a model, and the record
 * editor's own policy (ColumnUse / isOfferableColumn) - the same functions the
 * browser runs - decides what goes in each "Add a field" list.
 *
 * The maintainer's report was Create One Incident's list offering Created At
 * and Created by User ID - "system fields that should never be in the list".
 * The endpoint gated columns on their permission lists, and those two passed
 * it: the timestamps borrow the model's record-level permissions, and
 * createdByUserId carried a create list on almost every model. It no longer
 * does - OneUptime decides who created a record (UserAttribution) - so only
 * the timestamps still need the system-column list.
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

type ModelConstructor = { new (): BaseModel };

async function getColumnsFor(
  tableName: string,
  access: "read" | "write",
): Promise<Array<ModelSchemaColumn>> {
  const api: ModelSchemaAPI = new ModelSchemaAPI();

  await api.getModelSchema(
    {
      params: { tableName: tableName },
      query: access === "write" ? { access: "write" } : {},
    } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    jest.fn() as unknown as NextFunction,
  );

  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  const body: JSONObject = sendJsonObjectResponse.mock.calls[
    sendJsonObjectResponse.mock.calls.length - 1
  ]![2] as JSONObject;

  return body["columns"] as JSONArray as unknown as Array<ModelSchemaColumn>;
}

function findColumn(
  columns: Array<ModelSchemaColumn>,
  id: string,
): ModelSchemaColumn | undefined {
  return columns.find((column: ModelSchemaColumn): boolean => {
    return column.id === id;
  });
}

function offeredIds(
  columns: Array<ModelSchemaColumn>,
  use: ColumnUse,
): Array<string> {
  return columns
    .filter((column: ModelSchemaColumn): boolean => {
      return isOfferableColumn(column, use);
    })
    .map((column: ModelSchemaColumn): string => {
      return column.id;
    });
}

function idsOf(columns: Array<ModelSchemaColumn>): Array<string> {
  return columns.map((column: ModelSchemaColumn): string => {
    return column.id;
  });
}

describe("what the endpoint says about each column", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("marks the record's own ID and timestamps as filled in by OneUptime", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "write",
    );

    for (const id of ["_id", "createdAt", "updatedAt", "deletedAt"]) {
      expect({ id, system: findColumn(columns, id)?.isSystemColumn }).toEqual({
        id,
        system: true,
      });
    }
  });

  test("does not offer Created by User ID for writing at all: OneUptime decides who created a record", async () => {
    expect(
      findColumn(await getColumnsFor("Incident", "write"), "createdByUserId"),
    ).toBeUndefined();

    // It is still read back, and marked as OneUptime's own.
    const createdBy: ModelSchemaColumn | undefined = findColumn(
      await getColumnsFor("Incident", "read"),
      "createdByUserId",
    );

    expect(createdBy?.isSystemColumn).toBe(true);
    expect(createdBy?.canCreate).toBe(false);
    expect(createdBy?.canUpdate).toBe(false);
  });

  test("marks a column the model computes - Incident's notification status", async () => {
    const status: ModelSchemaColumn | undefined = findColumn(
      await getColumnsFor("Incident", "write"),
      "subscriberNotificationStatusOnIncidentCreated",
    );

    expect(status).toBeDefined();
    expect(status?.isSystemColumn).toBe(true);
  });

  test("does not mark the incident's own fields", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "write",
    );

    for (const id of [
      "title",
      "description",
      "declaredAt",
      "currentIncidentStateId",
      "incidentSeverityId",
      "changeMonitorStatusToId",
    ]) {
      const column: ModelSchemaColumn | undefined = findColumn(columns, id);

      expect({ id, system: column?.isSystemColumn }).toEqual({
        id,
        system: false,
      });
      expect({
        id,
        canCreate: column?.canCreate,
        canUpdate: column?.canUpdate,
      }).toEqual({ id, canCreate: true, canUpdate: true });
    }
  });

  test("says which fields only a create may set", async () => {
    const notify: ModelSchemaColumn | undefined = findColumn(
      await getColumnsFor("Incident", "write"),
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    );

    expect(notify?.canCreate).toBe(true);
    expect(notify?.canUpdate).toBe(false);
  });

  /*
   * The read gate keeps them: a select reads "when was this created" back, and
   * a query filters on it. The flag says what they are; it does not hide them.
   */
  test("still describes the system columns to a Select or a Query, flagged", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Incident",
      "read",
    );

    expect(findColumn(columns, "createdAt")?.isSystemColumn).toBe(true);
    expect(findColumn(columns, "createdByUserId")?.isSystemColumn).toBe(true);
    expect(findColumn(columns, "title")?.isSystemColumn).toBe(false);
  });

  test("marks the slug the server writes on every create", async () => {
    const slug: ModelSchemaColumn | undefined = findColumn(
      await getColumnsFor("ScheduledMaintenance", "write"),
      "slug",
    );

    // Required, no default, and a create list - the trap described below.
    expect(slug?.required).toBe(true);
    expect(slug?.hasDefault).toBe(false);
    expect(slug?.canCreate).toBe(true);
    expect(slug?.isSystemColumn).toBe(true);
  });
});

describe("Create One Incident, from the real model", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("offers no field OneUptime fills in", async () => {
    const offered: Array<string> = offeredIds(
      await getColumnsFor("Incident", "write"),
      ColumnUse.Create,
    );

    for (const id of [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "createdByUserId",
      "subscriberNotificationStatusOnIncidentCreated",
      "subscriberNotificationStatusMessage",
      "isScopedToStatusPages",
      "projectId",
    ]) {
      expect({ id, offered: offered.includes(id) }).toEqual({
        id,
        offered: false,
      });
    }
  });

  test("offers the incident's own fields", async () => {
    const offered: Array<string> = offeredIds(
      await getColumnsFor("Incident", "write"),
      ColumnUse.Create,
    );

    expect(offered).toEqual(
      expect.arrayContaining([
        "title",
        "description",
        "declaredAt",
        "currentIncidentStateId",
        "incidentSeverityId",
        "changeMonitorStatusToId",
        "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
        "isPrivate",
      ]),
    );
  });

  test("opens with rows for the title and the severity, and nothing else", async () => {
    const required: Array<string> = idsOf(
      requiredWritableColumns(await getColumnsFor("Incident", "write")),
    );

    expect(required.sort()).toEqual(["incidentSeverityId", "title"]);
  });

  test("names no system column, project or ID-backed relation as JSON-only", async () => {
    const jsonOnly: Array<string> = idsOf(
      jsonOnlyColumns(
        await getColumnsFor("Incident", "write"),
        ColumnUse.Create,
      ),
    );

    expect(jsonOnly).not.toContain("createdByUser");
    expect(jsonOnly).not.toContain("currentIncidentState");
    expect(jsonOnly).not.toContain("incidentSeverity");
    expect(jsonOnly).not.toContain("project");
    // What it does name are the lists of related records and the JSON blobs.
    expect(jsonOnly).toEqual(expect.arrayContaining(["monitors", "labels"]));
  });
});

describe("Update One Incident, from the real model", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("offers what may change, and nothing only a create may set", async () => {
    const offered: Array<string> = offeredIds(
      await getColumnsFor("Incident", "write"),
      ColumnUse.Update,
    );

    expect(offered).toEqual(
      expect.arrayContaining([
        "title",
        "description",
        "currentIncidentStateId",
        "incidentSeverityId",
      ]),
    );
    expect(offered).not.toContain(
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    );
    expect(offered).not.toContain("createdByUserId");
    expect(offered).not.toContain("createdAt");
  });
});

describe("a query on incidents and monitors, from the real models", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("still filters on the ID, the timestamps and the creator", async () => {
    for (const tableName of ["Incident", "Monitor"]) {
      const offered: Array<string> = offeredIds(
        await getColumnsFor(tableName, "read"),
        ColumnUse.Filter,
      );

      expect({ tableName, offered }).toEqual({
        tableName,
        offered: expect.arrayContaining([
          "_id",
          "createdAt",
          "updatedAt",
          "createdByUserId",
        ]),
      });
    }
  });

  test("never offers Deleted At - records are deleted outright", async () => {
    for (const tableName of ["Incident", "Monitor"]) {
      const offered: Array<string> = offeredIds(
        await getColumnsFor(tableName, "read"),
        ColumnUse.Filter,
      );

      expect(offered).not.toContain("deletedAt");
      expect(offered).not.toContain("deletedByUserId");
    }
  });
});

describe("Create One Monitor, from the real model", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("offers the monitor's fields and none of OneUptime's", async () => {
    const columns: Array<ModelSchemaColumn> = await getColumnsFor(
      "Monitor",
      "write",
    );
    const offered: Array<string> = offeredIds(columns, ColumnUse.Create);

    expect(offered).toEqual(
      expect.arrayContaining(["name", "description", "monitorType"]),
    );

    for (const id of [
      "createdAt",
      "updatedAt",
      "createdByUserId",
      "serverMonitorSecretKey",
      "incomingRequestSecretKey",
    ]) {
      expect(offered).not.toContain(id);
    }
  });
});

/*
 * ScheduledMaintenance.slug is required, has no default and carries a create
 * list, because DatabaseService.generateSlug writes it from the title on every
 * create - so Create One Scheduled Maintenance (and three other models) opened
 * on a required "Slug" row nobody could fill in.
 */
describe("slugs the server writes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("are never a required row on a create", async () => {
    for (const tableName of [
      "ScheduledMaintenance",
      "OnCallDutyPolicy",
      "IncomingCallPolicy",
      "OnCallDutyPolicySchedule",
    ]) {
      const required: Array<string> = idsOf(
        requiredWritableColumns(await getColumnsFor(tableName, "write")),
      );

      expect({ tableName, required }).toEqual({
        tableName,
        required: expect.not.arrayContaining(["slug"]),
      });
    }
  });
});

/*
 * The same rules, held across every model a workflow can create or update, so
 * a model added tomorrow - or a system column one of them grows - cannot put
 * Created At back in a list.
 */
describe("every workflow model", () => {
  const workflowModels: Array<BaseModel> = (Entities as Array<ModelConstructor>)
    .map((ModelClass: ModelConstructor): BaseModel => {
      return new ModelClass();
    })
    .filter((model: BaseModel): boolean => {
      return Boolean(
        model.tableName &&
          model.enableWorkflowOn &&
          (model.enableWorkflowOn.create || model.enableWorkflowOn.update),
      );
    });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("there are workflow models to check, so the sweep is not vacuous", () => {
    expect(workflowModels.length).toBeGreaterThan(100);
  });

  test("offers no system column, computed column or project column to write", async () => {
    const offenders: Array<string> = [];

    for (const model of workflowModels) {
      const columns: Array<ModelSchemaColumn> = await getColumnsFor(
        model.tableName as string,
        "write",
      );
      const metadata: Dictionary<TableColumnMetadata> = getTableColumns(model);

      for (const use of [ColumnUse.Create, ColumnUse.Update]) {
        for (const column of columns) {
          if (!isOfferableColumn(column, use)) {
            continue;
          }

          if (
            isSystemColumnId(column.id) ||
            isSystemColumn(column) ||
            metadata[column.id]?.computed ||
            column.isTenantColumn
          ) {
            offenders.push(`${model.tableName}.${column.id} (${use})`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("offers an update only columns an update may change, and a create only columns a create may set", async () => {
    const offenders: Array<string> = [];

    for (const model of workflowModels) {
      const columns: Array<ModelSchemaColumn> = await getColumnsFor(
        model.tableName as string,
        "write",
      );

      for (const column of columns) {
        if (isOfferableColumn(column, ColumnUse.Create) && !column.canCreate) {
          offenders.push(`${model.tableName}.${column.id} (Create)`);
        }

        if (isOfferableColumn(column, ColumnUse.Update) && !column.canUpdate) {
          offenders.push(`${model.tableName}.${column.id} (Update)`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("never opens a create on a row for a column OneUptime fills in", async () => {
    const offenders: Array<string> = [];

    for (const model of workflowModels) {
      for (const column of requiredWritableColumns(
        await getColumnsFor(model.tableName as string, "write"),
      )) {
        if (isSystemColumn(column) || !column.canCreate) {
          offenders.push(`${model.tableName}.${column.id}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("never offers a filter that is empty on every record", async () => {
    const offenders: Array<string> = [];

    for (const model of workflowModels) {
      const offered: Array<string> = offeredIds(
        await getColumnsFor(model.tableName as string, "read"),
        ColumnUse.Filter,
      );

      for (const id of offered) {
        if (isAlwaysEmptyColumnId(id)) {
          offenders.push(`${model.tableName}.${id}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
