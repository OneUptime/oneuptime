import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import WorkspaceHomeChoice from "../../../../Models/DatabaseModels/WorkspaceHomeChoice";
import WorkspaceHomeChoiceService from "../../../../Server/Services/WorkspaceHomeChoiceService";
import WorkspaceHomeProject from "../../../../Server/Utils/Workspace/WorkspaceHomeProject";
import PostgresErrorTranslator from "../../../../Server/Utils/Database/PostgresErrorTranslator";
import logger from "../../../../Server/Utils/Logger";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * WHICH OF SOMEBODY'S PROJECTS THEIR SLACK OR TEAMS HOME OPENS ON.
 *
 * The project somebody picks in their Home's Switch project menu is kept in
 * Postgres (WorkspaceHomeChoice) - the cache that kept it before forgot every
 * choice whenever Valkey restarted - and their Home opens on the one of
 * their projects they chose last. These pin the table (server-only, one row
 * a project and chat account, gone with its project), its service's write
 * and read, and WorkspaceHomeProject, which the Homes call and which never
 * throws. WorkspaceHomeChoicePostgres runs the service against a migrated
 * Postgres.
 */

const PLATFORM: ObjectID = new ObjectID("f8000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("f8000000-0000-4000-8000-000000000002");
const SANDBOX: ObjectID = new ObjectID("f8000000-0000-4000-8000-000000000003");
const DEANE_SLACK: string = "U0DEANE";
const DEANE_TEAMS: string = "00000000-0000-4000-8000-00000000dea1";

// The ids a query's value names: an id, or QueryHelper.any's values.
function idsOf(value: unknown): Array<string> {
  if (value instanceof ObjectID || typeof value === "string") {
    return [value.toString().toLowerCase()];
  }

  const parameters: JSONObject | undefined = (
    value as { objectLiteralParameters?: JSONObject }
  ).objectLiteralParameters;

  return Object.values(parameters || {})
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map((entry: unknown): string => {
      return String(entry).toLowerCase();
    });
}

function choiceOf(projectId: ObjectID): WorkspaceHomeChoice {
  const choice: WorkspaceHomeChoice = new WorkspaceHomeChoice();
  choice.id = ObjectID.generate();
  choice.projectId = projectId;
  return choice;
}

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the table: server-only, one row a project and chat account, gone with its project", () => {
  test("nobody may create, read, change or delete a row through the API, and there is no API for it", () => {
    const model: WorkspaceHomeChoice = new WorkspaceHomeChoice();

    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getDeletePermissions()).toEqual([]);
    expect(model.hasReadPermissions([])).toBe(false);
    expect(model.getCrudApiPath()).toBeFalsy();

    for (const column of [
      "projectId",
      "workspaceType",
      "workspaceUserId",
      "chosenAt",
    ]) {
      expect({
        column,
        access: model.getColumnAccessControlFor(column),
      }).toEqual({
        column,
        access: { create: [], read: [], update: [] },
      });
    }
  });

  test("a project's rows: its tenant column, removed with it", () => {
    const model: WorkspaceHomeChoice = new WorkspaceHomeChoice();

    expect(model.getTenantColumn()).toBe("projectId");

    const relation: { onDelete?: string } | undefined = getMetadataArgsStorage()
      .relations.filter((args: { target: unknown; propertyName: string }) => {
        return (
          args.target === WorkspaceHomeChoice && args.propertyName === "project"
        );
      })
      .map((args: { options: { onDelete?: string } }) => {
        return args.options;
      })[0];

    expect(relation?.onDelete).toBe("CASCADE");
  });

  test("one row a project, chat and chat account: a unique index and the create's own check", () => {
    const unique: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === WorkspaceHomeChoice && Boolean(index.unique);
        },
      )[0];

    expect(unique?.columns).toEqual([
      "projectId",
      "workspaceType",
      "workspaceUserId",
    ]);
    expect(
      new WorkspaceHomeChoice()
        .getUniqueColumnsTogether()
        .map((constraint: { columnNames: Array<string> }) => {
          return constraint.columnNames;
        }),
    ).toEqual([["projectId", "workspaceType", "workspaceUserId"]]);
  });

  test("every column it holds is required, and the chat is Slack or Microsoft Teams", () => {
    const model: WorkspaceHomeChoice = new WorkspaceHomeChoice();

    for (const column of [
      "projectId",
      "workspaceType",
      "workspaceUserId",
      "chosenAt",
    ]) {
      expect({
        column,
        required: model.getTableColumnMetadata(column).required,
      }).toEqual({ column, required: true });
    }

    expect(model.getTableColumnMetadata("workspaceType").allowedValues).toEqual(
      Object.values(WorkspaceType),
    );
  });
});

