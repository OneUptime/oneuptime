import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ThreatIntelFeed";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import {
  THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
} from "../../Types/SecurityEvent/ThreatIntelConstants";
import TaxiiClient from "../Utils/SecurityEvent/ThreatIntel/TaxiiClient";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Validate at save time so a feed that stores is a feed the poller can
   * use — a malformed URL or collection id surfaces to the person
   * configuring it, not as a cron-side lastError later. (The
   * GoogleSecOpsConnectionService discipline.)
   */
  private validateFeed(data: {
    apiRootUrl?: string | undefined;
    collectionId?: string | undefined;
    pollIntervalInMinutes?: number | undefined;
    minimumConfidence?: number | undefined;
  }): void {
    if (data.apiRootUrl !== undefined) {
      TaxiiClient.validateApiRootUrl(data.apiRootUrl);
    }

    if (data.collectionId !== undefined) {
      TaxiiClient.validateCollectionId(data.collectionId);
    }

    if (data.pollIntervalInMinutes !== undefined) {
      if (
        !Number.isInteger(data.pollIntervalInMinutes) ||
        data.pollIntervalInMinutes < 1 ||
        data.pollIntervalInMinutes > 1440
      ) {
        throw new BadDataException(
          "Poll interval must be a whole number of minutes between 1 and 1440.",
        );
      }
    }

    if (data.minimumConfidence !== undefined) {
      if (
        !Number.isInteger(data.minimumConfidence) ||
        data.minimumConfidence < THREAT_INTEL_MINIMUM_CONFIDENCE_MIN ||
        data.minimumConfidence > THREAT_INTEL_MINIMUM_CONFIDENCE_MAX
      ) {
        throw new BadDataException(
          `Minimum confidence must be a whole number between ${THREAT_INTEL_MINIMUM_CONFIDENCE_MIN} and ${THREAT_INTEL_MINIMUM_CONFIDENCE_MAX}.`,
        );
      }
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.apiRootUrl) {
      throw new BadDataException("TAXII API root URL is required.");
    }

    if (!createBy.data.collectionId) {
      throw new BadDataException("Collection ID is required.");
    }

    if (createBy.data.apiToken && createBy.data.basicAuthPassword) {
      throw new BadDataException(
        "Configure either an API token or basic-auth credentials, not both.",
      );
    }

    this.validateFeed({
      apiRootUrl: createBy.data.apiRootUrl,
      collectionId: createBy.data.collectionId,
      pollIntervalInMinutes: createBy.data.pollIntervalInMinutes,
      minimumConfidence: createBy.data.minimumConfidence,
    });

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    this.validateFeed({
      apiRootUrl: updateBy.data.apiRootUrl as string | undefined,
      collectionId: updateBy.data.collectionId as string | undefined,
      pollIntervalInMinutes: updateBy.data.pollIntervalInMinutes as
        | number
        | undefined,
      minimumConfidence: updateBy.data.minimumConfidence as number | undefined,
    });

    await this.validateCredentialExclusivity(updateBy);

    /*
     * Repointing a feed invalidates its poll position: the added_after
     * cursor (and any saved page token) is a position in ONE collection's
     * date_added timeline. Carrying it to a different API root or
     * collection would silently skip the new collection's entire history.
     * Flagged here, reset in onUpdateSuccess — the cursor columns have
     * update: [] access control, so writing them into updateBy.data would
     * be rejected for non-root callers; the root-props write after the
     * update bypasses the column ACL the same legitimate way the poller's
     * own bookkeeping does.
     */
    const repointed: boolean =
      updateBy.data.apiRootUrl !== undefined ||
      updateBy.data.collectionId !== undefined;

    return { updateBy, carryForward: { repointed } };
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (
      (onUpdate.carryForward as { repointed?: boolean } | null)?.repointed ===
      true
    ) {
      for (const updatedItemId of updatedItemIds) {
        /*
         * Cannot recurse: this inner update carries neither apiRootUrl
         * nor collectionId, so its own onBeforeUpdate flags nothing.
         */
        await this.updateOneById({
          id: updatedItemId,
          data: {
            cursor: null as unknown as string,
            nextPageToken: null as unknown as string,
            lastPolledAt: null as unknown as Date,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onUpdate;
  }

  /*
   * The create-time either/or rule, enforced on updates too — including
   * against what the row ALREADY stores, since the API updates secrets
   * one at a time. TaxiiClient silently prefers the token over basic
   * auth, so a row holding both would poll with whichever secret the
   * user was NOT trying to use.
   */
  private async validateCredentialExclusivity(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const settingToken: boolean = Boolean(updateBy.data.apiToken);
    const settingBasicPassword: boolean = Boolean(
      updateBy.data.basicAuthPassword,
    );

    if (settingToken && settingBasicPassword) {
      throw new BadDataException(
        "Configure either an API token or basic-auth credentials, not both.",
      );
    }

    if (!settingToken && !settingBasicPassword) {
      return;
    }

    /*
     * Setting one kind while the update leaves the other kind's stored
     * value untouched (undefined = not in the update; null = explicit
     * clear, which is fine) — check the matched rows.
     */
    const otherKindUntouched: boolean = settingToken
      ? updateBy.data.basicAuthPassword === undefined
      : updateBy.data.apiToken === undefined;

    if (!otherKindUntouched) {
      return;
    }

    const matchedFeeds: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        apiToken: true,
        basicAuthPassword: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const feed of matchedFeeds) {
      const storesOtherKind: boolean = settingToken
        ? Boolean(feed.basicAuthPassword)
        : Boolean(feed.apiToken);

      if (storesOtherKind) {
        throw new BadDataException(
          settingToken
            ? "This feed uses basic auth. Clear the basic-auth password in the same update (or use the Update Credentials action, which switches automatically) before setting an API token."
            : "This feed uses an API token. Clear the API token in the same update (or use the Update Credentials action, which switches automatically) before setting a basic-auth password.",
        );
      }
    }
  }
}

export default new Service();
