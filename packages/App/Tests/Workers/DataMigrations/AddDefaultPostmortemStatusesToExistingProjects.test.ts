import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import Project from "Common/Models/DatabaseModels/Project";
import IncidentPostmortemStatusService from "Common/Server/Services/IncidentPostmortemStatusService";
import ProjectService from "Common/Server/Services/ProjectService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import FindBy from "Common/Server/Types/Database/FindBy";
import logger from "Common/Server/Utils/Logger";
import { LIMIT_INFINITY } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import AddDefaultPostmortemStatusesToExistingProjects from "../../../FeatureSet/Workers/DataMigrations/AddDefaultPostmortemStatusesToExistingProjects";
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

/*
 * AddDefaultPostmortemStatusesToExistingProjects: postmortem statuses
 * arrived with the Postmortems list, so every project from before them gets
 * the four a new project starts with - Not Started, Draft, Completed, Not
 * Needed - and then every incident from before them the status its
 * postmortem is in (IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses,
 * whose SQL the Postgres suite runs).
 *
 * Run end to end with the real seeder; only the services' reads and writes
 * are stubbed, answering from a per-project list of statuses that the
 * creates add to, so a second run sees what the first one made.
 */

const NEW_TO_STATUSES: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000001",
);
const HALF_SEEDED: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000002",
);
const RENAMED: ObjectID = new ObjectID("1c000000-0000-4000-8000-000000000003");

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function project(id: ObjectID): Project {
  const item: Project = new Project();
  item._id = id.toString();
  return item;
}

function status(
  name: string,
  flags: Record<string, boolean> = {},
): IncidentPostmortemStatus {
  const item: IncidentPostmortemStatus = new IncidentPostmortemStatus();
  item._id = ObjectID.generate().toString();
  item.name = name;
  item.isNotStartedStatus = Boolean(flags["isNotStartedStatus"]);
  item.isDraftStatus = Boolean(flags["isDraftStatus"]);
  item.isCompletedStatus = Boolean(flags["isCompletedStatus"]);
  return item;
}