describe("the service: a choice written, and the last one read", () => {
  test("a project chosen again: its row's time written again, and nothing made", async () => {
    const existing: WorkspaceHomeChoice = choiceOf(NONPRD);
    const findOne: SpyInstance<typeof WorkspaceHomeChoiceService.findOneBy> =
      jest
        .spyOn(WorkspaceHomeChoiceService, "findOneBy")
        .mockResolvedValue(existing);
    const update: SpyInstance<typeof WorkspaceHomeChoiceService.updateOneById> =
      jest
        .spyOn(WorkspaceHomeChoiceService, "updateOneById")
        .mockResolvedValue(undefined as never);
    const create: SpyInstance<typeof WorkspaceHomeChoiceService.create> = jest
      .spyOn(WorkspaceHomeChoiceService, "create")
      .mockResolvedValue(existing);
    const at: Date = new Date("2026-11-03T09:00:00.000Z");

    await WorkspaceHomeChoiceService.recordChoice({
      projectId: NONPRD,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: DEANE_SLACK,
      at: at,
    });

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: NONPRD,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
      },
      props: { isRoot: true },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toEqual({
      id: existing.id,
      data: { chosenAt: at },
      props: { isRoot: true },
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("a project chosen for the first time: a row made, as OneUptime, at the moment chosen", async () => {
    jest.spyOn(WorkspaceHomeChoiceService, "findOneBy").mockResolvedValue(null);
    const create: SpyInstance<typeof WorkspaceHomeChoiceService.create> = jest
      .spyOn(WorkspaceHomeChoiceService, "create")
      .mockImplementation((async (data: { data: WorkspaceHomeChoice }) => {
        return data.data;
      }) as never);
    const before: number = Date.now();

    await WorkspaceHomeChoiceService.recordChoice({
      projectId: SANDBOX,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: DEANE_TEAMS,
    });

    expect(create).toHaveBeenCalledTimes(1);

    const made: { data: WorkspaceHomeChoice; props: JSONObject } = create.mock
      .calls[0]![0] as unknown as {
      data: WorkspaceHomeChoice;
      props: JSONObject;
    };

    expect(made.props).toEqual({ isRoot: true });
    expect(made.data.projectId).toEqual(SANDBOX);
    expect(made.data.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(made.data.workspaceUserId).toBe(DEANE_TEAMS);
    expect(made.data.chosenAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(made.data.chosenAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("the same choice made twice at once: the second finds the first's row made - one row, nothing thrown", async () => {
    jest.spyOn(WorkspaceHomeChoiceService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(WorkspaceHomeChoiceService, "create")
      .mockRejectedValue(
        PostgresErrorTranslator.createUniqueViolationException(
          "This chat account's Home choice of this project is recorded already.",
        ),
      );

    await expect(
      WorkspaceHomeChoiceService.recordChoice({
        projectId: SANDBOX,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
      }),
    ).resolves.toBeUndefined();
  });

  test("any other failure is not swallowed by the service", async () => {
    jest.spyOn(WorkspaceHomeChoiceService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(WorkspaceHomeChoiceService, "create")
      .mockRejectedValue(new BadDataException("connection refused"));

    await expect(
      WorkspaceHomeChoiceService.recordChoice({
        projectId: SANDBOX,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
      }),
    ).rejects.toThrow("connection refused");
  });

  test("the last one: of the projects asked about, for the chat account, newest first, one row read", async () => {
    const find: SpyInstance<typeof WorkspaceHomeChoiceService.findBy> = jest
      .spyOn(WorkspaceHomeChoiceService, "findBy")
      .mockResolvedValue([choiceOf(NONPRD)]);

    expect(
      await WorkspaceHomeChoiceService.findLastChosenProject({
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: DEANE_TEAMS,
        projectIds: [PLATFORM, NONPRD],
      }),
    ).toEqual(NONPRD);

    const asked: JSONObject = find.mock.calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = asked["query"] as JSONObject;

    expect(query["workspaceType"]).toBe(WorkspaceType.MicrosoftTeams);
    expect(query["workspaceUserId"]).toBe(DEANE_TEAMS);
    expect(idsOf(query["projectId"]).sort()).toEqual(
      [PLATFORM.toString(), NONPRD.toString()].sort(),
    );
    expect(asked["sort"]).toEqual({ chosenAt: SortOrder.Descending });
    expect(asked["limit"]).toBe(1);
    expect(asked["props"]).toEqual({ isRoot: true });
  });

  test("nothing asked about, or nobody to ask for: none, and nothing read", async () => {
    const find: SpyInstance<typeof WorkspaceHomeChoiceService.findBy> = jest
      .spyOn(WorkspaceHomeChoiceService, "findBy")
      .mockResolvedValue([choiceOf(NONPRD)]);

    expect(
      await WorkspaceHomeChoiceService.findLastChosenProject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
        projectIds: [],
      }),
    ).toBeNull();
    expect(
      await WorkspaceHomeChoiceService.findLastChosenProject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "",
        projectIds: [PLATFORM],
      }),
    ).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  test("none chosen: none", async () => {
    jest.spyOn(WorkspaceHomeChoiceService, "findBy").mockResolvedValue([]);

    expect(
      await WorkspaceHomeChoiceService.findLastChosenProject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
        projectIds: [PLATFORM],
      }),
    ).toBeNull();
  });
});

describe("WorkspaceHomeProject: what the Homes call, which never throws", () => {
  test("the project of theirs chosen last, as the person's own projects list it", async () => {
    jest
      .spyOn(WorkspaceHomeChoiceService, "findLastChosenProject")
      .mockResolvedValue(
        new ObjectID(NONPRD.toString().toUpperCase()) as never,
      );

    const chosen: ObjectID | null = await WorkspaceHomeProject.getChosenProject(
      {
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
        memberProjectIds: [PLATFORM, NONPRD],
      },
    );

    // The member project itself, not what the read said.
    expect(chosen).toBe(NONPRD as unknown as ObjectID);
  });

  test("a project the read names that is not one of theirs: none - a choice never shows a project they may not see", async () => {
    jest
      .spyOn(WorkspaceHomeChoiceService, "findLastChosenProject")
      .mockResolvedValue(SANDBOX);

    expect(
      await WorkspaceHomeProject.getChosenProject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
        memberProjectIds: [PLATFORM, NONPRD],
      }),
    ).toBeNull();
  });

  test("no projects, or nobody: none, and nothing read", async () => {
    const find: SpyInstance<
      typeof WorkspaceHomeChoiceService.findLastChosenProject
    > = jest
      .spyOn(WorkspaceHomeChoiceService, "findLastChosenProject")
      .mockResolvedValue(PLATFORM);

    expect(
      await WorkspaceHomeProject.getChosenProject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
        memberProjectIds: [],
      }),
    ).toBeNull();
    expect(
      await WorkspaceHomeProject.getChosenProject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "",
        memberProjectIds: [PLATFORM],
      }),
    ).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  test("a read that fails: none - the Home opens on the first project - and it does not throw", async () => {
    jest
      .spyOn(WorkspaceHomeChoiceService, "findLastChosenProject")
      .mockRejectedValue(new Error("connection refused"));

    expect(
      await WorkspaceHomeProject.getChosenProject({
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: DEANE_TEAMS,
        memberProjectIds: [PLATFORM, NONPRD],
      }),
    ).toBeNull();
  });

  test("a choice: written for the chat account, in its chat", async () => {
    const record: SpyInstance<typeof WorkspaceHomeChoiceService.recordChoice> =
      jest
        .spyOn(WorkspaceHomeChoiceService, "recordChoice")
        .mockResolvedValue();

    await WorkspaceHomeProject.rememberChosenProject({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: DEANE_TEAMS,
      projectId: NONPRD,
    });

    expect(record).toHaveBeenCalledWith({
      projectId: NONPRD,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: DEANE_TEAMS,
    });
  });

  test("a choice that cannot be written is logged, and does not throw; nobody's is not written", async () => {
    const errors: Array<string> = [];

    jest.spyOn(logger, "error").mockImplementation(((line: unknown) => {
      errors.push(String(line));
    }) as never);
    const record: SpyInstance<typeof WorkspaceHomeChoiceService.recordChoice> =
      jest
        .spyOn(WorkspaceHomeChoiceService, "recordChoice")
        .mockRejectedValue(new Error("connection refused"));

    await expect(
      WorkspaceHomeProject.rememberChosenProject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: DEANE_SLACK,
        projectId: NONPRD,
      }),
    ).resolves.toBeUndefined();
    expect(errors).toContain(
      "Could not record the project a chat Home was switched to.",
    );

    record.mockClear();

    await WorkspaceHomeProject.rememberChosenProject({
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: "",
      projectId: NONPRD,
    });

    expect(record).not.toHaveBeenCalled();
  });
});
