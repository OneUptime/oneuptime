import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CallerVisibleRead from "../Utils/Database/CallerVisibleRead";
import { applyAlertRelatedRecordPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";
import { applyAlertEpisodeRelatedRecordPrivacyFilter } from "../Utils/AlertEpisode/AlertEpisodePrivacyFilter";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../Types/JSON";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Model, {
  AlertEpisodeMemberAddedBy,
} from "../../Models/DatabaseModels/AlertEpisodeMember";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import AlertFeedService from "./AlertFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Yellow500, Green500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import AlertService from "./AlertService";
import AlertEpisodeService from "./AlertEpisodeService";
import AlertSeverityService from "./AlertSeverityService";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../Utils/Markdown/FeedMarkdown";
import EpisodeMembersAdd, {
  ALERT_EPISODE_ID_KEY,
  ALERT_IDS_KEY,
  ALERT_IDS_TO_ADD_KEY,
  ALERT_NOT_FOUND_REASON,
  ALERT_NOUNS,
  EpisodeMembersAddResult,
} from "../../Types/Episode/EpisodeMembersAdd";
import EpisodeMembersBatch, {
  EpisodeMemberFeedMention,
} from "../Utils/Episode/EpisodeMembersBatch";
import EpisodeSingleMembership, {
  ALERT_IN_ANOTHER_EPISODE_REASON,
  ALERT_SINGLE_MEMBERSHIP,
} from "../../Types/Episode/EpisodeSingleMembership";
import EpisodeSingleMembershipCheck, {
  RecordInAnotherEpisodeException,
} from "../Utils/Episode/EpisodeSingleMembershipCheck";
import ModelPermission from "../Types/Database/Permissions/Index";
import CreateScopeException from "../Types/Database/Permissions/CreateScopeException";
import QueryHelper from "../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import type { PendingRecord } from "./DatabaseService";
import EpisodeMemberAddScope from "../Utils/Episode/EpisodeMemberAddScope";

// What adding an alert to an episode it is in already is refused with.
/*
 * The unique index that lets at most one membership of an alert be its first
 * (the AlertEpisodeMember model's isFirstMembership): a create that loses a race to it
 * is checked again (Service.create).
 */
export const ALERT_FIRST_MEMBERSHIP_INDEX: string =
  "IDX_AlertEpisodeMember_first_membership";

export const ALERT_ALREADY_IN_EPISODE_MESSAGE: string =
  "Alert is already a member of this episode";

/*
 * The alerts to create a new episode with (ALERT_IDS_TO_ADD_KEY), as
 * validated before the episode exists, and the most severe of their
 * severities - what the episode takes when its create names none.
 */
export interface AlertsForNewEpisode {
  alertIds: Array<ObjectID>;
  mostSevereAlertSeverityId: ObjectID | null;
}

/*
 * An alert's or an episode's title is plain text - an alert's is often
 * filled in by a monitor from what it watched (an incoming email's subject,
 * a field of an incoming request), and an episode's is often copied from its
 * first alert's - and the feed items below place it into Markdown that the
 * dashboard renders without its safe mode and that is posted to Slack and
 * Teams. It is placed as text (mdText), as the incident episode members'
 * items place theirs, so "![](https://tracker...)" is not fetched, "[Reset
 * your password](...)" is not a link that hides where it goes and
 * "<!channel>" mentions nobody, while an ordinary title reads as typed.
 */

// How a feed entry names the alert, or the episode, on the other side.
interface FeedMention {
  // "**Alert ALT-3**", or "**Alert ALT-3** (private alert)".
  subject: MarkdownText;
  // ": <title>", or nothing for a private one.
  titleSuffix: MarkdownText;
}

/*
 * Each side's entry is read by its own side's audience: the episode's feed
 * and Slack / Microsoft Teams channels by whoever can see the episode, the
 * alert's feed by whoever can see the alert. So a private end's title never
 * goes into the other side's entry - not even when both are private, because
 * the two can have different owners - as IncidentAlertService does for an
 * alert linked to an incident. Its number is kept, so the entry still says
 * what happened.
 */
type DescribeFeedMentionFunction = (data: {
  label: string;
  title: string | undefined | null;
  isPrivate: boolean;
  privateNoun: string;
}) => FeedMention;

const describeFeedMention: DescribeFeedMentionFunction = (data: {
  label: string;
  title: string | undefined | null;
  isPrivate: boolean;
  privateNoun: string;
}): FeedMention => {
  const subject: MarkdownText = mdText`**${data.label}**`;

  if (data.isPrivate) {
    return {
      subject: mdText`${subject} (private ${data.privateNoun})`,
      titleSuffix: FeedMarkdown.empty(),
    };
  }

  return {
    subject: subject,
    titleSuffix: mdText`: ${data.title || "No title"}`,
  };
};

type DescribeAlertFunction = (alert: Alert | null) => FeedMention;

const describeAlert: DescribeAlertFunction = (
  alert: Alert | null,
): FeedMention => {
  return describeFeedMention({
    label: `Alert ${alert?.alertNumberWithPrefix || "#" + (alert?.alertNumber || "N/A")}`,
    title: alert?.title,
    isPrivate: alert?.isPrivate === true,
    privateNoun: "alert",
  });
};

type DescribeEpisodeFunction = (episode: AlertEpisode | null) => FeedMention;

const describeEpisode: DescribeEpisodeFunction = (
  episode: AlertEpisode | null,
): FeedMention => {
  return describeFeedMention({
    label: `Episode ${episode?.episodeNumberWithPrefix || "#" + (episode?.episodeNumber || "N/A")}`,
    title: episode?.title,
    isPrivate: episode?.isPrivate === true,
    privateNoun: "episode",
  });
};

// Postgres compares uuids by value, whatever case or padding an id came in.
type IsSameIdFunction = (
  id: ObjectID | string | undefined | null,
  other: ObjectID,
) => boolean;

