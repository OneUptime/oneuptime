import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityEntityCriticality";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { queueSecurityEntityRiskRecompute } from "../Utils/SecurityEvent/EntityRisk/SecurityEntityRiskJobs";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SecurityEntityType } from "../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_ENTITY_CRITICALITY_VALUE_MAX_LENGTH,
  SecurityEntityCriticality,
} from "../../Types/SecurityCase/SecurityEntityRisk";
import { normalizeProtectedEntityValue } from "../../Types/SecurityPlaybook/SecurityProtectedEntity";
import {
  SecurityEntityCriticalityRule,
  isRiskEntityType,
  isSecurityEntityCriticality,
} from "../../Utils/SecurityCase/SecurityEntityRiskScore";

/*
 * The project's Entity Criticality list: how much each user, host and
 * address matters. An entry is a value or a `*` pattern, for one kind of
 * entity or any, with its criticality; the same value for the same kind is
 * listed once, whatever its case. A change weighs the project's entity risk
 * anew, in the background.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static readValue(value: unknown): string {
    const text: string = normalizeProtectedEntityValue(value);

    if (!text) {
      throw new BadDataException(
        "Enter the user's sign-in name, the host's name or the address the entry is for.",
      );
    }

    if (text.length > SECURITY_ENTITY_CRITICALITY_VALUE_MAX_LENGTH) {
      throw new BadDataException(
        `An entry's value is at most ${SECURITY_ENTITY_CRITICALITY_VALUE_MAX_LENGTH} characters.`,
      );
    }

    return text;
  }

  // The kind the entry is for: one that carries risk, or any (null).
  public static readType(value: unknown): SecurityEntityType | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (!isRiskEntityType(value)) {
      throw new BadDataException(
        "An entry is for a User, a Host or an IP Address, or for any of them.",
      );
    }

    return value;
  }

  public static readCriticality(value: unknown): SecurityEntityCriticality {
    if (!isSecurityEntityCriticality(value)) {
      throw new BadDataException(
        "Choose how much it matters: Low, High or Extreme.",
      );
    }

    return value;
  }

  private async assertNotListed(data: {
    projectId: ObjectID;
    entityType: SecurityEntityType | null;
    value: string;
    exceptId?: ObjectID | undefined;
  }): Promise<void> {
    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        _id: true,
        value: true,
        entityType: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const wanted: string = data.value.toLowerCase();

    const isListed: boolean = rows.some((row: Model): boolean => {
      return (
        (row.value || "").toLowerCase() === wanted &&
        (row.entityType || null) === data.entityType &&
        row.id?.toString() !== data.exceptId?.toString()
      );
    });

    if (isListed) {
      throw new BadDataException(`"${data.value}" is already in the list.`);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.projectId) {
      throw new BadDataException("An entity criticality needs a project.");
    }

    createBy.data.value = Service.readValue(createBy.data.value);

    const entityType: SecurityEntityType | null = Service.readType(
      createBy.data.entityType,
    );

    (createBy.data as unknown as JSONObject)["entityType"] = entityType;
    createBy.data.criticality = Service.readCriticality(
      createBy.data.criticality,
    );

    await this.assertNotListed({
      projectId: createBy.data.projectId,
      entityType,
      value: createBy.data.value,
    });

    return { createBy: createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId) {
      await queueSecurityEntityRiskRecompute(createdItem.projectId);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    const value: string | undefined =
      data["value"] === undefined
        ? undefined
        : Service.readValue(data["value"]);
    const hasType: boolean = data["entityType"] !== undefined;
    const entityType: SecurityEntityType | null = hasType
      ? Service.readType(data["entityType"])
      : null;

    if (value !== undefined) {
      data["value"] = value;
    }

    if (hasType) {
      data["entityType"] = entityType;
    }

    if (data["criticality"] !== undefined) {
      data["criticality"] = Service.readCriticality(data["criticality"]);
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        entityType: true,
        value: true,
      },
    );

    const projectIds: Array<ObjectID> = [];

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      projectIds.push(row.projectId);

      if (value !== undefined || hasType) {
        await this.assertNotListed({
          projectId: row.projectId,
          entityType: hasType ? entityType : row.entityType || null,
          value: value !== undefined ? value : Service.readValue(row.value),
          exceptId: row.id || undefined,
        });
      }
    }

    return { updateBy: updateBy, carryForward: projectIds };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await this.recomputeProjects(onUpdate.carryForward);

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
      },
    );

    return {
      deleteBy,
      carryForward: rows
        .map((row: Model): ObjectID | undefined => {
          return row.projectId;
        })
        .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
          return Boolean(projectId);
        }),
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    await this.recomputeProjects(onDelete.carryForward);

    return onDelete;
  }

  private async recomputeProjects(projectIds: unknown): Promise<void> {
    if (!Array.isArray(projectIds)) {
      return;
    }

    const seen: Set<string> = new Set();

    for (const projectId of projectIds) {
      if (!(projectId instanceof ObjectID) || seen.has(projectId.toString())) {
        continue;
      }

      seen.add(projectId.toString());
      await queueSecurityEntityRiskRecompute(projectId);
    }
  }

  // The project's list, as the risk score reads it.
  @CaptureSpan()
  public async getRules(
    projectId: ObjectID,
  ): Promise<Array<SecurityEntityCriticalityRule>> {
    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        value: true,
        entityType: true,
        criticality: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return rows
      .filter((row: Model): boolean => {
        /*
         * An entry for a kind that carries no risk (written by hand, past
         * the checks above) names nobody, rather than everybody.
         */
        return (
          Boolean(row.value) &&
          isSecurityEntityCriticality(row.criticality) &&
          (!row.entityType || isRiskEntityType(row.entityType))
        );
      })
      .map((row: Model): SecurityEntityCriticalityRule => {
        return {
          value: row.value as string,
          entityType: isRiskEntityType(row.entityType) ? row.entityType : null,
          criticality: row.criticality as SecurityEntityCriticality,
        };
      });
  }
}

export default new Service();
