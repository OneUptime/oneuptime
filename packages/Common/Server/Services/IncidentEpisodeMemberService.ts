import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CallerVisibleRead from "../Utils/Database/CallerVisibleRead";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Model from "../../Models/DatabaseModels/IncidentEpisodeMember";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Yellow500, Green500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import { escapeMarkdownValue } from "../../Utils/Markdown/MarkdownEscape";
import IncidentService from "./IncidentService";
import IncidentEpisodeService from "./IncidentEpisodeService";

/*
 * An incident's or an episode's title is plain text - an incident's is typed
 * by whoever declared it, which is anyone holding an incident form's link,
 * and an episode's is often copied from its first incident's - and the feed
 * items below place it into Markdown that the dashboard renders without its
 * safe mode and that is posted to Slack and Teams. Escaped as MarkdownEscape
 * says a title must be (as the incident's own "Incident Created" item does),
 * so "![](https://tracker...)" is not fetched and "[Reset your password](...)"
 * is not a link that hides where it goes, while an ordinary title reads as
 * typed.
 */
type GetFeedTitleFunction = (title: string | undefined | null) => string;

const getFeedTitle: GetFeedTitleFunction = (
  title: string | undefined | null,
): string => {
  return escapeMarkdownValue(title || "No title");
};

// How a feed entry names the incident, or the episode, on the other side.
interface FeedMention {
  // "**Incident INC-42**", or "**Incident INC-42** (private incident)".
  subject: string;
  // ": <title>", or nothing for a private one.
  titleSuffix: string;
}

