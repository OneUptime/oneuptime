import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import StatusPageGroupTreeUtil from "../../../Utils/StatusPage/GroupTree";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * Contract under test - the write side of nested status page groups.
 *
 * The parent pointer is a plain nullable column, so the service is the only
 * thing standing between a well formed tree and one that cannot be rendered or
 * rolled up. It has to reject, on both create and update:
 *
 *   - a parent on a different status page (groups roll up per page),
 *   - a group parented to itself,
 *   - a group parented to one of its own sub groups (a cycle - which would
 *     make the group unreachable from any root and its rollups circular),
 *   - a move that pushes the group, or anything already nested under it,
 *     past the nesting limit.
 *
 * And it must not pay for any of that when the write does not touch the parent.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function groupId(index: number): ObjectID {
  const suffix: string = index.toString().padStart(12, "0");
  return new ObjectID(`aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`);
}

function makeGroup(data: {
  id: ObjectID;
  parentId?: ObjectID | undefined;
  statusPageId?: ObjectID | undefined;
}): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id.toString();
  group.statusPageId = data.statusPageId || STATUS_PAGE_ID;

  if (data.parentId) {
    group.parentStatusPageGroupId = data.parentId;
  }

  return group;
}

/*
 * Wires up the reads the hooks make: findOneById resolves a parent, findBy
 * resolves either "every group on the status page" or "the groups this update
 * matches", and the order bookkeeping is stubbed out so these cases only
 * exercise the hierarchy rules.
 */
function mockService(data: {
  groupsOnStatusPage: Array<StatusPageGroup>;
  groupsMatchedByUpdate?: Array<StatusPageGroup> | undefined;
}): void {
  jest
    .spyOn(StatusPageGroupService, "findOneById")
    .mockImplementation(async (findBy: any) => {
      return (
        data.groupsOnStatusPage.find((group: StatusPageGroup) => {
          return group._id?.toString() === findBy.id?.toString();
        }) || null
      );
    });

  jest
    .spyOn(StatusPageGroupService, "findBy")
    .mockImplementation(async (findBy: any) => {
      if (findBy.query && findBy.query.statusPageId) {
        return data.groupsOnStatusPage;
      }

      return data.groupsMatchedByUpdate || [];
    });

  jest
    .spyOn(StatusPageGroupService, "countBy")
    .mockResolvedValue(new PositiveNumber(data.groupsOnStatusPage.length));

  jest.spyOn(StatusPageGroupService, "updateOneBy").mockResolvedValue(1);
}

function createBy(data: {
  parentStatusPageGroupId?: ObjectID | undefined;
  statusPageId?: ObjectID | undefined;
}): CreateBy<StatusPageGroup> {
  const group: StatusPageGroup = new StatusPageGroup();
  group.name = "New Group";
  group.projectId = PROJECT_ID;
  group.statusPageId = data.statusPageId || STATUS_PAGE_ID;
  group.order = 1;

  if (data.parentStatusPageGroupId) {
    group.parentStatusPageGroupId = data.parentStatusPageGroupId;
  }

  return {
    data: group,
    props: { isRoot: true },
  } as CreateBy<StatusPageGroup>;
}

function updateBy(data: {
  id: ObjectID;
  parentStatusPageGroupId: ObjectID | null;
}): UpdateBy<StatusPageGroup> {
  return {
    query: { _id: data.id.toString() },
    data: {
      parentStatusPageGroupId: data.parentStatusPageGroupId,
    },
    props: { isRoot: true },
  } as unknown as UpdateBy<StatusPageGroup>;
}