const isSameId: IsSameIdFunction = (
  id: ObjectID | string | undefined | null,
  other: ObjectID,
): boolean => {
  return (
    (id?.toString() || "").trim().toLowerCase() ===
    other.toString().trim().toLowerCase()
  );
};

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * TWO ADDS OF ONE ALERT, AT ONE MOMENT.
   *
   * onBeforeCreate checks the alert's memberships before it adds one, and
   * refuses an alert in another episode while the project allows one episode
   * per alert (EpisodeSingleMembership). Two adds of an alert that is in no
   * episode yet - to two episodes, by a person and the grouping engine, or
   * from two tabs - both found none, and both were added. Each is now its
   * alert's first membership, and the database takes one first membership
   * per alert (ALERT_FIRST_MEMBERSHIP_INDEX): the one that loses is refused there.
   *
   * It is then made again, as sent, from the start: its own check now finds
   * the membership that won, and so refuses it while the project allows one
   * episode - in the words a later add would get - or adds it as a second
   * membership while the project allows several. Once: a second attempt is
   * never a first membership, so the index never refuses it.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    const props: DatabaseCommonInteractionProps = createBy.props;
    const sent: JSONObject = BaseModel.toJSON(createBy.data, Model);

    try {
      return await super.create(createBy);
    } catch (error) {
      if (
        !PostgresErrorTranslator.isUniqueViolationOf(
          error,
          ALERT_FIRST_MEMBERSHIP_INDEX,
        )
      ) {
        throw error;
      }

      logger.debug(
        `Alert added to an episode at the moment another add of it was: checking it again.`,
      );

      return await super.create({
        ...createBy,
        props: props,
        data: BaseModel.fromJSON<Model>(sent, Model) as Model,
      });
    }
  }

  /*
   * On a person's create, the episode and the alert are checked by this
   * service's own hook: read as the caller, so a private one they cannot
   * open, one of another project and one that does not exist all get the
   * same answer. A generic check first would answer the last two in other
   * words than the first. A workflow step acts as a Project Admin of its
   * project (WorkflowPrincipal), so it is read like one. OneUptime's own
   * writes - the grouping engine, adding by hand for the person who asked -
   * are made as root and get the generic check, as every update does (no
   * person may change a member's alert or episode).
   */
  protected override getRelationsCheckedByService(
    write?: ProjectReferenceWrite,
  ): Array<string> {
    if (write && (write.kind === "update" || write.props.isRoot)) {
      return [];
    }

    return ["alertEpisode", "alert"];
  }

  /*
   * A member row reveals both of its ends, so it is only visible to a user
   * who can see the private alert AND the private episode. The two filters
   * write different keys (alertId / alertEpisodeId) and compose. Relation
   * joins (`select: { alert: { title } }`, as the episode's Alerts tab
   * sends) run neither AlertService's nor AlertEpisodeService's
   * onBeforeFind, so these are the only thing keeping a private alert's
   * title out of an episode's member list, and a private episode's alerts
   * from anyone who knows its id. This service's own reads are made as
   * root, which neither filter narrows.
   */
  private applyPrivacyFilters<T>(
    query: T,
    props: DatabaseCommonInteractionProps,
  ): T {
    return applyAlertEpisodeRelatedRecordPrivacyFilter(
      applyAlertRelatedRecordPrivacyFilter(query, props),
      props,
    );
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = this.applyPrivacyFilters(findBy.query, findBy.props);
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = this.applyPrivacyFilters(countBy.query, countBy.props);
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    updateBy.query = this.applyPrivacyFilters(updateBy.query, updateBy.props);
    return { updateBy, carryForward: null };
  }

  /*
   * A person may only add an alert they can see to an episode they can see.
   * The foreign keys only require the rows to exist, and
   * @CanAccessIfCanReadOn is not applied on create, so without this a member
   * could add a private alert they cannot open to an episode by its id - and
   * the episode's feed would then show its title - or add to a private
   * episode they cannot open.
   *
   * This hook runs before DatabaseService checks the caller's create
   * permission on the columns, so no refusal before the visibility check
   * says anything about a record the caller cannot see: the duplicate check,
   * which would, comes after it.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    // A reference arrives as `alertId` or as `alert: { _id }`.
    const alertEpisodeId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["alertEpisodeId", "alertEpisode"],
      "episode",
    );

    const alertId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["alertId", "alert"],
      "alert",
    );

    if (!alertEpisodeId) {
      throw new BadDataException("alertEpisodeId is required");
    }

    if (!alertId) {
      throw new BadDataException("alertId is required");
    }

    // The ids checked below are the only ones that can reach the insert.
    RelationIdUtil.stamp(
      data,
      ["alertEpisodeId", "alertEpisode"],
      alertEpisodeId,
    );
    RelationIdUtil.stamp(data, ["alertId", "alert"], alertId);

    if (
      !createBy.props.isRoot &&
      createBy.data.isOwnerNotifiedOfAlertAdded !== undefined
    ) {
      throw new BadDataException(
        "isOwnerNotifiedOfAlertAdded cannot be set directly",
      );
    }

    if (!createBy.props.isRoot) {
      await this.checkCallerCanSeeBothEnds({
        createBy: createBy,
        alertEpisodeId: alertEpisodeId,
        alertId: alertId,
      });
    }

    // Check if this alert is already in the episode
    const existingMember: Model | null = await this.findOneBy({
      query: {
        alertEpisodeId: alertEpisodeId,
        alertId: alertId,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    if (existingMember) {
      throw new BadDataException(ALERT_ALREADY_IN_EPISODE_MESSAGE);
    }

    /*
     * In another episode already, in a project that allows an alert in only
     * one (EpisodeSingleMembership): refused, whoever adds it and however -
     * a person, an API key, a workflow, the grouping engine. After the
     * visibility check, as the duplicate check is: the refusal names only
     * what the caller can see.
     */
    const isFirstMembership: boolean = await this.refuseIfInAnotherEpisode({
      createBy: createBy,
      alertId: alertId,
    });

    /*
     * Its first membership when the alert is in no episode now: at most one
     * membership of an alert is, so of two adds of it racing each other the
     * database refuses the second, which is checked again (create, above).
     * OneUptime decides it, whatever the write sent.
     */
    createBy.data.isFirstMembership = isFirstMembership;

    /*
     * Added by the person making the request. DatabaseService has already
     * taken out whatever addedByUser the request named, under both names
     * (UserAttribution), so with no person on it - an API key, a workflow -
     * nobody is named. OneUptime's own writes - adding by hand for the
     * person who asked, as the grouping engine does - name that person
     * themselves, and keep it.
     */
    if (createBy.props.userId && !createBy.props.isRoot) {
      RelationIdUtil.stamp(
        createBy.data as unknown as Record<string, unknown>,
        ["addedByUserId", "addedByUser"],
        createBy.props.userId,
      );
    }

    // Set addedAt if not provided
    if (!createBy.data.addedAt) {
      createBy.data.addedAt = OneUptimeDate.getCurrentDate();
    }

    /*
     * If this is the very first alert in the episode (the founder), the
     * "episode created" notification already covers it. Mark the member as
     * "already notified" so the AlertAdded-to-episode cron skips it. This
     * avoids double-notifying owners when an episode is born with its first
     * alert.
     */
    if (createBy.data.isOwnerNotifiedOfAlertAdded === undefined) {
      const existingMemberCount: PositiveNumber = await this.countBy({
        query: {
          alertEpisodeId: alertEpisodeId,
        },
        props: {
          isRoot: true,
        },
      });

      if (existingMemberCount.toNumber() === 0) {
        createBy.data.isOwnerNotifiedOfAlertAdded = true;
      }
    }

    return { createBy, carryForward: null };
  }

  /*
   * Reads the episode and the alert as the caller, so privacy, label and
   * owner scoping apply exactly as they do on their own pages, and pins both
   * to the member's project: the request's tenant, the only project the
   * caller was checked in. A caller without read access at all gets the same
   * answer as one asking for a record that does not exist.
   */
  @CaptureSpan()
  private async checkCallerCanSeeBothEnds(data: {
    createBy: CreateBy<Model>;
    alertEpisodeId: ObjectID;
    alertId: ObjectID;
  }): Promise<void> {
    const { createBy } = data;

    const projectId: ObjectID | null =
      createBy.props.tenantId ||
      RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        ["projectId", "project"],
        "project",
      );

    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    const episode: AlertEpisode | null = await CallerVisibleRead.find(() => {
      return AlertEpisodeService.findOneById({
        id: data.alertEpisodeId,
        select: { _id: true, projectId: true },
        props: createBy.props,
      });
    });

    if (!episode || !isSameId(episode.projectId, projectId)) {
      throw new BadDataException(
        "The episode to add the alert to does not exist in this project, or you do not have access to it.",
      );
    }

    const alert: Alert | null = await CallerVisibleRead.find(() => {
      return AlertService.findOneById({
        id: data.alertId,
        select: { _id: true, projectId: true },
        props: createBy.props,
      });
    });

    if (!alert || !isSameId(alert.projectId, projectId)) {
      throw new BadDataException(
        "The alert to add does not exist in this project, or you do not have access to it.",
      );
    }
  }

  /*
   * Refuses a member whose alert is in another episode already, when the
   * project allows an alert in only one (EpisodeSingleMembership). It is not
   * in this episode - the duplicate check came first - so any episode it is
   * in is another. The refusal names the alert, and the episode it is in
   * when the caller can see that episode: a private one they cannot open is
   * "another episode". OneUptime's own writes see every episode.
   */
  @CaptureSpan()
  private async refuseIfInAnotherEpisode(data: {
    createBy: CreateBy<Model>;
    alertId: ObjectID;
  }): Promise<boolean> {
    const { createBy } = data;

    const projectId: ObjectID | null =
      createBy.props.tenantId ||
      RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        ["projectId", "project"],
        "project",
      );

    // No project to read: not judged, and never a first membership.
    if (!projectId) {
      return false;
    }

    // The member rows first: adding an alert in no episode reads no project.
    const latestEpisodeId: ObjectID | null = await this.findLatestEpisodeIdOf({
      projectId: projectId,
      alertId: data.alertId,
    });

    if (!latestEpisodeId) {
      return true;
    }

    const isOnlyOneEpisodeAllowed: boolean =
      await EpisodeSingleMembershipCheck.isOn({
        projectId: projectId,
        kind: ALERT_SINGLE_MEMBERSHIP,
      });

    if (!isOnlyOneEpisodeAllowed) {
      return false;
    }

    const holdingEpisodeId: ObjectID = latestEpisodeId;

    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        alertNumber: true,
        alertNumberWithPrefix: true,
      },
      props: {
        isRoot: true,
      },
    });

    const episodeSelect: {
      episodeNumber: true;
      episodeNumberWithPrefix: true;
    } = {
      episodeNumber: true,
      episodeNumberWithPrefix: true,
    };

    const episode: AlertEpisode | null = createBy.props.isRoot
      ? await AlertEpisodeService.findOneById({
          id: holdingEpisodeId,
          select: episodeSelect,
          props: {
            isRoot: true,
          },
        })
      : await CallerVisibleRead.find(() => {
          return AlertEpisodeService.findOneById({
            id: holdingEpisodeId,
            select: episodeSelect,
            props: createBy.props,
          });
        });

    throw new RecordInAnotherEpisodeException(
      EpisodeSingleMembership.getAddRefusal({
        kind: ALERT_SINGLE_MEMBERSHIP,
        recordLabel: EpisodeSingleMembership.getLabel(
          alert?.alertNumberWithPrefix,
          alert?.alertNumber,
        ),
        episodeLabel: EpisodeSingleMembership.getLabel(
          episode?.episodeNumberWithPrefix,
          episode?.episodeNumber,
        ),
      }),
    );
  }

  /*
   * The episode that keeps an alert out of every other one: the latest
   * episode it is in, when the project allows an alert in only one episode
   * (EpisodeSingleMembership). Null when it is in no episode, or when the
   * project allows several. The member rows are read first, so the
   * project's switch is read only for an alert that is in an episode -
   * adding one that is in none, the usual case, never reads it.
   */
  @CaptureSpan()
  public async findHoldingEpisodeId(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<ObjectID | null> {
    const latestEpisodeId: ObjectID | null =
      await this.findLatestEpisodeIdOf(data);

    if (!latestEpisodeId) {
      return null;
    }

    const isOnlyOneEpisodeAllowed: boolean =
      await EpisodeSingleMembershipCheck.isOn({
        projectId: data.projectId,
        kind: ALERT_SINGLE_MEMBERSHIP,
      });

    return isOnlyOneEpisodeAllowed ? latestEpisodeId : null;
  }

  /*
   * The latest episode an alert is in, by its member rows: null when it is in
   * none. Read as OneUptime - it decides what a write may do.
   */
  @CaptureSpan()
  private async findLatestEpisodeIdOf(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<ObjectID | null> {
    const membership: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        alertId: data.alertId,
      },
      select: {
        alertEpisodeId: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    return membership?.alertEpisodeId || null;
  }

  /*
   * The alerts among `alertIds` that are in an episode, when the project
   * allows an alert in only one episode (EpisodeSingleMembership) - the ones
   * no other episode may take. Empty when none is in an episode, or when the
   * project allows several; read like findHoldingEpisodeId, the member rows
   * first.
   */
  @CaptureSpan()
  public async findAlertIdsHeldInEpisodes(data: {
    projectId: ObjectID;
    alertIds: Array<ObjectID>;
  }): Promise<Set<string>> {
    if (data.alertIds.length === 0) {
      return new Set();
    }

    const members: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        alertId: QueryHelper.any(data.alertIds),
      },
      select: {
        alertId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const alertIdsInAnEpisode: Set<string> = new Set();

    for (const member of members) {
      if (member.alertId) {
        alertIdsInAnEpisode.add(EpisodeMembersAdd.normalizeId(member.alertId));
      }
    }

    if (alertIdsInAnEpisode.size === 0) {
      return alertIdsInAnEpisode;
    }

    const isOnlyOneEpisodeAllowed: boolean =
      await EpisodeSingleMembershipCheck.isOn({
        projectId: data.projectId,
        kind: ALERT_SINGLE_MEMBERSHIP,
      });

    return isOnlyOneEpisodeAllowed ? alertIdsInAnEpisode : new Set();
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.alertEpisodeId) {
      throw new BadDataException("alertEpisodeId is required");
    }

    if (!createdItem.alertId) {
      throw new BadDataException("alertId is required");
    }

    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    /*
     * One of several alerts added together (EpisodeMembersBatch): the
     * episode's count, its last-added time and its feed entry are written
     * once, for all of them, by whoever is adding them. The alert's own side
     * - its episode, its feed entry - is written here as always.
     */
    const isAddedTogether: boolean = EpisodeMembersBatch.isAddedTogether({
      props: onCreate.createBy.props,
      miscDataProps: onCreate.createBy.miscDataProps,
    });

    // Update alert's episode reference
    await AlertService.updateOneById({
      id: createdItem.alertId,
      data: {
        alertEpisodeId: createdItem.alertEpisodeId,
      },
      props: {
        isRoot: true,
      },
    });

    // Update episode's alertCount and lastAlertAddedAt
    if (!isAddedTogether) {
      try {
        await AlertEpisodeService.updateAlertCount(createdItem.alertEpisodeId!);
        await AlertEpisodeService.updateLastAlertAddedAt(
          createdItem.alertEpisodeId!,
        );
      } catch (error) {
        logger.error(
          `Error updating episode counts in AlertEpisodeMemberService.onCreateSuccess: ${error}`,
        );
      }
    }

    // Get alert details for feed
    const alert: Alert | null = await AlertService.findOneById({
      id: createdItem.alertId,
      select: {
        alertNumber: true,
        alertNumberWithPrefix: true,
        title: true,
        isPrivate: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Get episode details for feed
    const episode: AlertEpisode | null = await AlertEpisodeService.findOneById({
      id: createdItem.alertEpisodeId,
      select: {
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        title: true,
        isPrivate: true,
      },
      props: {
        isRoot: true,
      },
    });

    const alertMention: FeedMention = describeAlert(alert);
    const episodeMention: FeedMention = describeEpisode(episode);

    // Create feed item on episode
    if (!isAddedTogether) {
      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: createdItem.alertEpisodeId,
        projectId: createdItem.projectId,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.AlertAdded,
        displayColor: Yellow500,
        feedInfoInMarkdown: EpisodeMembersBatch.getAddedFeedMarkdown({
          mentions: [alertMention],
          nouns: ALERT_NOUNS,
        }),
        userId: createdItem.addedByUserId || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: createdItem.addedByUserId || undefined,
        },
      });
    }

    // Create feed item on alert
    await AlertFeedService.createAlertFeedItem({
      alertId: createdItem.alertId,
      projectId: createdItem.projectId,
      alertFeedEventType: AlertFeedEventType.AddedToEpisode,
      displayColor: Yellow500,
      feedInfoInMarkdown:
        mdText`Added to ${episodeMention.subject}${episodeMention.titleSuffix}`.toString(),
      userId: createdItem.addedByUserId || undefined,
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Only members the caller can see are deleted, and carried forward.
    deleteBy.query = this.applyPrivacyFilters(deleteBy.query, deleteBy.props);

    // The members the delete removes, and the delete held to them.
    const membersToDelete: Model[] = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        alertEpisodeId: true,
        alertId: true,
        projectId: true,
      },
    );

    return {
      deleteBy,
      carryForward: membersToDelete,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const membersDeleted: Model[] = onDelete.carryForward as Model[];

    if (membersDeleted && membersDeleted.length > 0) {
      for (const member of membersDeleted) {
        if (member.alertId) {
          /*
           * Point the alert at the latest episode it is still a member of (it
           * can be in more than one, so leaving one must not unlink it from
           * another), or at none. None must be null: an update skips a column
           * given as undefined.
           */
          const remainingMember: Model | null = await this.findOneBy({
            query: {
              alertId: member.alertId,
            },
            select: {
              alertEpisodeId: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
          });

          await AlertService.updateOneById({
            id: member.alertId,
            data: {
              alertEpisodeId: remainingMember?.alertEpisodeId || null,
            },
            props: {
              isRoot: true,
            },
          });

          // Get alert details for feed
          const alert: Alert | null = await AlertService.findOneById({
            id: member.alertId,
            select: {
              alertNumber: true,
              alertNumberWithPrefix: true,
              title: true,
              isPrivate: true,
            },
            props: {
              isRoot: true,
            },
          });

          // Create feed item for removal
          if (member.alertEpisodeId && member.projectId) {
            // Get episode details for feed
            const episode: AlertEpisode | null =
              await AlertEpisodeService.findOneById({
                id: member.alertEpisodeId,
                select: {
                  episodeNumber: true,
                  episodeNumberWithPrefix: true,
                  title: true,
                  isPrivate: true,
                },
                props: {
                  isRoot: true,
                },
              });

            const alertMention: FeedMention = describeAlert(alert);
            const episodeMention: FeedMention = describeEpisode(episode);

            // Create feed item on episode
            await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
              alertEpisodeId: member.alertEpisodeId,
              projectId: member.projectId,
              alertEpisodeFeedEventType: AlertEpisodeFeedEventType.AlertRemoved,
              displayColor: Green500,
              feedInfoInMarkdown:
                mdText`${alertMention.subject} removed from episode${alertMention.titleSuffix}`.toString(),
              workspaceNotification: {
                sendWorkspaceNotification: true,
              },
            });

            // Create feed item on alert
            await AlertFeedService.createAlertFeedItem({
              alertId: member.alertId,
              projectId: member.projectId,
              alertFeedEventType: AlertFeedEventType.RemovedFromEpisode,
              displayColor: Green500,
              feedInfoInMarkdown:
                mdText`Removed from ${episodeMention.subject}${episodeMention.titleSuffix}`.toString(),
            });
          }
        }

        if (member.alertEpisodeId) {
          // Update episode's alertCount
          await AlertEpisodeService.updateAlertCount(member.alertEpisodeId);
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public async getAlertsInEpisode(episodeId: ObjectID): Promise<ObjectID[]> {
    const members: Model[] = await this.findBy({
      query: {
        alertEpisodeId: episodeId,
      },
      props: {
        isRoot: true,
      },
      select: {
        alertId: true,
      },
      limit: 1000,
      skip: 0,
    });

    return members
      .filter((m: Model) => {
        return m.alertId;
      })
      .map((m: Model) => {
        return m.alertId!;
      });
  }

  @CaptureSpan()
  public async isAlertInEpisode(
    alertId: ObjectID,
    episodeId: ObjectID,
  ): Promise<boolean> {
    const member: Model | null = await this.findOneBy({
      query: {
        alertId: alertId,
        alertEpisodeId: episodeId,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    return member !== null;
  }

  /*
   * POST /alert-episode-member/add-alerts: several alerts added to an
   * episode in one request (EpisodeMembersAdd) - from the alerts lists' Add
   * to Existing Episode, and from the episode's own Add Alerts.
   *
   * Checked as the caller, before anything is written: that they may add
   * alerts to episodes at all, and that they can see the episode - the whole
   * request is refused otherwise - then each alert. An alert they cannot see
   * is answered like one that does not exist, and is not added; one in the
   * episode already is left as it is; one in another episode, in a project
   * that allows an alert in only one (EpisodeSingleMembership), is not added
   * and says why. Every other is added as a member of
   * its own, through this service's create, so each is the same row, with
   * the same follow-ons on the alert, as an alert added on its own; the
   * episode's side is written once for all of them (addedTogether).
   *
   * The answer names every alert asked for, in the order asked, once.
   */
  @CaptureSpan()
  public async addAlertsToEpisode(data: {
    alertEpisodeId: unknown;
    alertIds: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<EpisodeMembersAddResult> {
    const alertEpisodeId: ObjectID = EpisodeMembersAdd.parseEpisodeId({
      value: data.alertEpisodeId,
      key: ALERT_EPISODE_ID_KEY,
    });

    const alertIds: Array<ObjectID> = EpisodeMembersAdd.parseIds({
      value: data.alertIds,
      key: ALERT_IDS_KEY,
      nouns: ALERT_NOUNS,
    });

    const projectId: ObjectID | undefined = data.props.tenantId;

    if (!projectId) {
      throw new BadDataException(
        "A project is required to add alerts to an episode.",
      );
    }

    this.checkCallerMayAddMembers({
      projectId: projectId,
      alertEpisodeId: alertEpisodeId,
      alertId: alertIds[0]!,
      props: data.props,
    });

    const episode: AlertEpisode | null = await CallerVisibleRead.find(() => {
      return AlertEpisodeService.findOneById({
        id: alertEpisodeId,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    });

    if (!episode || !isSameId(episode.projectId, projectId)) {
      throw new BadDataException(
        "The episode to add the alerts to does not exist in this project, or you do not have access to it.",
      );
    }

    const visibleAlertIds: Set<string> = await this.findAlertIdsCallerCanSee({
      projectId: projectId,
      alertIds: alertIds,
      props: data.props,
    });

    const alertIdsInEpisode: Set<string> = await this.findAlertIdsInEpisode({
      alertEpisodeId: alertEpisodeId,
      alertIds: alertIds.filter((alertId: ObjectID) => {
        return visibleAlertIds.has(EpisodeMembersAdd.normalizeId(alertId));
      }),
    });

    /*
     * Of the rest, the ones in another episode already, when the project
     * allows an alert in only one (EpisodeSingleMembership): each is not
     * added, and says why. The others are added as always.
     */
    const alertIdsInAnotherEpisode: Set<string> =
      await this.findAlertIdsHeldInEpisodes({
        projectId: projectId,
        alertIds: alertIds.filter((alertId: ObjectID) => {
          const key: string = EpisodeMembersAdd.normalizeId(alertId);
          return visibleAlertIds.has(key) && !alertIdsInEpisode.has(key);
        }),
      });

    const result: EpisodeMembersAddResult = EpisodeMembersAdd.emptyResult();
    const addedAlertIds: Array<ObjectID> = [];

    for (const alertId of alertIds) {
      const key: string = EpisodeMembersAdd.normalizeId(alertId);

      if (!visibleAlertIds.has(key)) {
        result.notAdded.push({ id: key, reason: ALERT_NOT_FOUND_REASON });
        continue;
      }

      if (alertIdsInEpisode.has(key)) {
        result.alreadyInEpisode.push(key);
        continue;
      }

      if (alertIdsInAnotherEpisode.has(key)) {
        result.notAdded.push({
          id: key,
          reason: ALERT_IN_ANOTHER_EPISODE_REASON,
        });
        continue;
      }

      // One the caller may not add as a member of their own. See the helper.
      const refusal: string | null = await this.getMemberAddRefusal({
        projectId: projectId,
        alertEpisodeId: alertEpisodeId,
        alertId: alertId,
        props: data.props,
      });

      if (refusal) {
        result.notAdded.push({ id: key, reason: refusal });
        continue;
      }

      try {
        const wasAdded: boolean = await this.createMemberAddedTogether({
          projectId: projectId,
          alertEpisodeId: alertEpisodeId,
          alertId: alertId,
          addedByUserId: data.props.userId,
          isFounder: false,
        });

        if (wasAdded) {
          result.added.push(key);
          addedAlertIds.push(alertId);
        } else {
          result.alreadyInEpisode.push(key);
        }
      } catch (error) {
        /*
         * Put in another episode while this request ran: said as the one
         * found before is, so the dialogs list both under one reason.
         */
        const message: string =
          error instanceof RecordInAnotherEpisodeException
            ? ALERT_IN_ANOTHER_EPISODE_REASON
            : error instanceof Error && error.message
              ? error.message
              : "This alert could not be added to the episode.";

        logger.error(
          `AlertEpisodeMemberService could not add alert ${key} to episode ${alertEpisodeId.toString()}: ${message}`,
          {
            projectId: projectId.toString(),
            alertEpisodeId: alertEpisodeId.toString(),
            alertId: key,
          } as LogAttributes,
        );

        result.notAdded.push({ id: key, reason: message });
      }
    }

    await this.updateEpisodeAfterAddingTogether({
      projectId: projectId,
      alertEpisodeId: alertEpisodeId,
      addedAlertIds: addedAlertIds,
      addedByUserId: data.props.userId,
      raiseSeverity: true,
      writeFeedItem: true,
    });

    return result;
  }

  /*
   * An alert episode created with the alerts it is for
   * (miscDataProps[ALERT_IDS_TO_ADD_KEY], see EpisodeMembersAdd): the ids,
   * checked by AlertEpisodeService.onBeforeCreate before the episode number
   * is taken and before anything is written. Every one must be an alert the
   * caller can see in the project - one that is not refuses the whole
   * create, so no episode is left behind without some of the alerts it was
   * created for - and the caller must be allowed to add alerts to episodes.
   * In a project that allows an alert in only one episode
   * (EpisodeSingleMembership), one that is in an episode already refuses the
   * whole create too, naming the alerts that are. Hands back the ids, each
   * once, and the most severe of the alerts' severities.
   */
  @CaptureSpan()
  public async validateAlertsForNewEpisode(data: {
    projectId: ObjectID;
    alertIds: unknown;
    props: DatabaseCommonInteractionProps;
    // The labels the episode is created with, which its members carry too.
    labels?: unknown;
  }): Promise<AlertsForNewEpisode> {
    const alertIds: Array<ObjectID> = EpisodeMembersAdd.parseIds({
      value: data.alertIds,
      key: ALERT_IDS_TO_ADD_KEY,
      nouns: ALERT_NOUNS,
    });

    this.checkCallerMayAddMembers({
      projectId: data.projectId,
      /*
       * The episode does not exist yet: the permission is the model's, asked
       * of a member that names the first alert.
       */
      alertEpisodeId: ObjectID.generate(),
      alertId: alertIds[0]!,
      props: data.props,
    });

    const alerts: Array<Alert> =
      (await CallerVisibleRead.find(() => {
        return AlertService.findBy({
          query: {
            _id: QueryHelper.any(alertIds),
            projectId: data.projectId,
          },
          select: {
            _id: true,
            alertSeverityId: true,
            alertNumber: true,
            alertNumberWithPrefix: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: data.props,
        });
      })) || [];

    const visibleAlertIds: Set<string> = new Set(
      alerts.map((alert: Alert): string => {
        return EpisodeMembersAdd.normalizeId(alert._id || "");
      }),
    );

    const allVisible: boolean = alertIds.every((alertId: ObjectID) => {
      return visibleAlertIds.has(EpisodeMembersAdd.normalizeId(alertId));
    });

    if (!allVisible) {
      throw new BadDataException(
        "Some of the alerts to add to the episode do not exist in this project, or you do not have access to them.",
      );
    }

    /*
     * Each one the caller may add as a member of their own, to the episode
     * as it will be saved (its labels): one they may not refuses the whole
     * create, as one they cannot see does. See getMemberAddRefusal.
     */
    const pendingEpisode: PendingRecord =
      EpisodeMemberAddScope.getPendingEpisode({
        episodeModelType: AlertEpisode,
        labels: data.labels,
      });

    for (const alertId of alertIds) {
      const refusal: string | null = await this.getMemberAddRefusal({
        projectId: data.projectId,
        alertEpisodeId: pendingEpisode.id,
        alertId: alertId,
        props: data.props,
        pendingEpisode: pendingEpisode,
      });

      if (refusal) {
        throw new CreateScopeException(refusal);
      }
    }

    /*
     * In an episode already, in a project that allows an alert in only one:
     * the new episode may not take them, so it is not created. Each is named
     * by its number - the caller can see every one of them - in the order
     * asked.
     */
    const alertIdsInAnEpisode: Set<string> =
      await this.findAlertIdsHeldInEpisodes({
        projectId: data.projectId,
        alertIds: alertIds,
      });

    if (alertIdsInAnEpisode.size > 0) {
      const alertById: Map<string, Alert> = new Map();

      for (const alert of alerts) {
        alertById.set(EpisodeMembersAdd.normalizeId(alert._id || ""), alert);
      }

      const labels: Array<string | null> = [];

      for (const alertId of alertIds) {
        const key: string = EpisodeMembersAdd.normalizeId(alertId);

        if (!alertIdsInAnEpisode.has(key)) {
          continue;
        }

        const alert: Alert | undefined = alertById.get(key);

        labels.push(
          EpisodeSingleMembership.getLabel(
            alert?.alertNumberWithPrefix,
            alert?.alertNumber,
          ),
        );
      }

      throw new RecordInAnotherEpisodeException(
        EpisodeSingleMembership.getNewEpisodeRefusal({
          kind: ALERT_SINGLE_MEMBERSHIP,
          recordLabels: labels,
        }),
      );
    }

    return {
      alertIds: alertIds,
      mostSevereAlertSeverityId: await this.getMostSevereSeverityId(
        alerts
          .map((alert: Alert): ObjectID | undefined => {
            return alert.alertSeverityId;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          }),
      ),
    };
  }

  /*
   * The alerts an episode was created with, added once it exists (called by
   * AlertEpisodeService.onCreateSuccess, after the episode's privacy rules
   * have run, with the ids validateAlertsForNewEpisode checked). Each is a
   * founding member, as the first alert of an episode a grouping rule opens
   * is: the episode's "created" notification covers it, so its owners are
   * not told again that it was added. The episode's count is written once;
   * its feed entry naming them comes after its "Episode Created" entry
   * (createAlertsAddedFeedItem), and its severity is the one it was created
   * with. Never throws: an alert that cannot be added is logged and left
   * out. Hands back the ids added.
   */
  @CaptureSpan()
  public async addAlertsToNewEpisode(data: {
    projectId: ObjectID;
    alertEpisodeId: ObjectID;
    alertIds: Array<ObjectID>;
    addedByUserId: ObjectID | undefined;
  }): Promise<Array<ObjectID>> {
    const addedAlertIds: Array<ObjectID> = [];

    for (const alertId of data.alertIds) {
      try {
        const wasAdded: boolean = await this.createMemberAddedTogether({
          projectId: data.projectId,
          alertEpisodeId: data.alertEpisodeId,
          alertId: alertId,
          addedByUserId: data.addedByUserId,
          isFounder: true,
        });

        if (wasAdded) {
          addedAlertIds.push(alertId);
        }
      } catch (error) {
        logger.error(
          `AlertEpisodeMemberService could not add alert ${alertId.toString()} to the episode it was created with: ${error}`,
          {
            projectId: data.projectId.toString(),
            alertEpisodeId: data.alertEpisodeId.toString(),
            alertId: alertId.toString(),
          } as LogAttributes,
        );
      }
    }

    await this.updateEpisodeAfterAddingTogether({
      projectId: data.projectId,
      alertEpisodeId: data.alertEpisodeId,
      addedAlertIds: addedAlertIds,
      addedByUserId: data.addedByUserId,
      raiseSeverity: false,
      writeFeedItem: false,
    });

    return addedAlertIds;
  }

  /*
   * The episode's one feed entry - and its one Slack / Microsoft Teams post
   * - for alerts added together: "**3 alerts** added to episode:", then
   * each by its number, and its title unless it is private
   * (EpisodeMembersBatch). Read as root; nothing is written when none of the
   * alerts exists (any more). Never throws.
   */
  @CaptureSpan()
  public async createAlertsAddedFeedItem(data: {
    projectId: ObjectID;
    alertEpisodeId: ObjectID;
    alertIds: Array<ObjectID>;
    addedByUserId: ObjectID | undefined;
  }): Promise<void> {
    if (data.alertIds.length === 0) {
      return;
    }

    try {
      const alerts: Array<Alert> = await AlertService.findBy({
        query: {
          _id: QueryHelper.any(data.alertIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          title: true,
          isPrivate: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const alertById: Map<string, Alert> = new Map();

      for (const alert of alerts) {
        alertById.set(EpisodeMembersAdd.normalizeId(alert._id || ""), alert);
      }

      // In the order they were added.
      const mentions: Array<EpisodeMemberFeedMention> = [];

      for (const alertId of data.alertIds) {
        const alert: Alert | undefined = alertById.get(
          EpisodeMembersAdd.normalizeId(alertId),
        );

        if (alert) {
          mentions.push(describeAlert(alert));
        }
      }

      if (mentions.length === 0) {
        return;
      }

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: data.alertEpisodeId,
        projectId: data.projectId,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.AlertAdded,
        displayColor: Yellow500,
        feedInfoInMarkdown: EpisodeMembersBatch.getAddedFeedMarkdown({
          mentions: mentions,
          nouns: ALERT_NOUNS,
        }),
        userId: data.addedByUserId,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: data.addedByUserId,
        },
      });
    } catch (error) {
      logger.error(
        `AlertEpisodeMemberService could not write the feed entry for alerts added together: ${error}`,
        {
          projectId: data.projectId.toString(),
          alertEpisodeId: data.alertEpisodeId.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * Whether the caller may add alerts to episodes in the project: the
   * member model's create permission, asked of the member the request would
   * write. A refusal names what is missing. Root writes are OneUptime's own.
   */
  private checkCallerMayAddMembers(data: {
    projectId: ObjectID;
    alertEpisodeId: ObjectID;
    alertId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (data.props.isRoot) {
      return;
    }

    const member: Model = new Model();
    member.projectId = data.projectId;
    member.alertEpisodeId = data.alertEpisodeId;
    member.alertId = data.alertId;
    member.addedBy = data.props.userId
      ? AlertEpisodeMemberAddedBy.Manual
      : AlertEpisodeMemberAddedBy.API;

    ModelPermission.checkCreatePermissions(Model, member, data.props);
  }

  /*
   * Why the caller may not add one alert to an episode as a member of their
   * own - what their permission to create members reaches: its labels, its
   * Owned scope (the alerts they or their teams own), its blocks with
   * labels - or null when they may (EpisodeMemberAddScope). The row is
   * asked about as it will be written.
   */
  private async getMemberAddRefusal(data: {
    projectId: ObjectID;
    alertEpisodeId: ObjectID;
    alertId: ObjectID;
    props: DatabaseCommonInteractionProps;
    pendingEpisode?: PendingRecord | undefined;
  }): Promise<string | null> {
    const member: Model = new Model();
    member.projectId = data.projectId;
    member.alertEpisodeId = data.alertEpisodeId;
    member.alertId = data.alertId;

    return await EpisodeMemberAddScope.getRefusal({
      memberService: this,
      member: member,
      props: data.props,
      pendingEpisode: data.pendingEpisode,
    });
  }

  /*
   * The alerts among `alertIds` the caller can see in the project, read as
   * them: privacy, labels and owners decide, as on the alerts list. A read
   * the caller may not make at all finds none.
   */
  private async findAlertIdsCallerCanSee(data: {
    projectId: ObjectID;
    alertIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Set<string>> {
    const alerts: Array<Alert> =
      (await CallerVisibleRead.find(() => {
        return AlertService.findBy({
          query: {
            _id: QueryHelper.any(data.alertIds),
            projectId: data.projectId,
          },
          select: {
            _id: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: data.props,
        });
      })) || [];

    return new Set(
      alerts.map((alert: Alert): string => {
        return EpisodeMembersAdd.normalizeId(alert._id || "");
      }),
    );
  }

  // The alerts among `alertIds` that are in the episode already.
  private async findAlertIdsInEpisode(data: {
    alertEpisodeId: ObjectID;
    alertIds: Array<ObjectID>;
  }): Promise<Set<string>> {
    if (data.alertIds.length === 0) {
      return new Set();
    }

    const members: Array<Model> = await this.findBy({
      query: {
        alertEpisodeId: data.alertEpisodeId,
        alertId: QueryHelper.any(data.alertIds),
      },
      select: {
        alertId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return new Set(
      members.map((member: Model): string => {
        return EpisodeMembersAdd.normalizeId(member.alertId || "");
      }),
    );
  }

  /*
   * One alert added together with others: a member of its own, made through
   * this service's create as OneUptime's write for the person who asked -
   * named as the one who added it - with the episode's side left to the
   * batch. A founding member (the alerts an episode is created with) is
   * marked as covered by the episode's created notification. False when the
   * alert turned out to be in the episode already (two adds racing).
   */
  private async createMemberAddedTogether(data: {
    projectId: ObjectID;
    alertEpisodeId: ObjectID;
    alertId: ObjectID;
    addedByUserId: ObjectID | undefined;
    isFounder: boolean;
  }): Promise<boolean> {
    const member: Model = new Model();
    member.projectId = data.projectId;
    member.alertEpisodeId = data.alertEpisodeId;
    member.alertId = data.alertId;
    member.addedBy = data.addedByUserId
      ? AlertEpisodeMemberAddedBy.Manual
      : AlertEpisodeMemberAddedBy.API;
    member.addedAt = OneUptimeDate.getCurrentDate();

    if (data.addedByUserId) {
      member.addedByUserId = data.addedByUserId;
      member.createdByUserId = data.addedByUserId;
    }

    if (data.isFounder) {
      member.isOwnerNotifiedOfAlertAdded = true;
    }

    try {
      await this.create({
        data: member,
        props: {
          isRoot: true,
        },
        miscDataProps: EpisodeMembersBatch.getMiscDataProps(),
      });

      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === ALERT_ALREADY_IN_EPISODE_MESSAGE
      ) {
        return false;
      }

      throw error;
    }
  }

  /*
   * The episode's side of alerts added together, once for all of them: its
   * count (and a title kept from a template), its last-added time, its one
   * feed entry when asked, then its severity raised to the most severe alert
   * added when asked - as a grouping rule raises it. Nothing when none was
   * added. Never throws: each step is logged if it fails.
   */
  private async updateEpisodeAfterAddingTogether(data: {
    projectId: ObjectID;
    alertEpisodeId: ObjectID;
    addedAlertIds: Array<ObjectID>;
    addedByUserId: ObjectID | undefined;
    raiseSeverity: boolean;
    writeFeedItem: boolean;
  }): Promise<void> {
    if (data.addedAlertIds.length === 0) {
      return;
    }

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      alertEpisodeId: data.alertEpisodeId.toString(),
    };

    try {
      await AlertEpisodeService.updateAlertCount(data.alertEpisodeId);
      await AlertEpisodeService.updateLastAlertAddedAt(data.alertEpisodeId);
    } catch (error) {
      logger.error(
        `Error updating the episode's count after alerts were added together: ${error}`,
        logAttributes,
      );
    }

    /*
     * The entry naming what was added comes before the severity it may
     * raise, so the feed reads what happened, then what that changed.
     */
    if (data.writeFeedItem) {
      await this.createAlertsAddedFeedItem({
        projectId: data.projectId,
        alertEpisodeId: data.alertEpisodeId,
        alertIds: data.addedAlertIds,
        addedByUserId: data.addedByUserId,
      });
    }

    if (data.raiseSeverity) {
      try {
        const alerts: Array<Alert> = await AlertService.findBy({
          query: {
            _id: QueryHelper.any(data.addedAlertIds),
            projectId: data.projectId,
          },
          select: {
            alertSeverityId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        const mostSevereAlertSeverityId: ObjectID | null =
          await this.getMostSevereSeverityId(
            alerts
              .map((alert: Alert): ObjectID | undefined => {
                return alert.alertSeverityId;
              })
              .filter((id: ObjectID | undefined): id is ObjectID => {
                return Boolean(id);
              }),
          );

        if (mostSevereAlertSeverityId) {
          await AlertEpisodeService.updateEpisodeSeverity({
            episodeId: data.alertEpisodeId,
            severityId: mostSevereAlertSeverityId,
            onlyIfHigher: true,
          });
        }
      } catch (error) {
        logger.error(
          `Error raising the episode's severity after alerts were added together: ${error}`,
          logAttributes,
        );
      }
    }
  }

  /*
   * The most severe of these severities: the lowest order, as the project's
   * severity settings list them. Null when none of them is known.
   */
  private async getMostSevereSeverityId(
    severityIds: Array<ObjectID>,
  ): Promise<ObjectID | null> {
    if (severityIds.length === 0) {
      return null;
    }

    const severities: Array<AlertSeverity> = await AlertSeverityService.findBy({
      query: {
        _id: QueryHelper.any(severityIds),
      },
      select: {
        _id: true,
        order: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    let mostSevere: AlertSeverity | null = null;

    for (const severity of severities) {
      if (!severity._id) {
        continue;
      }

      if (
        !mostSevere ||
        (typeof severity.order === "number" &&
          (typeof mostSevere.order !== "number" ||
            severity.order < mostSevere.order))
      ) {
        mostSevere = severity;
      }
    }

    return mostSevere?._id ? new ObjectID(mostSevere._id.toString()) : null;
  }
}

export default new Service();
