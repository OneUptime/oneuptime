import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import Project from "../../../Models/DatabaseModels/Project";
import IncidentPostmortemStatusService from "../../../Server/Services/IncidentPostmortemStatusService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  Gray500,
  Green,
  VeryLightGray,
  Yellow,
} from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import { SpyInstance } from "jest-mock";

/*
 * The postmortem statuses a new project starts with - Not Started, Draft,
 * Completed and Not Needed - and the backfill that gives a project from
 * before statuses the same four.
 *
 *   - made one after another, top first, each at its place, with the flags
 *     OneUptime moves postmortems by;
 *   - only ever added: a status the project has, by name, is not made again,
 *     nor a built-in one it has under a name of its own;
 *   - seeded with every other default when a project is created, and run
 *     again for every project by the data migration.
 *
 * Nothing here touches a database: the seeder runs against a spied service,
 * and the project-creation hook and the backfill, which live behind a full
 * create and in another workspace, are read off the source.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);

const PROJECT_SERVICE_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../Server/Services/ProjectService.ts"),
  "utf8",
);

const BACKFILL_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "../../../../App/FeatureSet/Workers/DataMigrations/AddDefaultPostmortemStatusesToExistingProjects.ts",
  ),
  "utf8",
);

function newProject(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();

  return project;
}

function existing(
  name: string,
  flags: Record<string, boolean> = {},
): IncidentPostmortemStatus {
  const status: IncidentPostmortemStatus = new IncidentPostmortemStatus();
  status._id = ObjectID.generate().toString();
  status.name = name;
  status.isNotStartedStatus = Boolean(flags["isNotStartedStatus"]);
  status.isDraftStatus = Boolean(flags["isDraftStatus"]);
  status.isCompletedStatus = Boolean(flags["isCompletedStatus"]);

  return status;
}

describe("a new project's postmortem statuses", () => {
  let findBySpy: SpyInstance<typeof IncidentPostmortemStatusService.findBy>;
  let createSpy: SpyInstance<typeof IncidentPostmortemStatusService.create>;
  let order: Array<string>;

  beforeEach(() => {
    order = [];

    findBySpy = jest
      .spyOn(IncidentPostmortemStatusService, "findBy")
      .mockResolvedValue([] as never);

    createSpy = jest
      .spyOn(IncidentPostmortemStatusService, "create")
      .mockImplementation((async (
        createBy: CreateBy<IncidentPostmortemStatus>,
      ): Promise<IncidentPostmortemStatus> => {
        order.push(createBy.data.name || "");
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function seeded(): Array<IncidentPostmortemStatus> {
    return createSpy.mock.calls.map(
      (call: Array<unknown>): IncidentPostmortemStatus => {
        return (call[0] as CreateBy<IncidentPostmortemStatus>).data;
      },
    );
  }

  test("are Not Started, Draft, Completed and Not Needed, made top first", async () => {
    await ProjectService.addDefaultIncidentPostmortemStatuses(newProject());

    expect(order).toEqual(["Not Started", "Draft", "Completed", "Not Needed"]);
    expect(
      seeded().map((status: IncidentPostmortemStatus): number | undefined => {
        return status.order;
      }),
    ).toEqual([1, 2, 3, 4]);
  });

  test("carry the flags OneUptime moves postmortems by, Not Needed none", async () => {
    await ProjectService.addDefaultIncidentPostmortemStatuses(newProject());

    expect(
      seeded().map((status: IncidentPostmortemStatus): Array<boolean> => {
        return [
          Boolean(status.isNotStartedStatus),
          Boolean(status.isDraftStatus),
          Boolean(status.isCompletedStatus),
        ];
      }),
    ).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [false, false, false],
    ]);
  });

  test("are coloured, described and belong to the project", async () => {
    await ProjectService.addDefaultIncidentPostmortemStatuses(newProject());

    expect(
      seeded().map((status: IncidentPostmortemStatus): string => {
        return status.color!.toString();
      }),
    ).toEqual([
      Gray500.toString(),
      Yellow.toString(),
      Green.toString(),
      VeryLightGray.toString(),
    ]);

    for (const status of seeded()) {
      expect(status.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(status.description).toBeTruthy();
    }
  });

  test("are made by OneUptime itself, not as anyone signed in", async () => {
    await ProjectService.addDefaultIncidentPostmortemStatuses(newProject());

    for (const call of createSpy.mock.calls) {
      expect(
        (call[0] as { props: DatabaseCommonInteractionProps }).props,
      ).toEqual({ isRoot: true });
    }

    // The project's statuses, read as OneUptime.
    expect(
      (
        findBySpy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
        }
      ).props,
    ).toEqual({ isRoot: true });
  });

  test("a status the project has by name is not made again: running twice is safe", async () => {
    findBySpy.mockResolvedValue([
      existing("Not Started", { isNotStartedStatus: true }),
      existing("Draft", { isDraftStatus: true }),
    ] as never);

    await ProjectService.addDefaultIncidentPostmortemStatuses(newProject());

    expect(order).toEqual(["Completed", "Not Needed"]);
  });

  test("a built-in status the project renamed is not made again under the old name", async () => {
    findBySpy.mockResolvedValue([
      existing("To Do", { isNotStartedStatus: true }),
      existing("Writing", { isDraftStatus: true }),
      existing("Done", { isCompletedStatus: true }),
    ] as never);

    await ProjectService.addDefaultIncidentPostmortemStatuses(newProject());

    // Only the one that is not built in, which nothing stands for.
    expect(order).toEqual(["Not Needed"]);
  });

  test("a project with every status adds none", async () => {
    findBySpy.mockResolvedValue([
      existing("Not Started", { isNotStartedStatus: true }),
      existing("Draft", { isDraftStatus: true }),
      existing("Completed", { isCompletedStatus: true }),
      existing("Not Needed"),
    ] as never);

    await ProjectService.addDefaultIncidentPostmortemStatuses(newProject());

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("are added when a project is created, with every other default", () => {
    const hook: string = PROJECT_SERVICE_SOURCE.slice(
      PROJECT_SERVICE_SOURCE.indexOf("await Promise.all(["),
    );

    expect(hook).toContain(
      "this.addDefaultIncidentPostmortemStatuses(createdItem),",
    );
    expect(
      hook.indexOf("this.addDefaultIncidentPostmortemStatuses(createdItem),"),
    ).toBeLessThan(hook.indexOf("]);"));
  });

  test("are added to every project from before them by the backfill, which then gives each incident its status", () => {
    expect(BACKFILL_SOURCE).toContain(
      "await ProjectService.addDefaultIncidentPostmortemStatuses(project);",
    );
    expect(BACKFILL_SOURCE).toContain(
      "await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses();",
    );
    // The statuses first: the incidents are given one of them.
    expect(
      BACKFILL_SOURCE.indexOf("addDefaultIncidentPostmortemStatuses(project)"),
    ).toBeLessThan(
      BACKFILL_SOURCE.indexOf("backfillIncidentPostmortemStatuses()"),
    );
  });
});
