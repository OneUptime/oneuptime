import MonitorService from "../../../Server/Services/MonitorService";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withLabelJoinTables } from "../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * DatabaseService.findOneUpdatableById: the row, read as root, when the
 * caller may update it. A custom route asks it before an action that
 * changes the row as root (a custom domain's Check now, say), so it has to
 * ask what an update asks:
 *
 *   - the table's update permissions, and the team block list against all
 *     of the row's labels (updateOneById's checks), refusing like an update;
 *   - the row inside the caller's update scope (getUpdatableQuery), so a row
 *     in another project, or outside the labels the caller may edit, answers
 *     nothing;
 *   - the labels the checks weigh are read in the caller's project only, so
 *     a row of another project is answered as a missing one;
 *   - a credential that may only read is refused.
 *
 * Monitor is the model under test because it carries labels: the block list
 * and label-scoped grants have something to act on.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const LABEL_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function caller(data: {
  permissions: Array<Permission>;
  labelIds?: Array<ObjectID>;
  blocks?: Array<Permission>;
  blockLabelIds?: Array<ObjectID>;
  isReadOnlyCredential?: boolean;
  isMasterAdmin?: boolean;
}): DatabaseCommonInteractionProps {
  const grants: Array<UserPermission> = [
    ...data.permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: data.labelIds || [],
        isBlockPermission: false,
      };
    }),
    ...(data.blocks || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: data.blockLabelIds || [],
        isBlockPermission: true,
      };
    }),
  ];

  const props: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: grants,
      },
    },
  };

  if (data.isReadOnlyCredential) {
    props.isReadOnlyCredential = true;
  }

  if (data.isMasterAdmin) {
    props.isMasterAdmin = true;
  }

  return props;
}

function monitorRow(labels: Array<ObjectID> = []): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  // Read with its project, as the label lookup selects it.
  monitor.projectId = PROJECT_ID;
  monitor.name = "API";
  monitor.labels = labels.map((labelId: ObjectID): Label => {
    const label: Label = new Label();
    label._id = labelId.toString();
    label.name = "Production";
    return label;
  });
  return monitor;
}

const SELECT: { _id: true; name: true } = { _id: true, name: true };

/*
 * A custom role that may edit monitors: an update reads the row by its id
 * and project, so it needs read as well as edit, as the update endpoint does.
 */
const MONITOR_EDITOR: Array<Permission> = [
  Permission.ReadProjectMonitor,
  Permission.EditProjectMonitor,
];

type Lookup = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
};