describe("StatusPageGroupService nesting rules", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("on create", () => {
    it("accepts a parent that lives on the same status page", async () => {
      const parent: StatusPageGroup = makeGroup({ id: groupId(1) });
      mockService({ groupsOnStatusPage: [parent] });

      await expect(
        (StatusPageGroupService as any).onBeforeCreate(
          createBy({ parentStatusPageGroupId: groupId(1) }),
        ),
      ).resolves.toBeDefined();
    });

    it("rejects a parent that does not exist", async () => {
      mockService({ groupsOnStatusPage: [] });

      await expect(
        (StatusPageGroupService as any).onBeforeCreate(
          createBy({ parentStatusPageGroupId: groupId(1) }),
        ),
      ).rejects.toThrow(new BadDataException("Parent group not found."));
    });

    it("rejects a parent from another status page", async () => {
      const parent: StatusPageGroup = makeGroup({
        id: groupId(1),
        statusPageId: OTHER_STATUS_PAGE_ID,
      });
      mockService({ groupsOnStatusPage: [parent] });

      await expect(
        (StatusPageGroupService as any).onBeforeCreate(
          createBy({ parentStatusPageGroupId: groupId(1) }),
        ),
      ).rejects.toThrow(
        new BadDataException(
          "Parent group must belong to the same status page.",
        ),
      );
    });

    it("rejects a parent that is already at the nesting limit", async () => {
      // a chain 0 -> 1 -> ... -> 9, so group 9 already sits at the deepest level.
      const chain: Array<StatusPageGroup> = [];

      for (
        let index: number = 0;
        index < StatusPageGroupTreeUtil.MaxNestingDepth;
        index++
      ) {
        chain.push(
          makeGroup({
            id: groupId(index),
            parentId: index === 0 ? undefined : groupId(index - 1),
          }),
        );
      }

      mockService({ groupsOnStatusPage: chain });

      await expect(
        (StatusPageGroupService as any).onBeforeCreate(
          createBy({
            parentStatusPageGroupId: groupId(
              StatusPageGroupTreeUtil.MaxNestingDepth - 1,
            ),
          }),
        ),
      ).rejects.toThrow(BadDataException);

      // one level up is still fine.
      await expect(
        (StatusPageGroupService as any).onBeforeCreate(
          createBy({
            parentStatusPageGroupId: groupId(
              StatusPageGroupTreeUtil.MaxNestingDepth - 2,
            ),
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("does not look for a parent when none was supplied", async () => {
      mockService({ groupsOnStatusPage: [] });

      await expect(
        (StatusPageGroupService as any).onBeforeCreate(createBy({})),
      ).resolves.toBeDefined();

      expect(StatusPageGroupService.findOneById).not.toHaveBeenCalled();
    });
  });

  describe("on update", () => {
    it("accepts a move to another branch", async () => {
      const branchA: StatusPageGroup = makeGroup({ id: groupId(1) });
      const branchB: StatusPageGroup = makeGroup({ id: groupId(2) });
      const moving: StatusPageGroup = makeGroup({
        id: groupId(3),
        parentId: groupId(1),
      });

      mockService({
        groupsOnStatusPage: [branchA, branchB, moving],
        groupsMatchedByUpdate: [moving],
      });

      await expect(
        (StatusPageGroupService as any).onBeforeUpdate(
          updateBy({ id: groupId(3), parentStatusPageGroupId: groupId(2) }),
        ),
      ).resolves.toBeDefined();
    });

    it("rejects a group being made its own parent", async () => {
      const group: StatusPageGroup = makeGroup({ id: groupId(1) });

      mockService({
        groupsOnStatusPage: [group],
        groupsMatchedByUpdate: [group],
      });

      await expect(
        (StatusPageGroupService as any).onBeforeUpdate(
          updateBy({ id: groupId(1), parentStatusPageGroupId: groupId(1) }),
        ),
      ).rejects.toThrow(
        new BadDataException("A group cannot be its own parent group."),
      );
    });

    it("rejects a group being nested under its own child", async () => {
      const parent: StatusPageGroup = makeGroup({ id: groupId(1) });
      const child: StatusPageGroup = makeGroup({
        id: groupId(2),
        parentId: groupId(1),
      });

      mockService({
        groupsOnStatusPage: [parent, child],
        groupsMatchedByUpdate: [parent],
      });

      await expect(
        (StatusPageGroupService as any).onBeforeUpdate(
          updateBy({ id: groupId(1), parentStatusPageGroupId: groupId(2) }),
        ),
      ).rejects.toThrow(
        new BadDataException(
          "This group cannot be nested under one of its own sub groups.",
        ),
      );
    });

    it("rejects a group being nested under a deeper descendant", async () => {
      const grandparent: StatusPageGroup = makeGroup({ id: groupId(1) });
      const parent: StatusPageGroup = makeGroup({
        id: groupId(2),
        parentId: groupId(1),
      });
      const child: StatusPageGroup = makeGroup({
        id: groupId(3),
        parentId: groupId(2),
      });

      mockService({
        groupsOnStatusPage: [grandparent, parent, child],
        groupsMatchedByUpdate: [grandparent],
      });

      await expect(
        (StatusPageGroupService as any).onBeforeUpdate(
          updateBy({ id: groupId(1), parentStatusPageGroupId: groupId(3) }),
        ),
      ).rejects.toThrow(
        new BadDataException(
          "This group cannot be nested under one of its own sub groups.",
        ),
      );
    });

    /*
     * Moving a group drags its whole subtree with it, so the limit has to be
     * checked against the deepest descendant, not just the group itself.
     */
    it("rejects a move that would push the group's own subtree past the limit", async () => {
      const chain: Array<StatusPageGroup> = [];

      for (
        let index: number = 0;
        index < StatusPageGroupTreeUtil.MaxNestingDepth - 1;
        index++
      ) {
        chain.push(
          makeGroup({
            id: groupId(index),
            parentId: index === 0 ? undefined : groupId(index - 1),
          }),
        );
      }

      // a separate two level branch: 100 -> 101.
      const movingRoot: StatusPageGroup = makeGroup({ id: groupId(100) });
      const movingChild: StatusPageGroup = makeGroup({
        id: groupId(101),
        parentId: groupId(100),
      });

      mockService({
        groupsOnStatusPage: [...chain, movingRoot, movingChild],
        groupsMatchedByUpdate: [movingRoot],
      });

      await expect(
        (StatusPageGroupService as any).onBeforeUpdate(
          updateBy({
            id: groupId(100),
            parentStatusPageGroupId: groupId(
              StatusPageGroupTreeUtil.MaxNestingDepth - 2,
            ),
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it("does not validate a parent when the update detaches the group", async () => {
      const group: StatusPageGroup = makeGroup({
        id: groupId(1),
        parentId: groupId(2),
      });

      mockService({
        groupsOnStatusPage: [group],
        groupsMatchedByUpdate: [group],
      });

      await expect(
        (StatusPageGroupService as any).onBeforeUpdate(
          updateBy({ id: groupId(1), parentStatusPageGroupId: null }),
        ),
      ).resolves.toBeDefined();

      expect(StatusPageGroupService.findOneById).not.toHaveBeenCalled();
    });

    it("does not read anything when the update does not touch the parent", async () => {
      mockService({ groupsOnStatusPage: [] });

      const update: UpdateBy<StatusPageGroup> = {
        query: { _id: groupId(1).toString() },
        data: { name: "Renamed" },
        props: { isRoot: true },
      } as unknown as UpdateBy<StatusPageGroup>;

      await expect(
        (StatusPageGroupService as any).onBeforeUpdate(update),
      ).resolves.toBeDefined();

      expect(StatusPageGroupService.findOneById).not.toHaveBeenCalled();
      expect(StatusPageGroupService.findBy).not.toHaveBeenCalled();
    });
  });
});