describe("AddDefaultPostmortemStatusesToExistingProjects", () => {
  let statusesByProject: Map<string, Array<IncidentPostmortemStatus>>;
  let created: Array<IncidentPostmortemStatus>;
  let steps: Array<string>;
  let projectReads: Array<Record<string, unknown>>;

  beforeEach(() => {
    statusesByProject = new Map<string, Array<IncidentPostmortemStatus>>([
      [NEW_TO_STATUSES.toString(), []],
      // A run that stopped halfway: two of the four made.
      [
        HALF_SEEDED.toString(),
        [
          status("Not Started", { isNotStartedStatus: true }),
          status("Draft", { isDraftStatus: true }),
        ],
      ],
      // The built-in ones under names of the project's own.
      [
        RENAMED.toString(),
        [
          status("To Do", { isNotStartedStatus: true }),
          status("Writing", { isDraftStatus: true }),
          status("Done", { isCompletedStatus: true }),
        ],
      ],
    ]);
    created = [];
    steps = [];
    projectReads = [];

    jest.spyOn(ProjectService, "findBy").mockImplementation((async (
      findBy: FindBy<Project>,
    ): Promise<Array<Project>> => {
      projectReads.push(findBy as unknown as Record<string, unknown>);
      return [project(NEW_TO_STATUSES), project(HALF_SEEDED), project(RENAMED)];
    }) as never);

    jest
      .spyOn(IncidentPostmortemStatusService, "findBy")
      .mockImplementation((async (
        findBy: FindBy<IncidentPostmortemStatus>,
      ): Promise<Array<IncidentPostmortemStatus>> => {
        const projectId: string = String(
          (findBy.query as { projectId?: unknown }).projectId,
        );

        return [...(statusesByProject.get(projectId) || [])];
      }) as never);

    jest
      .spyOn(IncidentPostmortemStatusService, "create")
      .mockImplementation((async (
        createBy: CreateBy<IncidentPostmortemStatus>,
      ): Promise<IncidentPostmortemStatus> => {
        const projectId: string = createBy.data.projectId!.toString();

        steps.push(`create ${createBy.data.name}`);
        created.push(createBy.data);
        statusesByProject.set(projectId, [
          ...(statusesByProject.get(projectId) || []),
          createBy.data,
        ]);

        return createBy.data;
      }) as never);

    jest
      .spyOn(
        IncidentPostmortemStatusService,
        "backfillIncidentPostmortemStatuses",
      )
      .mockImplementation((async (): Promise<number> => {
        steps.push("backfill");
        return 17;
      }) as never);

    jest.spyOn(logger, "info").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createdFor(projectId: ObjectID): Array<string> {
    return created
      .filter((item: IncidentPostmortemStatus): boolean => {
        return item.projectId?.toString() === projectId.toString();
      })
      .map((item: IncidentPostmortemStatus): string => {
        return item.name || "";
      });
  }

  test("a project from before statuses gets the four a new project starts with, top first, with their flags", async () => {
    await new AddDefaultPostmortemStatusesToExistingProjects().migrate();

    expect(createdFor(NEW_TO_STATUSES)).toEqual([
      "Not Started",
      "Draft",
      "Completed",
      "Not Needed",
    ]);

    const made: Array<IncidentPostmortemStatus> = created.filter(
      (item: IncidentPostmortemStatus): boolean => {
        return item.projectId?.toString() === NEW_TO_STATUSES.toString();
      },
    );

    expect(
      made.map((item: IncidentPostmortemStatus): string => {
        return [
          item.order,
          item.isNotStartedStatus,
          item.isDraftStatus,
          item.isCompletedStatus,
        ].join(",");
      }),
    ).toEqual([
      "1,true,false,false",
      "2,false,true,false",
      "3,false,false,true",
      "4,false,false,false",
    ]);
  });

  test("a run that stopped halfway is finished, not repeated", async () => {
    await new AddDefaultPostmortemStatusesToExistingProjects().migrate();

    expect(createdFor(HALF_SEEDED)).toEqual(["Completed", "Not Needed"]);
  });

  test("built-in statuses a project renamed are not made again under their old names", async () => {
    await new AddDefaultPostmortemStatusesToExistingProjects().migrate();

    expect(createdFor(RENAMED)).toEqual(["Not Needed"]);
  });

  test("reads every project, as OneUptime", async () => {
    await new AddDefaultPostmortemStatusesToExistingProjects().migrate();

    expect(projectReads).toHaveLength(1);
    expect(projectReads[0]!["query"]).toEqual({});
    expect(projectReads[0]!["limit"]).toBe(LIMIT_INFINITY);
    expect(projectReads[0]!["props"]).toEqual({ isRoot: true });
  });

  test("gives the incidents their statuses once, after every project has its own", async () => {
    await new AddDefaultPostmortemStatusesToExistingProjects().migrate();

    expect(
      steps.filter((step: string): boolean => {
        return step === "backfill";
      }),
    ).toHaveLength(1);
    expect(steps[steps.length - 1]).toBe("backfill");
  });

  test("running it again adds nothing, and gives only incidents still without a status theirs", async () => {
    await new AddDefaultPostmortemStatusesToExistingProjects().migrate();

    const firstRun: number = created.length;

    await new AddDefaultPostmortemStatusesToExistingProjects().migrate();

    expect(created).toHaveLength(firstRun);
    // The backfill only fills incidents with no status: safe to run again.
    expect(
      steps.filter((step: string): boolean => {
        return step === "backfill";
      }),
    ).toHaveLength(2);
  });

  test("says what it did in the log", async () => {
    await new AddDefaultPostmortemStatusesToExistingProjects().migrate();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("3 project(s)"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("17 incident(s)"),
    );
  });

  test("rolling it back changes nothing: the statuses are the project's from here on", async () => {
    await new AddDefaultPostmortemStatusesToExistingProjects().rollback();

    expect(created).toHaveLength(0);
    expect(steps).toEqual([]);
  });

  test("is registered under its own name, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      "new AddDefaultPostmortemStatusesToExistingProjects(),",
    );
    expect(
      index.indexOf("new AddDefaultPostmortemStatusesToExistingProjects(),"),
    ).toBeLessThan(index.indexOf("new AddAuditLogMcpClientColumns(),"));
    expect(new AddDefaultPostmortemStatusesToExistingProjects().name).toBe(
      "AddDefaultPostmortemStatusesToExistingProjects",
    );
  });
});
