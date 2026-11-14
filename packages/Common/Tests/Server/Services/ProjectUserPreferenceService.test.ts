import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ProjectUserPreferenceService from "../../../Server/Services/ProjectUserPreferenceService";
import ProjectUserPreference from "../../../Models/DatabaseModels/ProjectUserPreference";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";

/*
 * A PERSON'S PINS IN A PROJECT, KEPT (issue #6814): one row per person and
 * project, read as root for the person asking and written in one statement,
 * so two tabs pinning at once leave one row holding the last write.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000aa");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading a person's pins", () => {
  test("reads the person's own row in the project, as root, and only its pins", async () => {
    const row: ProjectUserPreference = new ProjectUserPreference();
    row.pinnedProducts = [ProductKey.Logs, ProductKey.StatusPages];
    const find: SpyInstance<typeof ProjectUserPreferenceService.findOneBy> =
      jest
        .spyOn(ProjectUserPreferenceService, "findOneBy")
        .mockResolvedValue(row);

    expect(
      await ProjectUserPreferenceService.getPinnedProducts({
        projectId: PROJECT_ID,
        userId: USER_ID,
      }),
    ).toEqual([ProductKey.Logs, ProductKey.StatusPages]);

    expect(find).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID, userId: USER_ID },
      select: { pinnedProducts: true },
      props: { isRoot: true },
    });
  });

  test("no row is no pins", async () => {
    jest
      .spyOn(ProjectUserPreferenceService, "findOneBy")
      .mockResolvedValue(null);

    expect(
      await ProjectUserPreferenceService.getPinnedProducts({
        projectId: PROJECT_ID,
        userId: USER_ID,
      }),
    ).toEqual([]);
  });

  test("a stored list keeps only the products it knows, once each, five at most", async () => {
    const row: ProjectUserPreference = new ProjectUserPreference();
    row.pinnedProducts = [
      ProductKey.Logs,
      "a-product-since-removed",
      ProductKey.Logs,
      ProductKey.Monitors,
      ProductKey.Incidents,
      ProductKey.Alerts,
      ProductKey.OnCall,
      ProductKey.StatusPages,
    ];
    jest
      .spyOn(ProjectUserPreferenceService, "findOneBy")
      .mockResolvedValue(row);

    expect(
      await ProjectUserPreferenceService.getPinnedProducts({
        projectId: PROJECT_ID,
        userId: USER_ID,
      }),
    ).toEqual([
      ProductKey.Logs,
      ProductKey.Monitors,
      ProductKey.Incidents,
      ProductKey.Alerts,
      ProductKey.OnCall,
    ]);
  });
});

describe("keeping a person's pins", () => {
  test("one statement adds the row or replaces its pins, for that person and project", async () => {
    const statements: Array<{ sql: string; parameters: Array<unknown> }> = [];
    jest.spyOn(ProjectUserPreferenceService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<Array<unknown>> => {
          statements.push({ sql: sql, parameters: parameters });
          return [];
        },
      },
    } as never);

    await ProjectUserPreferenceService.setPinnedProducts({
      projectId: PROJECT_ID,
      userId: USER_ID,
      pinned: [ProductKey.StatusPages, ProductKey.Incidents],
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain(
      'INSERT INTO "ProjectUserPreference" ("projectId", "userId", "pinnedProducts", "version")',
    );
    expect(statements[0]!.sql).toContain(
      'ON CONFLICT ("projectId", "userId") DO UPDATE SET "pinnedProducts" = EXCLUDED."pinnedProducts"',
    );
    expect(statements[0]!.parameters).toEqual([
      PROJECT_ID.toString(),
      USER_ID.toString(),
      JSON.stringify([ProductKey.StatusPages, ProductKey.Incidents]),
    ]);
  });

  test("no pins is kept as an empty list, not as no row", async () => {
    const parameters: Array<Array<unknown>> = [];
    jest.spyOn(ProjectUserPreferenceService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          _sql: string,
          values: Array<unknown>,
        ): Promise<Array<unknown>> => {
          parameters.push(values);
          return [];
        },
      },
    } as never);

    await ProjectUserPreferenceService.setPinnedProducts({
      projectId: PROJECT_ID,
      userId: USER_ID,
      pinned: [],
    });

    expect(parameters[0]![2]).toBe("[]");
  });
});