/*
 * Each side's entry is read by its own side's audience: the episode's feed
 * and Slack / Microsoft Teams channels by whoever can see the episode, the
 * incident's feed by whoever can see the incident. So a private end's title
 * never goes into the other side's entry - not even when both are private,
 * because the two can have different owners - as IncidentAlertService does
 * for an alert linked to an incident. Its number is kept, so the entry still
 * says what happened.
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
  const subject: string = `**${data.label}**`;

  if (data.isPrivate) {
    return {
      subject: `${subject} (private ${data.privateNoun})`,
      titleSuffix: "",
    };
  }

  return { subject: subject, titleSuffix: `: ${getFeedTitle(data.title)}` };
};

type DescribeIncidentFunction = (incident: Incident | null) => FeedMention;

const describeIncident: DescribeIncidentFunction = (
  incident: Incident | null,
): FeedMention => {
  return describeFeedMention({
    label: `Incident ${incident?.incidentNumberWithPrefix || "#" + (incident?.incidentNumber || "N/A")}`,
    title: incident?.title,
    isPrivate: incident?.isPrivate === true,
    privateNoun: "incident",
  });
};

type DescribeEpisodeFunction = (episode: IncidentEpisode | null) => FeedMention;

const describeEpisode: DescribeEpisodeFunction = (
  episode: IncidentEpisode | null,
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
   * On a person's create, the episode and the incident are checked by this
   * service's own hook: read as the caller, so a private one they cannot
   * open, one of another project and one that does not exist all get the
   * same answer. A generic check first would answer the last two in other
   * words than the first. OneUptime's own writes - the grouping engine,
   * adding by hand for the person who asked - and workflows write as root,
   * and get the generic check, as every update does (no person may change a
   * member's incident or episode).
   */
  protected override getRelationsCheckedByService(
    write?: ProjectReferenceWrite,
  ): Array<string> {
    if (write && (write.kind === "update" || write.props.isRoot)) {
      return [];
    }

    return ["incidentEpisode", "incident"];
  }

  /*
   * A person may only add an incident they can see to an episode they can
   * see. The foreign keys only require the rows to exist, and
   * @CanAccessIfCanReadOn is not applied on create, so without this a member
   * could add a private incident they cannot open to an episode by its id -
   * and the episode's feed would then show its title - or add to a private
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

    // A reference arrives as `incidentId` or as `incident: { _id }`.
    const incidentEpisodeId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["incidentEpisodeId", "incidentEpisode"],
      "episode",
    );

    const incidentId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["incidentId", "incident"],
      "incident",
    );

    if (!incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is required");
    }

    if (!incidentId) {
      throw new BadDataException("incidentId is required");
    }

    // The ids checked below are the only ones that can reach the insert.
    RelationIdUtil.stamp(
      data,
      ["incidentEpisodeId", "incidentEpisode"],
      incidentEpisodeId,
    );
    RelationIdUtil.stamp(data, ["incidentId", "incident"], incidentId);

    if (
      !createBy.props.isRoot &&
      createBy.data.isOwnerNotifiedOfIncidentAdded !== undefined
    ) {
      throw new BadDataException(
        "isOwnerNotifiedOfIncidentAdded cannot be set directly",
      );
    }

    if (!createBy.props.isRoot) {
      await this.checkCallerCanSeeBothEnds({
        createBy: createBy,
        incidentEpisodeId: incidentEpisodeId,
        incidentId: incidentId,
      });
    }

    // Check if this incident is already in the episode
    const existingMember: Model | null = await this.findOneBy({
      query: {
        incidentEpisodeId: incidentEpisodeId,
        incidentId: incidentId,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    if (existingMember) {
      throw new BadDataException(
        "Incident is already a member of this episode",
      );
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
     * If this is the very first incident in the episode (the founder), the
     * "episode created" notification already covers it. Mark the member as
     * "already notified" so the IncidentAdded-to-episode cron skips it. This
     * avoids double-notifying owners when an episode is born with its first
     * incident.
     */
    if (createBy.data.isOwnerNotifiedOfIncidentAdded === undefined) {
      const existingMemberCount: PositiveNumber = await this.countBy({
        query: {
          incidentEpisodeId: incidentEpisodeId,
        },
        props: {
          isRoot: true,
        },
      });

      if (existingMemberCount.toNumber() === 0) {
        createBy.data.isOwnerNotifiedOfIncidentAdded = true;
      }
    }

    return { createBy, carryForward: null };
  }

  /*
   * Reads the episode and the incident as the caller, so privacy, label and
   * owner scoping apply exactly as they do on their own pages, and pins both
   * to the member's project: the request's tenant, the only project the
   * caller was checked in. A caller without read access at all gets the same
   * answer as one asking for a record that does not exist.
   */
  @CaptureSpan()
  private async checkCallerCanSeeBothEnds(data: {
    createBy: CreateBy<Model>;
    incidentEpisodeId: ObjectID;
    incidentId: ObjectID;
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

    const episode: IncidentEpisode | null = await CallerVisibleRead.find(() => {
      return IncidentEpisodeService.findOneById({
        id: data.incidentEpisodeId,
        select: { _id: true, projectId: true },
        props: createBy.props,
      });
    });

    if (!episode || !isSameId(episode.projectId, projectId)) {
      throw new BadDataException(
        "The episode to add the incident to does not exist in this project, or you do not have access to it.",
      );
    }

    const incident: Incident | null = await CallerVisibleRead.find(() => {
      return IncidentService.findOneById({
        id: data.incidentId,
        select: { _id: true, projectId: true },
        props: createBy.props,
      });
    });

    if (!incident || !isSameId(incident.projectId, projectId)) {
      throw new BadDataException(
        "The incident to add does not exist in this project, or you do not have access to it.",
      );
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is required");
    }

    if (!createdItem.incidentId) {
      throw new BadDataException("incidentId is required");
    }

    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    // Update incident's episode reference
    await IncidentService.updateOneById({
      id: createdItem.incidentId,
      data: {
        incidentEpisodeId: createdItem.incidentEpisodeId,
      },
      props: {
        isRoot: true,
      },
    });

    // Update episode's incidentCount and lastIncidentAddedAt
    try {
      await IncidentEpisodeService.updateIncidentCount(
        createdItem.incidentEpisodeId!,
      );
      await IncidentEpisodeService.updateLastIncidentAddedAt(
        createdItem.incidentEpisodeId!,
      );
    } catch (error) {
      logger.error(
        `Error updating episode counts in IncidentEpisodeMemberService.onCreateSuccess: ${error}`,
      );
    }

    // Get incident details for feed
    const incident: Incident | null = await IncidentService.findOneById({
      id: createdItem.incidentId,
      select: {
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        title: true,
        isPrivate: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Get episode details for feed
    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneById({
        id: createdItem.incidentEpisodeId,
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

    const incidentMention: FeedMention = describeIncident(incident);
    const episodeMention: FeedMention = describeEpisode(episode);

    // Create feed item on episode
    await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
      incidentEpisodeId: createdItem.incidentEpisodeId,
      projectId: createdItem.projectId,
      incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.IncidentAdded,
      displayColor: Yellow500,
      feedInfoInMarkdown: `${incidentMention.subject} added to episode${incidentMention.titleSuffix}`,
      userId: createdItem.addedByUserId || undefined,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: createdItem.addedByUserId || undefined,
      },
    });

    // Create feed item on incident
    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId,
      projectId: createdItem.projectId,
      incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
      displayColor: Yellow500,
      feedInfoInMarkdown: `Added to ${episodeMention.subject}${episodeMention.titleSuffix}`,
      userId: createdItem.addedByUserId || undefined,
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Get the member records before deletion
    const membersToDelete: Model[] = await this.findBy({
      query: deleteBy.query,
      props: {
        isRoot: true,
      },
      select: {
        incidentEpisodeId: true,
        incidentId: true,
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
        if (member.incidentId) {
          /*
           * Point the incident at the latest episode it is still a member of
           * (it can be in more than one, so leaving one must not unlink it
           * from another), or at none. None must be null: an update skips a
           * column given as undefined.
           */
          const remainingMember: Model | null = await this.findOneBy({
            query: {
              incidentId: member.incidentId,
            },
            select: {
              incidentEpisodeId: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
          });

          await IncidentService.updateOneById({
            id: member.incidentId,
            data: {
              incidentEpisodeId: remainingMember?.incidentEpisodeId || null,
            },
            props: {
              isRoot: true,
            },
          });

          // Get incident details for feed
          const incident: Incident | null = await IncidentService.findOneById({
            id: member.incidentId,
            select: {
              incidentNumber: true,
              incidentNumberWithPrefix: true,
              title: true,
              isPrivate: true,
            },
            props: {
              isRoot: true,
            },
          });

          // Create feed item for removal
          if (member.incidentEpisodeId && member.projectId) {
            // Get episode details for feed
            const episode: IncidentEpisode | null =
              await IncidentEpisodeService.findOneById({
                id: member.incidentEpisodeId,
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

            const incidentMention: FeedMention = describeIncident(incident);
            const episodeMention: FeedMention = describeEpisode(episode);

            // Create feed item on episode
            await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
              incidentEpisodeId: member.incidentEpisodeId,
              projectId: member.projectId,
              incidentEpisodeFeedEventType:
                IncidentEpisodeFeedEventType.IncidentRemoved,
              displayColor: Green500,
              feedInfoInMarkdown: `${incidentMention.subject} removed from episode${incidentMention.titleSuffix}`,
              workspaceNotification: {
                sendWorkspaceNotification: true,
              },
            });

            // Create feed item on incident
            await IncidentFeedService.createIncidentFeedItem({
              incidentId: member.incidentId,
              projectId: member.projectId,
              incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
              displayColor: Green500,
              feedInfoInMarkdown: `Removed from ${episodeMention.subject}${episodeMention.titleSuffix}`,
            });
          }
        }

        if (member.incidentEpisodeId) {
          // Update episode's incidentCount
          await IncidentEpisodeService.updateIncidentCount(
            member.incidentEpisodeId,
          );
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public async getIncidentsInEpisode(episodeId: ObjectID): Promise<ObjectID[]> {
    const members: Model[] = await this.findBy({
      query: {
        incidentEpisodeId: episodeId,
      },
      props: {
        isRoot: true,
      },
      select: {
        incidentId: true,
      },
      limit: 1000,
      skip: 0,
    });

    return members
      .filter((m: Model) => {
        return m.incidentId;
      })
      .map((m: Model) => {
        return m.incidentId!;
      });
  }

  @CaptureSpan()
  public async isIncidentInEpisode(
    incidentId: ObjectID,
    episodeId: ObjectID,
  ): Promise<boolean> {
    const member: Model | null = await this.findOneBy({
      query: {
        incidentId: incidentId,
        incidentEpisodeId: episodeId,
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
