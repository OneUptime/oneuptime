import ProjectReferencesService from "./ProjectReferencesService";
import SecurityEventConnectionService from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/ThreatIntelFeed";
import SecurityEventConnection from "../../Models/DatabaseModels/SecurityEventConnection";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
  THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
} from "../../Types/SecurityEvent/ThreatIntelConstants";
import ThreatIntelFeedType, {
  THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES,
  isThreatIntelFeedType,
  readThreatIntelFeedType,
} from "../../Types/SecurityEvent/ThreatIntelFeedType";
import DataSourceEgressGuard from "../Utils/DataSource/EgressGuard";
import RelationValueUtil from "../Utils/Database/RelationValueUtil";
import TaxiiClient from "../Utils/SecurityEvent/ThreatIntel/TaxiiClient";
import ThreatIntelListSource from "../Utils/SecurityEvent/ThreatIntel/ThreatIntelListSource";

/*
 * What each source needs, said in the words the feed form shows: a TAXII
 * feed reads a collection, a list feed a list's address, a Google SecOps
 * feed a connection. Fields of another source are refused rather than kept,
 * so a feed never holds a credential it does not use.
 */
const TAXII_ONLY_FIELDS: Array<{ key: keyof Model; title: string }> = [
  { key: "apiRootUrl", title: "TAXII API root URL" },
  { key: "collectionId", title: "Collection ID" },
  { key: "apiToken", title: "API token" },
  { key: "basicAuthUsername", title: "Basic auth username" },
  { key: "basicAuthPassword", title: "Basic auth password" },
];

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

// The fields that say where a feed reads from: changing one repoints it.
const ADDRESS_FIELDS: Array<keyof Model> = [
  "apiRootUrl",
  "collectionId",
  "listUrl",
  "securityEventConnectionId",
];

// Every field whose rules depend on the feed's source.
const SOURCE_FIELDS: Array<keyof Model> = [
  ...ADDRESS_FIELDS,
  "apiToken",
  "basicAuthUsername",
  "basicAuthPassword",
  "pollIntervalInMinutes",
];

/*
 * The connection a write names, under either of its names: the id column, or
 * the relation an Edit form's dropdown sends ({ _id }). Undefined when the
 * write names none; null when it clears it.
 */
function writtenConnectionId(data: Record<string, unknown>): unknown {
  if (data["securityEventConnectionId"] !== undefined) {
    return data["securityEventConnectionId"];
  }

  const relation: unknown = data["securityEventConnection"];

  if (relation === undefined) {
    return undefined;
  }

  return RelationValueUtil.getRelationId(relation);
}

