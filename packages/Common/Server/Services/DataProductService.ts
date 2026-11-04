import ProjectReferencesService from "./ProjectReferencesService";
import MonitorService from "./MonitorService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import Model from "../../Models/DatabaseModels/DataProduct";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import {
  DEFAULT_SLA_TARGET_PERCENTAGE,
  formatTimeOfDay,
  getDataProductSlaError,
  parseTimeOfDay,
} from "../../Types/DataObservability/DataProductFreshness";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * Data products: named groups of watched tables with a freshness SLA. The
 * SLA is checked as it is saved - a time of day, a maximum age, or both -
 * and a time is kept as HH:MM. The badge's secret is made with the
 * product. Its monitor and SLO are made and kept by DataProductSync, as the
 * person who saved it, and deleted with it.
 */

// The fields of a product that make up its SLA.
const SLA_FIELDS: ReadonlyArray<string> = [
  "freshByTimeOfDay",
  "maxDataAgeInMinutes",
  "slaTargetPercentage",
];

function normalizeTimeOfDay(data: JSONObject): void {
  const minuteOfDay: number | null = parseTimeOfDay(data["freshByTimeOfDay"]);

  if (minuteOfDay !== null) {
    data["freshByTimeOfDay"] = formatTimeOfDay(minuteOfDay);
  } else if (
    typeof data["freshByTimeOfDay"] === "string" &&
    data["freshByTimeOfDay"].trim() === ""
  ) {
    data["freshByTimeOfDay"] = null;
  }
}

interface DeletedProducts {
  products: Array<Model>;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const error: string | null = getDataProductSlaError({
      freshByTimeOfDay: createBy.data.freshByTimeOfDay,
      maxDataAgeInMinutes: createBy.data.maxDataAgeInMinutes,
      slaTargetPercentage: createBy.data.slaTargetPercentage,
    });

    if (error) {
      throw new BadDataException(error);
    }

    normalizeTimeOfDay(createBy.data as unknown as JSONObject);

    if (
      createBy.data.slaTargetPercentage === undefined ||
      createBy.data.slaTargetPercentage === null
    ) {
      createBy.data.slaTargetPercentage = DEFAULT_SLA_TARGET_PERCENTAGE;
    }

    createBy.data.badgeToken = ObjectID.generate().toString();

    return { createBy, carryForward: undefined };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;
    const changesSla: boolean = SLA_FIELDS.some((field: string) => {
      return data[field] !== undefined;
    });

    if (!changesSla) {
      return { updateBy, carryForward: undefined };
    }

    /*
     * Every product the update writes, and the update held to them: each
     * one's SLA is checked as it will be saved - however many - and never a
     * product its caller may not write.
     */
    const products: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        freshByTimeOfDay: true,
        maxDataAgeInMinutes: true,
        slaTargetPercentage: true,
      },
    );

    for (const product of products) {
      const error: string | null = getDataProductSlaError({
        freshByTimeOfDay:
          data["freshByTimeOfDay"] !== undefined
            ? data["freshByTimeOfDay"]
            : product.freshByTimeOfDay,
        maxDataAgeInMinutes:
          data["maxDataAgeInMinutes"] !== undefined
            ? data["maxDataAgeInMinutes"]
            : product.maxDataAgeInMinutes,
        slaTargetPercentage:
          data["slaTargetPercentage"] !== undefined
            ? data["slaTargetPercentage"]
            : product.slaTargetPercentage,
      });

      if (error) {
        throw new BadDataException(error);
      }
    }

    normalizeTimeOfDay(data);

    return { updateBy, carryForward: undefined };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const products: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        monitorId: true,
        serviceLevelObjectiveId: true,
      },
    );
    const carryForward: DeletedProducts = { products };

    return { deleteBy, carryForward };
  }

  // A deleted product's monitor and SLO go with it: nobody's are left over.
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carried: DeletedProducts | undefined = onDelete.carryForward as
      | DeletedProducts
      | undefined;

    if (!carried) {
      return onDelete;
    }

    for (const product of Service.getRowsDeleted<Model>({
      rows: carried.products,
      deletedIds,
    })) {
      try {
        if (product.serviceLevelObjectiveId) {
          await ServiceLevelObjectiveService.deleteBy({
            query: {
              _id: product.serviceLevelObjectiveId,
              projectId: product.projectId!,
            },
            limit: 1,
            skip: 0,
            props: { isRoot: true },
          });
        }

        if (product.monitorId) {
          await MonitorService.deleteBy({
            query: { _id: product.monitorId, projectId: product.projectId! },
            limit: 1,
            skip: 0,
            props: { isRoot: true },
          });
        }
      } catch (error) {
        logger.error(
          `Data Observability: could not delete the monitor and SLO of data product ${product.id?.toString()}`,
        );
        logger.error(error);
      }
    }

    return onDelete;
  }
}

export default new Service();
