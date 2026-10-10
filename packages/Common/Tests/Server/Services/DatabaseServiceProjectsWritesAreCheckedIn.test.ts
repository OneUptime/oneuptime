import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseService from "../../../Server/Services/DatabaseService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { idsNamedBy } from "../TestingUtils/QueryConditions";

/*
 * THE PROJECT A WRITE'S REFERENCES ARE CHECKED IN IS THE PROJECT OF THE ROWS
 * IT WRITES.
 *
 * A teammate's write is kept to the request's project by its permission
 * check, so what it names is checked in that project, with nothing read.
 * OneUptime's write, and a master admin's, reach any row their query names,
 * whatever project the request is made in - so theirs is checked in the
 * project of each row they write (getProjectWriteIsHeldTo,
 * getProjectToCheckRowIn, findProjectsToCheckUpdateIn), with the update held
 * to the rows read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4a000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "4a000000-0000-4000-8000-000000000002",
);
const ROW_A: string = "4b000000-0000-4000-8000-00000000000a";
const ROW_B: string = "4b000000-0000-4000-8000-00000000000b";
const ROW_C: string = "4b000000-0000-4000-8000-00000000000c";
const USER_ID: ObjectID = new ObjectID("4c000000-0000-4000-8000-000000000001");

const TEAMMATE: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};
const ROOT_IN_PROJECT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};
const MASTER_ADMIN_IN_PROJECT: DatabaseCommonInteractionProps = {
  isMasterAdmin: true,
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

function monitor(id: string, projectId: ObjectID | undefined): Monitor {
  const row: Monitor = new Monitor();
  row._id = id;

  if (projectId) {
    row.projectId = projectId;
  }

  return row;
}

function updateOf(props: DatabaseCommonInteractionProps): UpdateBy<Monitor> {
  return {
    query: { name: "Edge" },
    data: { description: "Checked" },
    props: props,
    skip: 0,
    limit: 100,
  } as unknown as UpdateBy<Monitor>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DatabaseService.getProjectWriteIsHeldTo", () => {
  it("is the request's project for a teammate", () => {
    expect(DatabaseService.getProjectWriteIsHeldTo(TEAMMATE)).toBe(PROJECT_ID);
  });

  it("is none for OneUptime or a master admin, whatever project the request names", () => {
    expect(DatabaseService.getProjectWriteIsHeldTo(ROOT_IN_PROJECT)).toBeNull();
    expect(
      DatabaseService.getProjectWriteIsHeldTo(MASTER_ADMIN_IN_PROJECT),
    ).toBeNull();
  });

  it("is none for a request across projects, or with no project", () => {
    expect(
      DatabaseService.getProjectWriteIsHeldTo({
        ...TEAMMATE,
        isMultiTenantRequest: true,
      }),
    ).toBeNull();
    expect(
      DatabaseService.getProjectWriteIsHeldTo({ userId: USER_ID }),
    ).toBeNull();
  });
});

describe("DatabaseService.getProjectToCheckRowIn", () => {
  it("is the request's project for a teammate, whatever the row names", () => {
    expect(
      DatabaseService.getProjectToCheckRowIn(TEAMMATE, OTHER_PROJECT_ID),
    ).toBe(PROJECT_ID);
  });

  it("is the row's own project for OneUptime and a master admin", () => {
    expect(
      DatabaseService.getProjectToCheckRowIn(ROOT_IN_PROJECT, OTHER_PROJECT_ID),
    ).toBe(OTHER_PROJECT_ID);
    expect(
      DatabaseService.getProjectToCheckRowIn(
        MASTER_ADMIN_IN_PROJECT,
        OTHER_PROJECT_ID,
      ),
    ).toBe(OTHER_PROJECT_ID);
  });

  it("falls back to the request's project for a row that names none, and is none without either", () => {
    expect(DatabaseService.getProjectToCheckRowIn(ROOT_IN_PROJECT, null)).toBe(
      PROJECT_ID,
    );
    expect(
      DatabaseService.getProjectToCheckRowIn({ isRoot: true }, undefined),
    ).toBeUndefined();
  });
});

describe("DatabaseService.findProjectsToCheckUpdateIn", () => {
  it("checks a teammate's update in the request's project, with nothing read", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const findBy: jest.SpyInstance = jest.spyOn(service, "findBy");
    const rawRead: jest.SpyInstance = jest.spyOn(
      service as unknown as { _findBy: () => unknown },
      "_findBy",
    );

    const updateBy: UpdateBy<Monitor> = updateOf(TEAMMATE);

    expect(await service.findProjectsToCheckUpdateIn(updateBy)).toEqual([
      PROJECT_ID,
    ]);
    expect(findBy).not.toHaveBeenCalled();
    expect(rawRead).not.toHaveBeenCalled();
    expect(updateBy.query).toEqual({ name: "Edge" });
  });

  it.each([
    ["OneUptime", ROOT_IN_PROJECT],
    ["a master admin", MASTER_ADMIN_IN_PROJECT],
  ])(
    "checks %s's update in the project of each row it writes, each once, and holds the update to those rows",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
        Monitor,
      );
      const findBy: jest.SpyInstance = jest
        .spyOn(service, "findBy")
        .mockResolvedValue([
          monitor(ROW_A, OTHER_PROJECT_ID),
          monitor(ROW_B, PROJECT_ID),
          monitor(ROW_C, OTHER_PROJECT_ID),
        ] as never);

      const updateBy: UpdateBy<Monitor> = updateOf(props);

      const projects: Array<string> = (
        await service.findProjectsToCheckUpdateIn(updateBy)
      ).map((projectId: ObjectID): string => {
        return projectId.toString();
      });

      expect(projects.sort()).toEqual(
        [OTHER_PROJECT_ID.toString(), PROJECT_ID.toString()].sort(),
      );

      // The update's own query, in its window, with each row's project.
      const read: { query: JSONObject; select: JSONObject; skip: number } =
        findBy.mock.calls[0]![0];

      expect(read.query).toEqual({ name: "Edge" });
      expect(read.select["projectId"]).toBe(true);
      expect(read.skip).toBe(0);

      expect(
        idsNamedBy((updateBy.query as JSONObject)["_id"]).sort(),
      ).toEqual([ROW_A, ROW_B, ROW_C].sort());
      expect(updateBy.limit).toBe(3);
    },
  );

  it("checks OneUptime's update of no row in no project, and holds it to none", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    jest.spyOn(service, "findBy").mockResolvedValue([] as never);

    const updateBy: UpdateBy<Monitor> = updateOf(ROOT_IN_PROJECT);

    expect(await service.findProjectsToCheckUpdateIn(updateBy)).toEqual([]);
    expect(idsNamedBy((updateBy.query as JSONObject)["_id"])).toEqual([]);
  });
});