// A value sent back as stored: an id as its text, empty as empty.
function isSameValue(sent: unknown, stored: unknown): boolean {
  if (!hasValue(sent) || !hasValue(stored)) {
    return !hasValue(sent) && !hasValue(stored);
  }

  return String(sent).trim() === String(stored).trim();
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Validate at save time so a feed that stores is a feed the poller can
   * use — a malformed URL or collection id surfaces to the person
   * configuring it, not as a cron-side lastError later. (The
   * SecurityEventConnectionService discipline.)
   */
  private validateFeed(data: {
    apiRootUrl?: string | undefined;
    collectionId?: string | undefined;
    pollIntervalInMinutes?: number | undefined;
    minimumConfidence?: number | undefined;
    indicatorConfidence?: number | null | undefined;
    listUrl?: string | undefined;
  }): void {
    if (data.apiRootUrl !== undefined && data.apiRootUrl !== null) {
      TaxiiClient.validateApiRootUrl(data.apiRootUrl);
    }

    if (data.collectionId !== undefined && data.collectionId !== null) {
      TaxiiClient.validateCollectionId(data.collectionId);
    }

    if (data.listUrl !== undefined && data.listUrl !== null) {
      ThreatIntelListSource.validateListUrl(data.listUrl);
    }

    if (data.pollIntervalInMinutes !== undefined) {
      if (
        !Number.isInteger(data.pollIntervalInMinutes) ||
        data.pollIntervalInMinutes <
          THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES ||
        data.pollIntervalInMinutes > THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES
      ) {
        throw new BadDataException(
          `Poll interval must be a whole number of minutes between ${THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES} and ${THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES}.`,
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

    if (
      data.indicatorConfidence !== undefined &&
      data.indicatorConfidence !== null
    ) {
      if (
        !Number.isInteger(data.indicatorConfidence) ||
        data.indicatorConfidence < 1 ||
        data.indicatorConfidence > 100
      ) {
        throw new BadDataException(
          "Confidence must be a whole number between 1 and 100.",
        );
      }
    }
  }

  // The rules one source holds a feed to, on top of validateFeed's.
  private async validateSource(data: {
    feedType: ThreatIntelFeedType;
    projectId: ObjectID | undefined;
    // The feed as it will be once written: what it stores, with the write applied.
    feed: Partial<Record<keyof Model, unknown>>;
    // The fields the write sets.
    written: Partial<Record<keyof Model, unknown>>;
  }): Promise<void> {
    const { feedType, feed, written } = data;

    if (feedType === ThreatIntelFeedType.Taxii) {
      // A TAXII feed keeps its collection: a write may change it, not clear it.
      if ("apiRootUrl" in written && !hasValue(feed["apiRootUrl"])) {
        throw new BadDataException("TAXII API root URL is required.");
      }

      if ("collectionId" in written && !hasValue(feed["collectionId"])) {
        throw new BadDataException("Collection ID is required.");
      }

      return;
    }

    for (const field of TAXII_ONLY_FIELDS) {
      if (hasValue(written[field.key])) {
        throw new BadDataException(
          `${field.title} is for a TAXII collection. A ${
            feedType === ThreatIntelFeedType.List ? "list" : "Google SecOps"
          } feed does not use it: leave it empty.`,
        );
      }
    }

    if (feedType === ThreatIntelFeedType.List) {
      if (!hasValue(feed["listUrl"])) {
        throw new BadDataException("List URL is required.");
      }

      const pollInterval: unknown = feed["pollIntervalInMinutes"];

      if (
        typeof pollInterval === "number" &&
        pollInterval < THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES
      ) {
        throw new BadDataException(
          `A list is downloaded whole on every poll, so it is polled at most every ${THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES} minutes. Set the poll interval to ${THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES} minutes or more.`,
        );
      }

      if (typeof written["listUrl"] === "string") {
        // A form error, not a poll that fails forever.
        await DataSourceEgressGuard.assertUrlAllowed(
          (written["listUrl"] as string).trim(),
          { targetLabel: "Threat intel list" },
        );
      }

      return;
    }

    if (hasValue(written["listUrl"])) {
      throw new BadDataException(
        "List URL is for a list feed. A Google SecOps feed does not use it: leave it empty.",
      );
    }

    const connectionId: unknown = feed["securityEventConnectionId"];

    if (!hasValue(connectionId)) {
      throw new BadDataException(
        "Choose the Google SecOps connection this feed reads through.",
      );
    }

    if (!hasValue(written["securityEventConnectionId"])) {
      return;
    }

    const connection: SecurityEventConnection | null =
      await SecurityEventConnectionService.findOneById({
        id: new ObjectID(String(connectionId)),
        select: { _id: true, projectId: true, provider: true },
        props: { isRoot: true },
      });

    if (
      !connection ||
      !data.projectId ||
      connection.projectId?.toString() !== data.projectId.toString() ||
      connection.provider !== SecurityEventConnectorProvider.GoogleSecOps
    ) {
      throw new BadDataException(
        "Choose a Google SecOps connection of this project. Connect Google SecOps under Security Events > Connections first.",
      );
    }
  }

  private readFeedType(value: unknown): ThreatIntelFeedType {
    if (
      value !== undefined &&
      value !== null &&
      !isThreatIntelFeedType(value)
    ) {
      throw new BadDataException(
        "Source must be a TAXII collection (taxii), a list of indicators (list) or Google SecOps (google-secops).",
      );
    }

    return readThreatIntelFeedType(value);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const feedType: ThreatIntelFeedType = this.readFeedType(
      createBy.data.feedType,
    );

    createBy.data.feedType = feedType;

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
      indicatorConfidence: createBy.data.indicatorConfidence,
      listUrl: createBy.data.listUrl,
    });

    const written: Partial<Record<keyof Model, unknown>> = {
      apiRootUrl: createBy.data.apiRootUrl,
      collectionId: createBy.data.collectionId,
      apiToken: createBy.data.apiToken,
      basicAuthUsername: createBy.data.basicAuthUsername,
      basicAuthPassword: createBy.data.basicAuthPassword,
      listUrl: createBy.data.listUrl,
      pollIntervalInMinutes: createBy.data.pollIntervalInMinutes,
      securityEventConnectionId: writtenConnectionId(
        createBy.data as unknown as Record<string, unknown>,
      ),
    };

    await this.validateSource({
      feedType,
      projectId: createBy.data.projectId || createBy.props.tenantId,
      feed: written,
      written,
    });

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    this.validateFeed({
      apiRootUrl: updateBy.data.apiRootUrl as string | undefined,
      collectionId: updateBy.data.collectionId as string | undefined,
      pollIntervalInMinutes: updateBy.data.pollIntervalInMinutes as
        | number
        | undefined,
      minimumConfidence: updateBy.data.minimumConfidence as number | undefined,
      indicatorConfidence: updateBy.data.indicatorConfidence as
        | number
        | null
        | undefined,
      listUrl: updateBy.data.listUrl as string | undefined,
    });

    await this.validateCredentialExclusivity(updateBy);

    /*
     * Repointing a feed invalidates its poll position: the added_after
     * cursor (and any saved page token) is a position in ONE collection's
     * date_added timeline, a list's cursor is the list it last read and a
     * Google SecOps feed's the end of the window it last read through one
     * connection. Carrying it to a different API root, collection, list or
     * connection would silently skip the new source's history.
     * Flagged here, reset in onUpdateSuccess — the cursor columns have
     * update: [] access control, so writing them into updateBy.data would
     * be rejected for non-root callers; the root-props write after the
     * update bypasses the column ACL the same legitimate way the poller's
     * own bookkeeping does. Only an address that changes repoints: an Edit
     * form sends a feed's address back as it is with every rename.
     */
    const { repointed } = await this.validateSourceOnUpdate(updateBy);

    return { updateBy, carryForward: { repointed } };
  }

  /*
   * An update is held to the rules of the source each feed it writes has:
   * what the feed stores, with the update's changes applied. The feeds are
   * read only when the update names a source field - an address, a
   * connection, the source itself, or a poll interval a list may not have -
   * so a rename, a new token or a severity is checked as before, without a
   * read. A value sent back as it is stored is no change: it is neither
   * checked again (no address resolved anew) nor a repoint.
   */
  private async validateSourceOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<{ repointed: boolean }> {
    const data: Record<string, unknown> = {
      ...(updateBy.data as Record<string, unknown>),
      securityEventConnectionId: writtenConnectionId(
        updateBy.data as Record<string, unknown>,
      ),
    };
    const pollInterval: unknown = data["pollIntervalInMinutes"];

    const namesSource: boolean =
      data["feedType"] !== undefined ||
      ADDRESS_FIELDS.some((key: keyof Model): boolean => {
        return data[key as string] !== undefined;
      }) ||
      (typeof pollInterval === "number" &&
        pollInterval < THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES);

    if (!namesSource) {
      return { repointed: false };
    }

    if (data["feedType"] !== undefined) {
      this.readFeedType(data["feedType"]);
    }

    const feeds: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        feedType: true,
        apiRootUrl: true,
        collectionId: true,
        basicAuthUsername: true,
        listUrl: true,
        pollIntervalInMinutes: true,
        securityEventConnectionId: true,
      },
    );

    let repointed: boolean = false;

    for (const feed of feeds) {
      const feedType: ThreatIntelFeedType = readThreatIntelFeedType(
        feed.feedType,
      );

      if (
        data["feedType"] !== undefined &&
        readThreatIntelFeedType(data["feedType"]) !== feedType
      ) {
        throw new BadDataException(
          "A feed's source cannot be changed. Add a new feed with the other source, then delete this one.",
        );
      }

      const stored: Partial<Record<keyof Model, unknown>> = {
        apiRootUrl: feed.apiRootUrl,
        collectionId: feed.collectionId,
        basicAuthUsername: feed.basicAuthUsername,
        listUrl: feed.listUrl,
        pollIntervalInMinutes: feed.pollIntervalInMinutes,
        securityEventConnectionId: feed.securityEventConnectionId,
      };

      // What the update changes; a secret is never read back, so one sent is a change.
      const written: Partial<Record<keyof Model, unknown>> = {};

      for (const key of SOURCE_FIELDS) {
        const value: unknown = data[key as string];

        if (value === undefined) {
          continue;
        }

        if (key in stored && isSameValue(value, stored[key])) {
          continue;
        }

        written[key] = value;
      }

      if (
        ADDRESS_FIELDS.some((key: keyof Model): boolean => {
          return key in written;
        })
      ) {
        repointed = true;
      }

      await this.validateSource({
        feedType,
        projectId: feed.projectId,
        feed: { ...stored, ...written },
        written,
      });
    }

    return { repointed };
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
         * Cannot recurse: this inner update carries no source field, so its
         * own onBeforeUpdate flags nothing.
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

    const matchedFeeds: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        apiToken: true,
        basicAuthPassword: true,
      },
    );

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
