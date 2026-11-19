import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferencesService from "./ProjectReferencesService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ContiguousOrder from "../Utils/Database/ContiguousOrder";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { MoveInListResult } from "../../Types/Database/MoveInList";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import StatusPageGroupTreeUtil from "../../Utils/StatusPage/GroupTree";
import Model from "../../Models/DatabaseModels/StatusPageGroup";

/*
 * The two names of each reference this service checks itself, ID column
 * first. A write may name either, and the two must agree
 * (RelationIdUtil.readConsistent).
 */
const STATUS_PAGE_KEYS: Array<string> = ["statusPageId", "statusPage"];
const PARENT_GROUP_KEYS: Array<string> = [
  "parentStatusPageGroupId",
  "parentStatusPageGroup",
];

/*
 * The columns that name the list a group is numbered in: its status page,
 * in its project. A status page numbers all of its groups in one sequence,
 * whatever their parent; the tree draws each group's sub groups by it.
 */
const ORDER_LIST_COLUMNS: Array<string> = ["statusPageId", "projectId"];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;

    /*
     * The status page and the parent group, each under either of its names,
     * and kept in the ID column for the checks below and for the saved row.
     */
    const statusPageId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createData,
      STATUS_PAGE_KEYS,
      "Status Page",
    );

    if (!statusPageId) {
      throw new BadDataException("Status Page Group statusPageId is required");
    }

    const parentStatusPageGroupId: ObjectID | null =
      RelationIdUtil.readIntoIdColumn(
        createData,
        PARENT_GROUP_KEYS,
        "Parent Group",
      );

    if (parentStatusPageGroupId) {
      await this.assertParentIsValid({
        statusPageGroupId: null,
        parentStatusPageGroupId: parentStatusPageGroupId,
        statusPageId: statusPageId,
      });
    }

    /*
     * A group created at a number keeps it, and moves no other group
     * (ContiguousOrder): one created without a number goes after the last
     * group of its status page.
     */
    if (!createBy.data.order) {
      const projectId: ObjectID | undefined =
        createBy.props.tenantId || createBy.data.projectId;

      createBy.data.order = await ContiguousOrder.getAppendOrder({
        service: this,
        list: {
          statusPageId: statusPageId,
          ...(projectId ? { projectId: projectId } : {}),
        },
      });
    }

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  /*
   * Moves a group to the place another group of its status page holds (POST
   * /status-page-group/:id/move, Types/Database/MoveInList): the groups
   * between them step one place towards where it was, in one transaction
   * holding the page's groups. What the Dashboard's Move up and Move down
   * send; a write of `order` places the group alone.
   */
  @CaptureSpan()
  public override async moveInList(data: {
    id: ObjectID;
    placeOfId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<MoveInListResult> {
    const moved: { changedRows: Array<{ id: string; order: number }> } =
      await ContiguousOrder.move({
        service: this,
        rowId: data.id,
        placeOfId: data.placeOfId,
        listColumns: ORDER_LIST_COLUMNS,
        props: data.props,
      });

    return { changedRows: moved.changedRows };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting status page group. Please try the delete with objectId",
      );
    }

    if (!deleteBy.props.isRoot) {
      /*
       * The one group the delete removes, and the delete held to it. The
       * groups after it keep their numbers (ContiguousOrder): a gap is read
       * past like any other.
       */
      const found: { row: Model | null; deletesMore: boolean } =
        await this.findOneRowAndHoldDeleteToIt(deleteBy, {
          _id: true,
        });

      if (found.deletesMore) {
        throw new BadDataException("Delete one status page group at a time.");
      }
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /*
   * A parent has to be a real group on the same status page, and the move must
   * not build a loop (A under B under A) or nest deeper than the tree utils
   * are willing to walk. A loop would make every rolled up number on the page
   * meaningless and the group itself unreachable in the rendered tree.
   */
  private async assertParentIsValid(data: {
    statusPageGroupId: ObjectID | null;
    parentStatusPageGroupId: ObjectID;
    statusPageId: ObjectID;
  }): Promise<void> {
    if (
      data.statusPageGroupId &&
      data.statusPageGroupId.toString() ===
        data.parentStatusPageGroupId.toString()
    ) {
      throw new BadDataException("A group cannot be its own parent group.");
    }

    const parent: Model | null = await this.findOneById({
      id: data.parentStatusPageGroupId,
      select: {
        _id: true,
        statusPageId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!parent) {
      throw new BadDataException("Parent group not found.");
    }

    if (parent.statusPageId?.toString() !== data.statusPageId.toString()) {
      throw new BadDataException(
        "Parent group must belong to the same status page.",
      );
    }

    const groupsOnStatusPage: Array<Model> = await this.findBy({
      query: {
        statusPageId: data.statusPageId,
      },
      select: {
        _id: true,
        parentStatusPageGroupId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const ancestorsOfParent: Array<Model> =
      StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: parent,
        statusPageGroups: groupsOnStatusPage,
      });

    if (
      data.statusPageGroupId &&
      ancestorsOfParent.some((ancestor: Model) => {
        return ancestor._id?.toString() === data.statusPageGroupId!.toString();
      })
    ) {
      throw new BadDataException(
        "This group cannot be nested under one of its own sub groups.",
      );
    }

    /*
     * Depth of the parent chain, plus the group being placed. A group that is
     * moved carries its own subtree along, so the deepest descendant has to
     * fit under the limit too.
     */
    const depthOfNewParent: number = ancestorsOfParent.length + 1;

    let deepestDescendantOffset: number = 0;

    if (data.statusPageGroupId) {
      const group: Model | undefined = groupsOnStatusPage.find(
        (item: Model) => {
          return item._id?.toString() === data.statusPageGroupId!.toString();
        },
      );

      if (group) {
        for (const descendant of StatusPageGroupTreeUtil.getDescendantGroups({
          statusPageGroup: group,
          statusPageGroups: groupsOnStatusPage,
        })) {
          const relativeDepth: number =
            StatusPageGroupTreeUtil.getDepth({
              statusPageGroup: descendant,
              statusPageGroups: groupsOnStatusPage,
            }) -
            StatusPageGroupTreeUtil.getDepth({
              statusPageGroup: group,
              statusPageGroups: groupsOnStatusPage,
            });

          deepestDescendantOffset = Math.max(
            deepestDescendantOffset,
            relativeDepth,
          );
        }
      }
    }

    if (
      depthOfNewParent + deepestDescendantOffset >=
      StatusPageGroupTreeUtil.MaxNestingDepth
    ) {
      throw new BadDataException(
        `Status page groups can only be nested ${StatusPageGroupTreeUtil.MaxNestingDepth} levels deep.`,
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * The new parent, under either of its names. Detaching a group (parent
     * set to null) has no parent to validate.
     */
    const newParentId: ObjectID | null = RelationIdUtil.readConsistent(
      updateBy.data as unknown as Record<string, unknown>,
      PARENT_GROUP_KEYS,
      "Parent Group",
    );

    if (newParentId) {
      const groupsBeingUpdated: Array<Model> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          statusPageId: true,
        });

      for (const group of groupsBeingUpdated) {
        if (!group.id || !group.statusPageId) {
          continue;
        }

        await this.assertParentIsValid({
          statusPageGroupId: group.id,
          parentStatusPageGroupId: newParentId,
          statusPageId: group.statusPageId,
        });
      }
    }

    /*
     * A group given another number takes it, and no other group moves
     * (ContiguousOrder): Terraform numbers a page's groups one write each,
     * all at once. Moving a group past others is moveInList.
     */
    return { updateBy, carryForward: null };
  }
}
export default new Service();
