import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityProtectedEntity";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SecurityEntityType } from "../../Types/SecurityCase/SecurityEntity";
import {
  PROTECTED_ENTITY_VALUE_MAX_LENGTH,
  ProtectedEntityRule,
  isProtectedEntityType,
  normalizeProtectedEntityValue,
} from "../../Types/SecurityPlaybook/SecurityProtectedEntity";

/*
 * The project's protected users and hosts. A row is a user or a host and a
 * value (or `*` pattern) for it, held to those, trimmed, and listed once:
 * the same value twice for the same kind is refused, whatever its case.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  private static readType(value: unknown): SecurityEntityType {
    if (!isProtectedEntityType(value)) {
      throw new BadDataException(
        "Choose what to protect: a User or a Host. Containment acts on nothing else.",
      );
    }

    return value;
  }

  private static readValue(value: unknown): string {
    const text: string = normalizeProtectedEntityValue(value);

    if (!text) {
      throw new BadDataException(
        "Enter the user's sign-in name or the host's name to protect.",
      );
    }

    if (text.length > PROTECTED_ENTITY_VALUE_MAX_LENGTH) {
      throw new BadDataException(
        `A protected value is at most ${PROTECTED_ENTITY_VALUE_MAX_LENGTH} characters.`,
      );
    }

    return text;
  }

  private async assertNotListed(data: {
    projectId: ObjectID;
    entityType: SecurityEntityType;
    value: string;
    exceptId?: ObjectID | undefined;
  }): Promise<void> {
    const rules: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        entityType: data.entityType,
      },
      select: {
        _id: true,
        value: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const wanted: string = data.value.toLowerCase();

    const isListed: boolean = rules.some((rule: Model): boolean => {
      return (
        (rule.value || "").toLowerCase() === wanted &&
        rule.id?.toString() !== data.exceptId?.toString()
      );
    });

    if (isListed) {
      throw new BadDataException(
        `${data.entityType} "${data.value}" is already protected.`,
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.projectId) {
      throw new BadDataException("A protected entity needs a project.");
    }

    createBy.data.entityType = Service.readType(createBy.data.entityType);
    createBy.data.value = Service.readValue(createBy.data.value);

    await this.assertNotListed({
      projectId: createBy.data.projectId,
      entityType: createBy.data.entityType,
      value: createBy.data.value,
    });

    return { createBy: createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["entityType"] === undefined && data["value"] === undefined) {
      return { updateBy: updateBy, carryForward: null };
    }

    const entityType: SecurityEntityType | undefined =
      data["entityType"] === undefined
        ? undefined
        : Service.readType(data["entityType"]);
    const value: string | undefined =
      data["value"] === undefined
        ? undefined
        : Service.readValue(data["value"]);

    if (entityType) {
      data["entityType"] = entityType;
    }

    if (value) {
      data["value"] = value;
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

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      await this.assertNotListed({
        projectId: row.projectId,
        entityType: entityType || Service.readType(row.entityType),
        value: value || Service.readValue(row.value),
        exceptId: row.id || undefined,
      });
    }

    return { updateBy: updateBy, carryForward: null };
  }

  // The project's protected entries of a kind, as the target rule reads them.
  @CaptureSpan()
  public async getRules(data: {
    projectId: ObjectID;
    entityType: SecurityEntityType;
  }): Promise<Array<ProtectedEntityRule>> {
    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        entityType: data.entityType,
      },
      select: {
        entityType: true,
        value: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return rows
      .filter((row: Model): boolean => {
        return Boolean(row.value) && isProtectedEntityType(row.entityType);
      })
      .map((row: Model): ProtectedEntityRule => {
        return {
          type: row.entityType as SecurityEntityType,
          value: row.value as string,
        };
      });
  }
}

export default new Service();
