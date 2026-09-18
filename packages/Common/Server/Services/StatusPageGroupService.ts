import CreateBy from "../Types/Database/CreateBy";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import StatusPageGroupTreeUtil from "../../Utils/StatusPage/GroupTree";
import Model from "../../Models/DatabaseModels/StatusPageGroup";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.statusPageId) {
      throw new BadDataException("Status Page Group statusPageId is required");
    }

    if (createBy.data.parentStatusPageGroupId) {
      await this.assertParentIsValid({
        statusPageGroupId: null,
        parentStatusPageGroupId: createBy.data.parentStatusPageGroupId,
        statusPageId: createBy.data.statusPageId,
      });
    }

    if (!createBy.data.order) {
      const count: PositiveNumber = await this.countBy({
        query: {
          statusPageId: createBy.data.statusPageId,
        },
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.statusPageId,
      true,
    );

    return {
      createBy: createBy,
      carryForward: null,
    };
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
        },
      });
    }

    return {
      deleteBy,
      carryForward: group,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const group: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && group) {
      if (group && group.order && group.statusPageId) {
        await this.rearrangeOrder(group.order, group.statusPageId, false);
      }
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
    const newParentIdValue: unknown = (updateBy.data as any)[
      "parentStatusPageGroupId"
    ];

    // detaching a group (parent set to null) has no parent to validate.
    if (newParentIdValue) {
      const newParentId: ObjectID = new ObjectID(newParentIdValue.toString());

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
          _id: true,
        },
      });

      const currentOrder: number = group?.order as number;
      const newOrder: number = updateBy.data.order as number;

      const groups: Array<Model> = await this.findBy({
        query: {
          statusPageId: group?.statusPageId as ObjectID,
        },

        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          _id: true,
        },
      });

      if (currentOrder > newOrder) {
        // moving up.

        for (const group of groups) {
          if (group.order! >= newOrder && group.order! < currentOrder) {
            // increment order.
            await this.updateOneBy({
              query: {
                _id: group._id!,
              },
              data: {
                order: group.order! + 1,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }

      if (newOrder > currentOrder) {
        // moving down.

        for (const group of groups) {
          if (group.order! <= newOrder) {
            // increment order.
            await this.updateOneBy({
              query: {
                _id: group._id!,
              },
              data: {
                order: group.order! - 1,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    statusPageId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get status page group with this order.
    const groups: Array<Model> = await this.findBy({
      query: {
        order: QueryHelper.greaterThanEqualTo(currentOrder),
        statusPageId: statusPageId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    });

    let newOrder: number = currentOrder;

    for (const group of groups) {
      if (increaseOrder) {
        newOrder = group.order! + 1;
      } else {
        newOrder = group.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: group._id!,
        },
        data: {
          order: newOrder,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }
}
export default new Service();
