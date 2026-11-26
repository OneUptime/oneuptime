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
  PROTECTED_DOMAIN_PROBLEM,
  PROTECTED_ENTITY_VALUE_MAX_LENGTH,
  PROTECTED_FILE_HASH_PROBLEM,
  ProtectedEntityRule,
  isProtectedEntityType,
  normalizeProtectedAddressValue,
  normalizeProtectedDomainValue,
  normalizeProtectedEntityValue,
  normalizeProtectedFileHashValue,
} from "../../Types/SecurityPlaybook/SecurityProtectedEntity";

/*
 * The project's protected users, hosts, addresses, domains and files. A row
 * is a user or a host and a value (or `*` pattern) for it, an address or a
 * range of addresses, a domain (or `*.` and one), or a file's hash, held to
 * those, trimmed - an address, a domain and a hash written the one way
 * blocks are - and listed once: the same value twice for the same kind is
 * refused, whatever its case.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  private static readType(value: unknown): SecurityEntityType {
    if (!isProtectedEntityType(value)) {
      throw new BadDataException(
        "Choose what to protect: a User, a Host, an IP Address, a Domain or a File Hash. Containment acts on nothing else.",
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

    // A domain written as blocks are, or *. and one for every name under it (#10346).
    if (entityType === SecurityEntityType.Domain) {
      const domain: string | null = normalizeProtectedDomainValue(text);

      if (!domain) {
        throw new BadDataException(PROTECTED_DOMAIN_PROBLEM);
      }

      return domain;
    }

    // A file by its MD5, SHA-1 or SHA-256 hash, in lower-case hex (#10346).
    if (entityType === SecurityEntityType.FileHash) {
      const hash: string | null = normalizeProtectedFileHashValue(text);

      if (!hash) {
        throw new BadDataException(PROTECTED_FILE_HASH_PROBLEM);
      }

      return hash;
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
     * The value is read as the kind each row ends up: an address entry's
     * value is an address or a range, written the one way, and a row turned
     * into one keeps a value only if it reads as one. One write gives every
     * row it changes the same value, so it must read the same as each row's
     * kind - and no two rows of one kind may get it, as a value is listed
     * once. A write that changes the kind and not the value writes a row's
     * value again where the new kind spells it another way, one row at a
     * time.
     */
    const written: Array<{
      row: Model;
      entityType: SecurityEntityType;
      value: string;
    }> = rows
      .filter((row: Model): boolean => {
        return Boolean(row.projectId);
      })
      .map((row: Model) => {
        const rowType: SecurityEntityType =
          entityType || Service.readType(row.entityType);

        return {
          row,
          entityType: rowType,
          value: Service.readValue(
            data["value"] === undefined ? row.value : data["value"],
            rowType,
          ),
        };
      });

    if (data["value"] !== undefined && written.length > 0) {
      const values: Set<string> = new Set(
        written.map((entry: { value: string }): string => {
          return entry.value;
        }),
      );

      if (values.size > 1) {
        throw new BadDataException(
          "Change the value of one protected entity at a time: it reads differently as a user, a host and an IP address.",
        );
      }

      const kinds: Set<SecurityEntityType> = new Set(
        written.map((entry: { entityType: SecurityEntityType }) => {
          return entry.entityType;
        }),
      );

      if (kinds.size < written.length) {
        throw new BadDataException(
          `${written[0]!.entityType} "${written[0]!.value}" can be protected only once. Change one protected entity's value at a time.`,
        );
      }

      data["value"] = written[0]!.value;
    }

    if (data["value"] === undefined) {
      const respelled: Array<{ row: Model; value: string }> = written.filter(
        (entry: { row: Model; value: string }): boolean => {
          return entry.value !== entry.row.value;
        },
      );

      // The value written goes to every row of the write: only one row's may be spelled again.
      if (respelled.length > 0 && written.length > 1) {
        throw new BadDataException(
          "Change the kind of one protected entity at a time.",
        );
      }

      if (respelled.length === 1) {
        data["value"] = respelled[0]!.value;
      }
    }

    for (const entry of written) {
      await this.assertNotListed({
        projectId: entry.row.projectId!,
        entityType: entry.entityType,
        value: entry.value,
        exceptId: entry.row.id || undefined,
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
