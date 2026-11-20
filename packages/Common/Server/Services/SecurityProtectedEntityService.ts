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
  normalizeProtectedAddressValue,
  normalizeProtectedEntityValue,
} from "../../Types/SecurityPlaybook/SecurityProtectedEntity";

/*
 * The project's protected users, hosts and addresses. A row is a user or a
 * host and a value (or `*` pattern) for it, or an address or a range of
 * addresses, held to those, trimmed - an address written the one way blocks
 * are - and listed once: the same value twice for the same kind is refused,
 * whatever its case.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  private static readType(value: unknown): SecurityEntityType {
    if (!isProtectedEntityType(value)) {
      throw new BadDataException(
        "Choose what to protect: a User, a Host or an IP Address. Containment acts on nothing else.",
      );
    }

    return value;
  }

  private static readValue(
    value: unknown,
    entityType: SecurityEntityType,
  ): string {
    const text: string = normalizeProtectedEntityValue(value);

    if (entityType === SecurityEntityType.IpAddress) {
      const address: string | null = normalizeProtectedAddressValue(text);

      if (!address) {
        throw new BadDataException(
          "Enter an IPv4 or IPv6 address to protect, such as 203.0.113.7, or a range written as an address and a length, such as 203.0.113.0/24.",
        );
      }

      return address;
    }

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
    createBy.data.value = Service.readValue(
      createBy.data.value,
      createBy.data.entityType,
    );

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

    if (entityType) {
      data["entityType"] = entityType;
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

    /*
     * The value is read as the kind the row ends up: an address entry's
     * value is an address or a range, and a row turned into one keeps a
     * value only if it reads as one. Every row of one write gets the same
     * value, so it is read once, as the first row's kind.
     */
    let value: string | undefined = undefined;

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      const rowType: SecurityEntityType =
        entityType || Service.readType(row.entityType);

      const rowValue: string = Service.readValue(
        data["value"] === undefined ? row.value : data["value"],
        rowType,
      );

      if (data["value"] !== undefined && value === undefined) {
        value = rowValue;
        data["value"] = rowValue;
      }

      await this.assertNotListed({
        projectId: row.projectId,
        entityType: rowType,
        value: rowValue,
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
