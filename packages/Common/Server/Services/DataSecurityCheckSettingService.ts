import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataSecurityCheckSetting";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { queueDataSecurityEvaluation } from "../Utils/DataSecurity/DataSecurityJobs";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SecuritySeverity from "../../Types/SecuritySeverity";
import { getDataSecurityCheck } from "../../Types/DataSecurity/DataSecurityCheckCatalog";

/*
 * A project's change to a built-in check: off, or another severity. The
 * check must be one the catalog has, and the severity one Security
 * Operations uses. Either changes which issues are open, so making,
 * changing or removing one - putting the check back as it ships - queues
 * the project's evaluation.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static readSeverity(value: unknown): SecuritySeverity | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (
      !(Object.values(SecuritySeverity) as Array<unknown>).includes(value)
    ) {
      throw new BadDataException(
        "Choose a severity: Critical, High, Medium or Low.",
      );
    }

    return value as SecuritySeverity;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.checkId || !getDataSecurityCheck(createBy.data.checkId)) {
      throw new BadDataException("Choose one of Data Security's checks.");
    }

    const severity: SecuritySeverity | null = Service.readSeverity(
      createBy.data.severityOverride,
    );

    if (severity) {
      createBy.data.severityOverride = severity;
    }

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId) {
      await queueDataSecurityEvaluation(createdItem.projectId);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (data["severityOverride"] !== undefined) {
      data["severityOverride"] = Service.readSeverity(data["severityOverride"]);
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, projectId: true },
    );

    return { updateBy, carryForward: Service.projectIdsOf(rows) };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await Service.queueEvaluations(onUpdate.carryForward);

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The rows are gone by onDeleteSuccess: whose they were is read here.
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      { _id: true, projectId: true },
    );

    return { deleteBy, carryForward: Service.projectIdsOf(rows) };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    await Service.queueEvaluations(onDelete.carryForward);

    return onDelete;
  }

  private static projectIdsOf(rows: Array<Model>): Array<ObjectID> {
    return rows
      .map((row: Model): ObjectID | undefined => {
        return row.projectId;
      })
      .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
        return Boolean(projectId);
      });
  }

  // One evaluation per project the rows were in.
  private static async queueEvaluations(projectIds: unknown): Promise<void> {
    const seen: Set<string> = new Set();

    for (const projectId of (projectIds as Array<ObjectID> | undefined) ||
      []) {
      if (!seen.has(projectId.toString())) {
        seen.add(projectId.toString());
        await queueDataSecurityEvaluation(projectId);
      }
    }
  }
}

export default new Service();
