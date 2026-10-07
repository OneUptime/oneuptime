import CreateBy from "../Types/Database/CreateBy";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferencesService from "./ProjectReferencesService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ContiguousOrder from "../Utils/Database/ContiguousOrder";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
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
 * A group moved to another place by a non-root update: where it was, where it
 * goes, and its status page. Read before the update (onBeforeUpdate) and acted
 * on after it (onUpdateSuccess), only if the update wrote that group.
 */
interface GroupMove {
  groupId: ObjectID;
  previousOrder: number;
  newOrder: number;
  statusPageId: ObjectID;
  projectId: ObjectID;
}

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

    if (!createBy.data.order) {
      const count: PositiveNumber = await this.countBy({
        query: {
          statusPageId: statusPageId,
        },
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  /*
   * The groups at the new group's place and after it move one place down -
   * now that it exists, so a create that is refused or fails leaves the
   * status page's order as it was.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (
      createdItem.id &&
      createdItem.order &&
      createdItem.statusPageId &&
      createdItem.projectId
    ) {
      await ContiguousOrder.afterCreate({
        service: this,
        list: {
          statusPageId: createdItem.statusPageId,
          projectId: createdItem.projectId,
        },
        createdItemId: createdItem.id,
        order: createdItem.order,
      });
    }

    return createdItem;
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

    let group: Model | null = null;

    if (!deleteBy.props.isRoot) {
      group = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          projectId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: group,
    };
  }

  /*
   * The groups after a deleted one close its gap - only when the group was
   * actually deleted, within its own status page and project.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const group: Model | null = onDelete.carryForward;

    if (
      !deleteBy.props.isRoot &&
      group &&
      group.id &&
      group.order &&
      group.statusPageId &&
      group.projectId &&
      itemIdsBeforeDelete.some((id: ObjectID): boolean => {
        return id.toString() === group.id!.toString();
      })
    ) {
      await ContiguousOrder.afterDelete({
        service: this,
        list: {
          statusPageId: group.statusPageId,
          projectId: group.projectId,
        },
        order: group.order,
      });
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  /*
   * The hierarchy hooks run BEFORE DatabaseService applies tenant scoping to
   * the caller's query, so reading the raw client query with props.isRoot
   * would hand the hook rows from other projects. Re-apply the caller's tenant
   * so validation can never look at a row outside the caller's project.
   */
  private scopeQueryToCallerTenant(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
  ): Query<Model> {
    if (props.isRoot || !props.tenantId) {
      return query;
    }

    return {
      ...query,
      projectId: props.tenantId,
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
      const groupsBeingUpdated: Array<Model> = await this.findBy({
        query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
        select: {
          _id: true,
          statusPageId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
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
     * A group moved to another place: where it is now is read here, and the
     * groups it passes step aside once the update has moved it - only the
     * groups strictly between its old and new place. Nothing is written
     * before the update.
     */
    let move: GroupMove | null = null;

    if (updateBy.data.order && !updateBy.props.isRoot && updateBy.query._id) {
      const group: Model | null = await this.findOneBy({
        query: {
          _id: updateBy.query._id!,
        },
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          projectId: true,
          _id: true,
        },
      });

      if (
        group &&
        group.id &&
        group.order &&
        group.statusPageId &&
        group.projectId
      ) {
        move = {
          groupId: group.id,
          previousOrder: group.order,
          newOrder: updateBy.data.order as number,
          statusPageId: group.statusPageId,
          projectId: group.projectId,
        };
      }
    }

    return { updateBy, carryForward: move };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const move: GroupMove | null = (onUpdate.carryForward as GroupMove) || null;

    if (
      move &&
      updatedItemIds.some((id: ObjectID): boolean => {
        return id.toString() === move.groupId.toString();
      })
    ) {
      await ContiguousOrder.afterMove({
        service: this,
        list: {
          statusPageId: move.statusPageId,
          projectId: move.projectId,
        },
        movedItemId: move.groupId,
        previousOrder: move.previousOrder,
        newOrder: move.newOrder,
      });
    }

    return onUpdate;
  }
}
export default new Service();
