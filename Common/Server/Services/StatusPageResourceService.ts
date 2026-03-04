import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/StatusPageResource";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async findByMonitors(data: {
    monitors?: Array<Monitor>;
    monitorIds?: Array<ObjectID>;
    select: Select<Model>;
  }): Promise<Array<Model>> {
    let resolvedMonitorIds: Array<ObjectID>;

    if (data.monitorIds && data.monitorIds.length > 0) {
      resolvedMonitorIds = data.monitorIds;
    } else if (data.monitors && data.monitors.length > 0) {
      resolvedMonitorIds = data.monitors
        .filter((m: Monitor) => {
          return m._id;
        })
        .map((m: Monitor) => {
          return new ObjectID(m._id!);
        });
    } else {
      return [];
    }

    if (resolvedMonitorIds.length === 0) {
      return [];
    }

    // Find status page resources directly linked to monitors
    const statusPageResources: Array<Model> = await this.findBy({
      query: {
        monitorId: QueryHelper.any(resolvedMonitorIds),
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: data.select,
    });

    // Find monitor groups that contain the affected monitors
    const monitorGroupResources: Array<MonitorGroupResource> =
      await MonitorGroupResourceService.findBy({
        query: {
          monitorId: QueryHelper.any(resolvedMonitorIds),
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
        select: {
          monitorGroupId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

    const monitorGroupIds: Array<ObjectID> = monitorGroupResources
      .map((r: MonitorGroupResource) => {
        return r.monitorGroupId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id);
      });

    if (monitorGroupIds.length > 0) {
      const groupStatusPageResources: Array<Model> = await this.findBy({
        query: {
          monitorGroupId: QueryHelper.any(monitorGroupIds),
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: data.select,
      });

      // Merge and deduplicate
      for (const resource of groupStatusPageResources) {
        const alreadyExists: boolean = statusPageResources.some((r: Model) => {
          return r._id === resource._id;
        });
        if (!alreadyExists) {
          statusPageResources.push(resource);
        }
      }
    }

    return statusPageResources;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.statusPageId) {
      throw new BadDataException(
        "Status Page Resource statusPageId is required",
      );
    }

    if (!createBy.data.order) {
      const query: Query<Model> = {
        statusPageId: createBy.data.statusPageId,
        statusPageGroupId:
          createBy.data.statusPageGroupId || QueryHelper.isNull(),
      };

      if (createBy.data.statusPageGroupId) {
        (query as any)["statusPageGroupId"] = createBy.data.statusPageGroupId;
      } else {
        (query as any)["statusPageGroupId"] = QueryHelper.isNull();
      }

      const count: PositiveNumber = await this.countBy({
        query: query,
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.statusPageId,
      createBy.data.statusPageGroupId || null,
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
        "_id should be present when deleting status page resource. Please try the delete with objectId",
      );
    }

    let resource: Model | null = null;

    if (!deleteBy.props.isRoot) {
      resource = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          statusPageGroupId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: resource,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const resource: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && resource) {
      if (resource && resource.order && resource.statusPageId) {
        await this.rearrangeOrder(
          resource.order,
          resource.statusPageId,
          resource.statusPageGroupId || null,
          false,
        );
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.order && !updateBy.props.isRoot && updateBy.query._id) {
      const resource: Model | null = await this.findOneBy({
        query: {
          _id: updateBy.query._id!,
        },
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          statusPageGroupId: true,
          _id: true,
        },
      });

      const currentOrder: number = resource?.order as number;
      const newOrder: number = updateBy.data.order as number;

      const resources: Array<Model> = await this.findBy({
        query: {
          statusPageId: resource?.statusPageId as ObjectID,
          statusPageGroupId:
            resource?.statusPageGroupId || QueryHelper.isNull(),
        },

        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          statusPageGroupId: true,
          _id: true,
        },
      });

      if (currentOrder > newOrder) {
        // moving up.

        for (const resource of resources) {
          if (resource.order! >= newOrder && resource.order! < currentOrder) {
            // increment order.
            await this.updateOneBy({
              query: {
                _id: resource._id!,
              },
              data: {
                order: resource.order! + 1,
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

        for (const resource of resources) {
          if (resource.order! <= newOrder) {
            // increment order.
            await this.updateOneBy({
              query: {
                _id: resource._id!,
              },
              data: {
                order: resource.order! - 1,
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
    statusPageGroupId: ObjectID | null,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get status page resource with this order.
    const resources: Array<Model> = await this.findBy({
      query: {
        order: QueryHelper.greaterThanEqualTo(currentOrder),
        statusPageId: statusPageId,
        statusPageGroupId: statusPageGroupId
          ? statusPageGroupId
          : QueryHelper.isNull(),
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

    for (const resource of resources) {
      if (increaseOrder) {
        newOrder = resource.order! + 1;
      } else {
        newOrder = resource.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: resource._id!,
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
