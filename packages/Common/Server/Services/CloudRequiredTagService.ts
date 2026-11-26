import Model from "../../Models/DatabaseModels/CloudRequiredTag";
import {
  CLOUD_REQUIRED_TAG_KEY_MAX_LENGTH,
  normalizeCloudTagKey,
  parseCloudTagAllowedValues,
} from "../../Types/Cloud/CloudRequiredTags";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

// The account a rule is for, under either name a write may give it.
const CLOUD_ACCOUNT_KEYS: Array<string> = ["cloudAccountId", "cloudAccount"];

/*
 * A tag every resource of a project's clouds must carry (CloudRequiredTag,
 * #11012). This guards the rule as it is written:
 *
 *   - its key, trimmed, no longer than a cloud's cost keeps a key
 *     (CLOUD_REQUIRED_TAG_KEY_MAX_LENGTH), with no line break or control
 *     character in it;
 *   - its allowed values, each trimmed and kept once whatever its case
 *     (parseCloudTagAllowedValues), so "Payments" and "payments" are one;
 *   - one rule a key and scope: the project's own, and each account's.
 *     Keys are one whatever their case, as the resources' are matched.
 */

export const CLOUD_REQUIRED_TAG_KEY_ERROR: string =
  "A required tag needs a key, such as team or cost-center, of at most 128 characters on one line.";
export const CLOUD_REQUIRED_TAG_DUPLICATE_ERROR: string =
  "This tag is already required here. Edit that one instead.";

// A line break or another control character: never in a key.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER: RegExp = /[\u0000-\u001f\u007f]/;

// A key a person may require: trimmed, one line, not too long.
export function normalizeRequiredTagKey(value: unknown): string {
  const key: string = typeof value === "string" ? value.trim() : "";

  if (
    !key ||
    key.length > CLOUD_REQUIRED_TAG_KEY_MAX_LENGTH ||
    CONTROL_CHARACTER.test(key)
  ) {
    throw new BadDataException(CLOUD_REQUIRED_TAG_KEY_ERROR);
  }

  return key;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Whether another rule of the project already requires this key in this
   * scope (one account, or every account), whatever the key's case.
   */
  private async assertKeyIsFree(data: {
    projectId: ObjectID;
    tagKey: string;
    cloudAccountId: ObjectID | null;
    exceptId?: ObjectID | undefined;
  }): Promise<void> {
    const rules: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        tagKey: QueryHelper.findWithSameText(data.tagKey),
        cloudAccountId: data.cloudAccountId
          ? data.cloudAccountId
          : QueryHelper.isNull(),
      },
      select: { _id: true },
      skip: 0,
      limit: 2,
      props: { isRoot: true },
    });

    const others: Array<Model> = rules.filter((rule: Model): boolean => {
      return !data.exceptId || rule.id?.toString() !== data.exceptId.toString();
    });

    if (others.length > 0) {
      throw new BadDataException(CLOUD_REQUIRED_TAG_DUPLICATE_ERROR);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    createBy.data.tagKey = normalizeRequiredTagKey(createBy.data.tagKey);
    createBy.data.allowedValues = parseCloudTagAllowedValues(
      createBy.data.allowedValues as unknown,
    );

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;
    // Its account under either name, kept in the id column for the check and the row.
    const cloudAccountId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createBy.data as unknown as Record<string, unknown>,
      CLOUD_ACCOUNT_KEYS,
      "Cloud Account",
    );

    if (projectId) {
      await this.assertKeyIsFree({
        projectId,
        tagKey: normalizeCloudTagKey(createBy.data.tagKey),
        cloudAccountId,
      });
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.data.allowedValues !== undefined) {
      updateBy.data.allowedValues = parseCloudTagAllowedValues(
        updateBy.data.allowedValues as unknown,
      ) as never;
    }

    const changesKey: boolean =
      updateBy.data.tagKey !== undefined && updateBy.data.tagKey !== null;
    // The account under either name a write may give it.
    const changesAccount: boolean = CLOUD_ACCOUNT_KEYS.some(
      (key: string): boolean => {
        return (
          (updateBy.data as unknown as Record<string, unknown>)[key] !==
          undefined
        );
      },
    );
    const writtenAccountId: ObjectID | null = changesAccount
      ? RelationIdUtil.readIntoIdColumn(
          updateBy.data as unknown as Record<string, unknown>,
          CLOUD_ACCOUNT_KEYS,
          "Cloud Account",
        )
      : null;

    if (changesKey) {
      updateBy.data.tagKey = normalizeRequiredTagKey(
        updateBy.data.tagKey,
      ) as never;
    }

    // A changed key or account is checked against the project's other rules.
    if (changesKey || changesAccount) {
      const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        { _id: true, projectId: true, tagKey: true, cloudAccountId: true },
      );

      for (const row of rows) {
        if (!row.projectId || !row.id) {
          continue;
        }

        const tagKey: string = changesKey
          ? (updateBy.data.tagKey as unknown as string)
          : row.tagKey || "";
        const accountValue: unknown = changesAccount
          ? writtenAccountId
          : row.cloudAccountId;
        const cloudAccountId: ObjectID | null =
          accountValue instanceof ObjectID
            ? accountValue
            : typeof accountValue === "string" && accountValue
              ? new ObjectID(accountValue)
              : null;

        await this.assertKeyIsFree({
          projectId: row.projectId,
          tagKey: normalizeCloudTagKey(tagKey),
          cloudAccountId,
          exceptId: row.id,
        });
      }
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
