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
import type { SpyInstance } from "jest-mock";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import ProjectService from "../../../Server/Services/ProjectService";
import SecurityCasePriorityService, {
  getPriorityInUseMessage,
} from "../../../Server/Services/SecurityCasePriorityService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityCaseStatusService, {
  getStatusInUseMessage,
} from "../../../Server/Services/SecurityCaseStatusService";
import SecurityPlaybookService from "../../../Server/Services/SecurityPlaybookService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ArchivableValueGuard from "../../../Server/Utils/Database/ArchivableValueGuard";
import StateOrderGuard from "../../../Server/Utils/Database/StateOrderGuard";
import SecurityCaseDefaultValues from "../../../Server/Utils/SecurityCase/SecurityCaseDefaultValues";
import SecurityCaseValues from "../../../Server/Utils/SecurityCase/SecurityCaseValues";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
} from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage, {
  SECURITY_CASE_STAGE_FLAGS,
} from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../../Utils/ArchivableValues";
import { DEFAULT_SECURITY_CASE_PRIORITIES } from "../../../Utils/SecurityCase/SecurityCasePriorities";
import { DEFAULT_SECURITY_CASE_STATUSES } from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import { STATE_LISTS, StateListType } from "../../../Utils/StateOrder";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

/*
 * A project's case priorities and statuses on the server:
 *
 *   - a new project gets the five priorities and four statuses cases always
 *     had, made top first, each the built-in one of its level or stage, and
 *     only ever added: a value the project has by name, or a built-in one
 *     it has under a name of its own, is not made again;
 *   - a project found with none of a kind is given them before it is read,
 *     so a detection never fails to open its case;
 *   - each list is held to its order and its built-ins by StateOrderGuard
 *     and ArchivableValueGuard, with its own definition;
 *   - a value in use is never deleted - a status cases are in, a priority
 *     cases are at or playbooks run from - and the refusal says how many
 *     and what to do instead.
 *
 * No database: the services are spied.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);

type Hooks<TModel extends DatabaseBaseModel> = {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<unknown>;
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<unknown>;
  onBeforeDelete: (deleteBy: DeleteBy<TModel>) => Promise<OnDelete<TModel>>;
};

/*
 * What a spied guard was called with. The guards are generic over the
 * model, so their spies are read through their calls alone.
 */
type Calls = { mock: { calls: Array<Array<unknown>> } };

const statusHooks: Hooks<SecurityCaseStatus> =
  SecurityCaseStatusService as unknown as Hooks<SecurityCaseStatus>;
const priorityHooks: Hooks<SecurityCasePriority> =
  SecurityCasePriorityService as unknown as Hooks<SecurityCasePriority>;