describe("DatabaseService.findOneUpdatableById", () => {
  // The lookup in the caller's update scope.
  let findOneByMock: MockFunction;
  // The read of the row with every one of its labels, for the checks.
  let labelsFetchMock: MockFunction;

  beforeEach(() => {
    findOneByMock = getJestMockFunction();
    labelsFetchMock = getJestMockFunction();

    findOneByMock.mockResolvedValue(monitorRow() as never);
    labelsFetchMock.mockResolvedValue(monitorRow() as never);

    // Both are reads of one row: the labels read selects the labels.
    jest.spyOn(MonitorService, "findOneBy").mockImplementation(((
      args: Lookup,
    ) => {
      return args.select && args.select["labels"]
        ? labelsFetchMock(args)
        : findOneByMock(args);
    }) as never);

    // A team's block with labels narrows the update scope's lookup too.
    withLabelJoinTables();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function lookup(): Lookup {
    expect(findOneByMock).toHaveBeenCalledTimes(1);
    return findOneByMock.mock.calls[0]![0] as Lookup;
  }

  test("an editor gets the row, read once as root, with the select asked for, inside their project", async () => {
    const row: Monitor | null = await MonitorService.findOneUpdatableById({
      id: MONITOR_ID,
      select: SELECT,
      props: caller({ permissions: [Permission.ProjectMember] }),
    });

    expect(row?._id).toBe(MONITOR_ID.toString());
    expect(lookup().query["_id"]).toBe(MONITOR_ID.toString());
    expect(JSON.stringify(lookup().query["projectId"])).toContain(
      PROJECT_ID.toString(),
    );
    expect(lookup().select).toEqual(SELECT);
    expect(lookup().props).toEqual({ isRoot: true });
  });

  test("a row outside the caller's scope answers nothing", async () => {
    findOneByMock.mockResolvedValue(null as never);

    expect(
      await MonitorService.findOneUpdatableById({
        id: MONITOR_ID,
        select: SELECT,
        props: caller({ permissions: MONITOR_EDITOR }),
      }),
    ).toBeNull();
  });

  test.each([
    [Permission.Viewer],
    [Permission.MonitorViewer],
    [Permission.ReadProjectMonitor],
    [Permission.CreateProjectMonitor],
    [Permission.DeleteProjectMonitor],
  ])(
    "%s alone is refused as an update is, before the row is read",
    async (permission: Permission) => {
      await expect(
        MonitorService.findOneUpdatableById({
          id: MONITOR_ID,
          select: SELECT,
          props: caller({ permissions: [permission] }),
        }),
      ).rejects.toThrow(NotAuthorizedException);

      expect(findOneByMock).not.toHaveBeenCalled();
    },
  );

  test("a credential that may only read is refused, whatever it holds", async () => {
    await expect(
      MonitorService.findOneUpdatableById({
        id: MONITOR_ID,
        select: SELECT,
        props: caller({
          permissions: [Permission.ProjectOwner],
          isReadOnlyCredential: true,
        }),
      }),
    ).rejects.toThrow(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );

    expect(findOneByMock).not.toHaveBeenCalled();
  });

  test("a team block on the edit permission refuses an editor", async () => {
    await expect(
      MonitorService.findOneUpdatableById({
        id: MONITOR_ID,
        select: SELECT,
        props: caller({
          permissions: MONITOR_EDITOR,
          blocks: [Permission.EditProjectMonitor],
        }),
      }),
    ).rejects.toThrow(NotAuthorizedException);
  });

  /*
   * The block list is checked against every label on the row, read as root:
   * labels the caller may not see still count.
   */
  test("a block on one of the row's labels refuses, and reads the row's labels as root, in the caller's project", async () => {
    labelsFetchMock.mockResolvedValue(monitorRow([LABEL_ID]) as never);

    await expect(
      MonitorService.findOneUpdatableById({
        id: MONITOR_ID,
        select: SELECT,
        props: caller({
          permissions: MONITOR_EDITOR,
          blocks: [Permission.EditProjectMonitor],
          blockLabelIds: [LABEL_ID],
        }),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    const fetch: Lookup = labelsFetchMock.mock.calls[0]![0] as Lookup;

    expect(fetch.query["_id"]).toBe(MONITOR_ID.toString());
    // Only in the caller's project: another project's row is not read.
    expect(String(fetch.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(fetch.select).toEqual({
      labels: { _id: true, name: true },
      projectId: true,
    });
    expect(fetch.props).toEqual({ isRoot: true });
    expect(findOneByMock).not.toHaveBeenCalled();
  });

  test("a block on a label the row does not carry lets the editor through", async () => {
    labelsFetchMock.mockResolvedValue(monitorRow([]) as never);

    expect(
      await MonitorService.findOneUpdatableById({
        id: MONITOR_ID,
        select: SELECT,
        props: caller({
          permissions: MONITOR_EDITOR,
          blocks: [Permission.EditProjectMonitor],
          blockLabelIds: [LABEL_ID],
        }),
      }),
    ).not.toBeNull();
  });

  test("a row the block list finds gone answers nothing, not an error", async () => {
    labelsFetchMock.mockResolvedValue(null as never);

    expect(
      await MonitorService.findOneUpdatableById({
        id: MONITOR_ID,
        select: SELECT,
        props: caller({
          permissions: MONITOR_EDITOR,
          blocks: [Permission.EditProjectMonitor],
          blockLabelIds: [LABEL_ID],
        }),
      }),
    ).toBeNull();

    expect(findOneByMock).not.toHaveBeenCalled();
  });

  test("an editor limited to some labels is looked for among the rows carrying them", async () => {
    labelsFetchMock.mockResolvedValue(monitorRow([LABEL_ID]) as never);

    await MonitorService.findOneUpdatableById({
      id: MONITOR_ID,
      select: SELECT,
      props: caller({
        permissions: MONITOR_EDITOR,
        labelIds: [LABEL_ID],
      }),
    });

    expect(JSON.stringify(lookup().query["labels"])).toContain(
      LABEL_ID.toString(),
    );
  });

  test("a master admin gets the row by its id alone", async () => {
    const row: Monitor | null = await MonitorService.findOneUpdatableById({
      id: MONITOR_ID,
      select: SELECT,
      props: caller({ permissions: [], isMasterAdmin: true }),
    });

    expect(row).not.toBeNull();
    expect(lookup().query).toEqual({ _id: MONITOR_ID.toString() });
    expect(lookup().props).toEqual({ isRoot: true });
  });
});
