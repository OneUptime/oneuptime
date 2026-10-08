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
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Model from "../../Models/DatabaseModels/AlertEpisodeMember";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import AlertFeedService from "./AlertFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Yellow500, Green500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import AlertService from "./AlertService";
import AlertEpisodeService from "./AlertEpisodeService";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../Utils/Markdown/FeedMarkdown";

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

  return { subject: subject, titleSuffix: mdText`: ${data.title || "No title"}` };
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
      throw new BadDataException("Alert is already a member of this episode");
    }

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

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
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
    await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
      alertEpisodeId: createdItem.alertEpisodeId,
      projectId: createdItem.projectId,
      alertEpisodeFeedEventType: AlertEpisodeFeedEventType.AlertAdded,
      displayColor: Yellow500,
      feedInfoInMarkdown:
        mdText`${alertMention.subject} added to episode${alertMention.titleSuffix}`.toString(),
      userId: createdItem.addedByUserId || undefined,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: createdItem.addedByUserId || undefined,
      },
    });

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

    // Get the member records before deletion
    const membersToDelete: Model[] = await this.findBy({
      query: deleteBy.query,
      props: {
        isRoot: true,
      },
      select: {
        alertEpisodeId: true,
        alertId: true,
        projectId: true,
      },
      limit: 100,
      skip: 0,
    });

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
}

export default new Service();