function project(): Project {
  const model: Project = new Project();
  model._id = PROJECT_ID.toString();
  return model;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new project's case priorities and statuses", () => {
  let priorityCreates: Array<SecurityCasePriority>;
  let statusCreates: Array<SecurityCaseStatus>;

  beforeEach(() => {
    priorityCreates = [];
    statusCreates = [];

    jest
      .spyOn(SecurityCasePriorityService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(SecurityCaseStatusService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(SecurityCasePriorityService, "create")
      .mockImplementation((async (
        createBy: CreateBy<SecurityCasePriority>,
      ): Promise<SecurityCasePriority> => {
        expect(createBy.props.isRoot).toBe(true);
        priorityCreates.push(createBy.data);
        return createBy.data;
      }) as never);
    jest.spyOn(SecurityCaseStatusService, "create").mockImplementation((async (
      createBy: CreateBy<SecurityCaseStatus>,
    ): Promise<SecurityCaseStatus> => {
      expect(createBy.props.isRoot).toBe(true);
      statusCreates.push(createBy.data);
      return createBy.data;
    }) as never);
  });

  test("are the five priorities cases always had, top first, each the built-in of its level", async () => {
    await ProjectService.addDefaultSecurityCasePriorities(project());

    expect(
      priorityCreates.map((priority: SecurityCasePriority) => {
        return [
          priority.projectId?.toString(),
          priority.name,
          priority.description,
          priority.color?.toString(),
          priority.order,
        ];
      }),
    ).toEqual(
      DEFAULT_SECURITY_CASE_PRIORITIES.map(
        (value: (typeof DEFAULT_SECURITY_CASE_PRIORITIES)[number]) => {
          return [
            PROJECT_ID.toString(),
            value.name,
            value.description,
            value.color.toString(),
            value.order,
          ];
        },
      ),
    );

    // Each carries its own level's flag, and no other.
    priorityCreates.forEach(
      (priority: SecurityCasePriority, index: number): void => {
        const level: SecurityCasePriorityLevel =
          DEFAULT_SECURITY_CASE_PRIORITIES[index]!.level;

        for (const [other, flag] of Object.entries(
          SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
        )) {
          expect([
            flag,
            (priority as unknown as Record<string, unknown>)[flag],
          ]).toEqual([flag, other === level]);
        }
      },
    );
  });

  test("are the four statuses cases always went through, top first, each the built-in of its stage", async () => {
    await ProjectService.addDefaultSecurityCaseStatuses(project());

    expect(
      statusCreates.map((status: SecurityCaseStatus) => {
        return [status.name, status.description, status.order];
      }),
    ).toEqual([
      ["New", "Nobody has looked at it yet.", 1],
      ["Investigating", "Someone is working out what happened.", 2],
      [
        "Contained",
        "The threat can no longer do harm; the cleanup is still to do.",
        3,
      ],
      ["Closed", "Done, with a verdict on what it was.", 4],
    ]);

    statusCreates.forEach((status: SecurityCaseStatus, index: number): void => {
      const stage: SecurityCaseStage =
        DEFAULT_SECURITY_CASE_STATUSES[index]!.stage;

      for (const [other, flag] of Object.entries(SECURITY_CASE_STAGE_FLAGS)) {
        expect([
          flag,
          (status as unknown as Record<string, unknown>)[flag],
        ]).toEqual([flag, other === stage]);
      }
    });
  });

  test("are only ever added: a name the project has, or a built-in it has under its own name, is not made again", async () => {
    const renamedCritical: SecurityCasePriority = new SecurityCasePriority();
    renamedCritical.name = "Sev 1";
    renamedCritical.isCriticalPriority = true;
    const ownHigh: SecurityCasePriority = new SecurityCasePriority();
    ownHigh.name = "  high ";

    jest
      .spyOn(SecurityCasePriorityService, "findBy")
      .mockResolvedValue([renamedCritical, ownHigh] as never);

    await SecurityCaseDefaultValues.addDefaultPriorities(PROJECT_ID);

    expect(
      priorityCreates.map((priority: SecurityCasePriority) => {
        return priority.name;
      }),
    ).toEqual(["Medium", "Low", "Informational"]);

    const closed: SecurityCaseStatus = new SecurityCaseStatus();
    closed.name = "Resolved";
    closed.isClosedStatus = true;

    jest
      .spyOn(SecurityCaseStatusService, "findBy")
      .mockResolvedValue([closed] as never);

    await SecurityCaseDefaultValues.addDefaultStatuses(PROJECT_ID);

    expect(
      statusCreates.map((status: SecurityCaseStatus) => {
        return status.name;
      }),
    ).toEqual(["New", "Investigating", "Contained"]);
  });

  test("are seeded with every other default when a project is created", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/Services/ProjectService.ts"),
      "utf8",
    );

    expect(source).toContain(
      "this.addDefaultSecurityCasePriorities(createdItem),",
    );
    expect(source).toContain(
      "this.addDefaultSecurityCaseStatuses(createdItem),",
    );
  });
});

describe("a project found with none of a kind", () => {
  test("is given the defaults, then read again", async () => {
    const defaults: Array<SecurityCasePriority> = buildDefaultTestPriorities();
    const reads: SpyInstance<
      typeof SecurityCasePriorityService.getProjectPriorities
    > = jest
      .spyOn(SecurityCasePriorityService, "getProjectPriorities")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(defaults);
    const seed: SpyInstance<
      typeof SecurityCaseDefaultValues.addDefaultPriorities
    > = jest
      .spyOn(SecurityCaseDefaultValues, "addDefaultPriorities")
      .mockResolvedValue(undefined);

    expect(await SecurityCaseValues.getPriorities(PROJECT_ID)).toBe(defaults);
    expect(seed).toHaveBeenCalledWith(PROJECT_ID);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("a project that has them is read once, and given nothing", async () => {
    const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
    jest
      .spyOn(SecurityCaseStatusService, "getProjectStatuses")
      .mockResolvedValue(statuses);
    const seed: SpyInstance<
      typeof SecurityCaseDefaultValues.addDefaultStatuses
    > = jest
      .spyOn(SecurityCaseDefaultValues, "addDefaultStatuses")
      .mockResolvedValue(undefined);

    expect(await SecurityCaseValues.getStatuses(PROJECT_ID)).toBe(statuses);
    expect(seed).not.toHaveBeenCalled();

    // Open and closed, by id.
    expect(
      (await SecurityCaseValues.getOpenStatusIds(PROJECT_ID)).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([
      testStatusId(SecurityCaseStage.New).toString(),
      testStatusId(SecurityCaseStage.Acknowledged).toString(),
      testStatusId(SecurityCaseStage.Contained).toString(),
    ]);
    expect(
      (await SecurityCaseValues.getClosedStatusIds(PROJECT_ID)).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([testStatusId(SecurityCaseStage.Closed).toString()]);
  });
});

describe("each list is held to its order and its built-ins", () => {
  test.each([
    [
      "statuses",
      statusHooks as unknown as Hooks<DatabaseBaseModel>,
      StateListType.SecurityCaseStatus,
      ArchivableValueType.SecurityCaseStatus,
    ],
    [
      "priorities",
      priorityHooks as unknown as Hooks<DatabaseBaseModel>,
      StateListType.SecurityCasePriority,
      ArchivableValueType.SecurityCasePriority,
    ],
  ] as Array<
    [string, Hooks<DatabaseBaseModel>, StateListType, ArchivableValueType]
  >)(
    "%s: create and update ask both guards, with the list's own definition",
    async (
      _name: string,
      hooks: Hooks<DatabaseBaseModel>,
      listType: StateListType,
      archivableType: ArchivableValueType,
    ) => {
      const orderCreate: Calls = jest
        .spyOn(StateOrderGuard, "beforeCreate")
        .mockResolvedValue(undefined);
      const orderUpdate: Calls = jest
        .spyOn(StateOrderGuard, "beforeUpdate")
        .mockResolvedValue(undefined);
      const archiveCreate: Calls = jest
        .spyOn(ArchivableValueGuard, "beforeCreate")
        .mockResolvedValue(undefined);
      const archiveUpdate: Calls = jest
        .spyOn(ArchivableValueGuard, "beforeUpdate")
        .mockResolvedValue(undefined);

      await hooks.onBeforeCreate({
        data: {},
        props: { isRoot: true },
      } as never);
      await hooks.onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { order: 2 },
        props: { isRoot: true },
      } as never);

      expect(
        (orderCreate.mock.calls[0]![0] as { definition: unknown }).definition,
      ).toBe(STATE_LISTS[listType]);
      expect(
        (orderUpdate.mock.calls[0]![0] as { definition: unknown }).definition,
      ).toBe(STATE_LISTS[listType]);
      expect(
        (archiveCreate.mock.calls[0]![0] as { definition: unknown }).definition,
      ).toBe(ARCHIVABLE_VALUES[archivableType]);
      expect(
        (archiveUpdate.mock.calls[0]![0] as { definition: unknown }).definition,
      ).toBe(ARCHIVABLE_VALUES[archivableType]);
    },
  );
});

describe("a value in use is never deleted", () => {
  function deleteBy(isRoot: boolean = false): DeleteBy<DatabaseBaseModel> {
    return {
      query: { _id: testStatusId(SecurityCaseStage.Contained) },
      props: isRoot
        ? { isRoot: true }
        : { userId: ObjectID.generate(), tenantId: PROJECT_ID },
    } as unknown as DeleteBy<DatabaseBaseModel>;
  }

  beforeEach(() => {
    // The built-ins' own check is StateOrderGuard's (StateOrder.test.ts).
    jest.spyOn(StateOrderGuard, "beforeDelete").mockResolvedValue(undefined);
  });

  test("a status cases are in: refused with how many, and the way on", async () => {
    const status: SecurityCaseStatus = new SecurityCaseStatus();
    status._id = testStatusId(SecurityCaseStage.Contained).toString();
    status.name = "Contained";

    jest
      .spyOn(SecurityCaseStatusService, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([status] as never);
    const count: SpyInstance<typeof SecurityCaseService.countBy> = jest
      .spyOn(SecurityCaseService, "countBy")
      .mockResolvedValue(new PositiveNumber(3) as never);

    await expect(
      statusHooks.onBeforeDelete(deleteBy() as never),
    ).rejects.toThrow(
      new BadDataException(
        `"Contained" can't be deleted: 3 cases are in it. Move them to another status first, or archive it so nobody picks it again.`,
      ),
    );
    expect(
      String(
        (count.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
          "securityCaseStatusId"
        ],
      ),
    ).toBe(testStatusId(SecurityCaseStage.Contained).toString());

    count.mockResolvedValue(new PositiveNumber(0) as never);

    await expect(
      statusHooks.onBeforeDelete(deleteBy() as never),
    ).resolves.toBeDefined();
  });

  test("a priority cases are at, or playbooks run from: refused with both counts", async () => {
    const priority: SecurityCasePriority = new SecurityCasePriority();
    priority._id = testPriorityId(SecurityCasePriorityLevel.Low).toString();
    priority.name = "P4";

    jest
      .spyOn(SecurityCasePriorityService, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([priority] as never);
    const cases: SpyInstance<typeof SecurityCaseService.countBy> = jest
      .spyOn(SecurityCaseService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    const playbooks: SpyInstance<typeof SecurityPlaybookService.countBy> = jest
      .spyOn(SecurityPlaybookService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    await expect(
      priorityHooks.onBeforeDelete(deleteBy() as never),
    ).rejects.toThrow(
      /^"P4" can't be deleted: 1 case is at it and 2 playbooks run from it/,
    );
    expect(
      String(
        (playbooks.mock.calls[0]![0] as { query: Record<string, unknown> })
          .query["minimumSecurityCasePriorityId"],
      ),
    ).toBe(testPriorityId(SecurityCasePriorityLevel.Low).toString());

    cases.mockResolvedValue(new PositiveNumber(0) as never);
    playbooks.mockResolvedValue(new PositiveNumber(0) as never);

    await expect(
      priorityHooks.onBeforeDelete(deleteBy() as never),
    ).resolves.toBeDefined();
  });

  test("a delete without an id is refused for a person", async () => {
    await expect(
      statusHooks.onBeforeDelete({
        query: { projectId: PROJECT_ID },
        props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
      } as never),
    ).rejects.toThrow(/_id should be present/);
  });

  test("the messages name the value and say what to do instead", () => {
    expect(getStatusInUseMessage({ name: "", cases: 1 })).toBe(
      "This status can't be deleted: 1 case is in it. Move them to another status first, or archive it so nobody picks it again.",
    );
    expect(
      getPriorityInUseMessage({ name: "Emergency", cases: 0, playbooks: 1 }),
    ).toContain(`"Emergency" can't be deleted: 1 playbook runs from it`);
    expect(
      getPriorityInUseMessage({ name: "Emergency", cases: 0, playbooks: 1 }),
    ).toMatch(/archive it/);
  });
});
