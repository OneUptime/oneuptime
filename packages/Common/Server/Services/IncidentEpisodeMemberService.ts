import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import PrivateRecordPermission from "../Types/Database/Permissions/PrivateRecordPermission";
import PrivateRecordWriteCheck from "../Utils/Permission/PrivateRecordWriteCheck";
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
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import { applyIncidentEpisodeRelatedRecordPrivacyFilter } from "../Utils/IncidentEpisode/IncidentEpisodePrivacyFilter";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../Types/JSON";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Model, {
  IncidentEpisodeMemberAddedBy,
} from "../../Models/DatabaseModels/IncidentEpisodeMember";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Yellow500, Green500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import IncidentService from "./IncidentService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../Utils/Markdown/FeedMarkdown";
import FeedApiKeyActorUtil, {
  FeedApiKeyActor,
} from "../Utils/Feed/FeedApiKeyActor";
import EpisodeMembersAdd, {
  EpisodeMembersAddResult,
  INCIDENT_EPISODE_ID_KEY,
  INCIDENT_IDS_KEY,
  INCIDENT_IDS_TO_ADD_KEY,
  INCIDENT_NOT_FOUND_REASON,
  INCIDENT_NOUNS,
  INCIDENT_PRIVATE_REASON,
} from "../../Types/Episode/EpisodeMembersAdd";
import EpisodeMembersBatch, {
  EpisodeMemberFeedMention,
} from "../Utils/Episode/EpisodeMembersBatch";
import EpisodeSingleMembership, {
  INCIDENT_IN_ANOTHER_EPISODE_REASON,
  INCIDENT_SINGLE_MEMBERSHIP,
} from "../../Types/Episode/EpisodeSingleMembership";
import EpisodeSingleMembershipCheck, {
  RecordInAnotherEpisodeException,
} from "../Utils/Episode/EpisodeSingleMembershipCheck";
import ModelPermission from "../Types/Database/Permissions/Index";
import CreateScopeException from "../Types/Database/Permissions/CreateScopeException";
import QueryHelper from "../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import DatabaseService, { PendingRecord } from "./DatabaseService";
import EpisodeMemberAddScope from "../Utils/Episode/EpisodeMemberAddScope";

/*
 * The unique index that lets at most one membership of an incident be its
 * first (the IncidentEpisodeMember model's isFirstMembership): a create that
 * loses a race to it is checked again (Service.create).
 */
export const INCIDENT_FIRST_MEMBERSHIP_INDEX: string =
  "IDX_IncidentEpisodeMember_first_membership";

// What adding an incident to an episode it is in already is refused with.
export const INCIDENT_ALREADY_IN_EPISODE_MESSAGE: string =
  "Incident is already a member of this episode";

/*
 * The incidents to create a new episode with (INCIDENT_IDS_TO_ADD_KEY), as
 * validated before the episode exists, and the most severe of their
 * severities - what the episode takes when its create names none.
 */
export interface IncidentsForNewEpisode {
  incidentIds: Array<ObjectID>;
  mostSevereIncidentSeverityId: ObjectID | null;
}

/*
 * An incident's or an episode's title is plain text - an incident's is typed
 * by whoever declared it, which is anyone holding an incident form's link,
 * and an episode's is often copied from its first incident's - and the feed
 * items below place it into Markdown that the dashboard renders without its
 * safe mode and that is posted to Slack and Teams. It is placed as text
 * (mdText), so "![](https://tracker...)" is not fetched and "[Reset your
 * password](...)" is not a link that hides where it goes, while an ordinary
 * title reads as typed.
 */

// How a feed entry names the incident, or the episode, on the other side.
interface FeedMention {
  // "**Incident INC-42**", or "**Incident INC-42** (private incident)".
  subject: MarkdownText;
  // ": <title>", or nothing for a private one.
  titleSuffix: MarkdownText;
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
   * TWO ADDS OF ONE INCIDENT, AT ONE MOMENT.
   *
   * onBeforeCreate checks the incident's memberships before it adds one, and
   * refuses an incident in another episode while the project allows one episode
   * per incident (EpisodeSingleMembership). Two adds of an incident that is in no
   * episode yet - to two episodes, by a person and the grouping engine, or
   * from two tabs - both found none, and both were added. Each is now its
   * incident's first membership, and the database takes one first membership
   * per incident (INCIDENT_FIRST_MEMBERSHIP_INDEX): the one that loses is refused there.
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
          INCIDENT_FIRST_MEMBERSHIP_INDEX,
        )
      ) {
        throw error;
      }

      logger.debug(
        `Incident added to an episode at the moment another add of it was: checking it again.`,
      );

      return await super.create({
        ...createBy,
        props: props,
        data: BaseModel.fromJSON<Model>(sent, Model) as Model,
      });
    }
  }

  /*
   * On a person's create, the episode and the incident are checked by this
   * service's own hook: read as the caller, so a private one they cannot
   * open, one of another project and one that does not exist all get the
   * same answer. A generic check first would answer the last two in other
   * words than the first. A workflow step acts as a Project Admin of its
   * project (WorkflowPrincipal), so it is read like one. OneUptime's own
   * writes - the grouping engine, adding by hand for the person who asked -
   * are made as root and get the generic check, as every update does (no
   * person may change a member's incident or episode).
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
   * A member row reveals both of its ends, so it is only visible to a user
   * who can see the private incident AND the private episode. The two
   * filters write different keys (incidentId / incidentEpisodeId) and
   * compose. Relation joins (`select: { incident: { title } }`, as the
   * episode's Incidents tab sends) run neither IncidentService's nor
   * IncidentEpisodeService's onBeforeFind, so these are the only thing
   * keeping a private incident's title out of an episode's member list, and
   * a private episode's incidents from anyone who knows its id. This
   * service's own reads are made as root, which neither filter narrows.
   */
  private applyPrivacyFilters<T>(
    query: T,
    props: DatabaseCommonInteractionProps,
  ): T {
    return applyIncidentEpisodeRelatedRecordPrivacyFilter(
      applyIncidentRelatedRecordPrivacyFilter(query, props),
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
      throw new BadDataException(INCIDENT_ALREADY_IN_EPISODE_MESSAGE);
    }

    /*
     * In another episode already, in a project that allows an incident in
     * only one (EpisodeSingleMembership): refused, whoever adds it and
     * however - a person, an API key, a workflow, the grouping engine. After
     * the visibility check, as the duplicate check is: the refusal names
     * only what the caller can see.
     */
    const isFirstMembership: boolean = await this.refuseIfInAnotherEpisode({
      createBy: createBy,
      incidentId: incidentId,
    });

    /*
     * Its first membership when the incident is in no episode now: at most one
     * membership of an incident is, so of two adds of it racing each other the
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
        select: { _id: true, projectId: true, isPrivate: true },
        props: createBy.props,
      });
    });

    if (!episode || !isSameId(episode.projectId, projectId)) {
      throw new BadDataException(
        "The episode to add the incident to does not exist in this project, or you do not have access to it.",
      );
    }

    await this.assertEpisodeReached({
      episode: episode,
      episodeId: data.incidentEpisodeId,
      props: createBy.props,
    });

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

  /*
   * Refuses a member whose incident is in another episode already, when the
   * project allows an incident in only one (EpisodeSingleMembership). It is
   * not in this episode - the duplicate check came first - so any episode
   * it is in is another. The refusal names the incident, and the episode it
   * is in when the caller can see that episode: a private one they cannot
   * open is "another episode". OneUptime's own writes see every episode.
   */
  @CaptureSpan()
  private async refuseIfInAnotherEpisode(data: {
    createBy: CreateBy<Model>;
    incidentId: ObjectID;
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

    // The member rows first: adding an incident in no episode reads no project.
    const latestEpisodeId: ObjectID | null = await this.findLatestEpisodeIdOf({
      projectId: projectId,
      incidentId: data.incidentId,
    });

    if (!latestEpisodeId) {
      return true;
    }

    const isOnlyOneEpisodeAllowed: boolean =
      await EpisodeSingleMembershipCheck.isOn({
        projectId: projectId,
        kind: INCIDENT_SINGLE_MEMBERSHIP,
      });

    if (!isOnlyOneEpisodeAllowed) {
      return false;
    }

    const holdingEpisodeId: ObjectID = latestEpisodeId;

    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        incidentNumber: true,
        incidentNumberWithPrefix: true,
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

    const episode: IncidentEpisode | null = createBy.props.isRoot
      ? await IncidentEpisodeService.findOneById({
          id: holdingEpisodeId,
          select: episodeSelect,
          props: {
            isRoot: true,
          },
        })
      : await CallerVisibleRead.find(() => {
          return IncidentEpisodeService.findOneById({
            id: holdingEpisodeId,
            select: episodeSelect,
            props: createBy.props,
          });
        });

    throw new RecordInAnotherEpisodeException(
      EpisodeSingleMembership.getAddRefusal({
        kind: INCIDENT_SINGLE_MEMBERSHIP,
        recordLabel: EpisodeSingleMembership.getLabel(
          incident?.incidentNumberWithPrefix,
          incident?.incidentNumber,
        ),
        episodeLabel: EpisodeSingleMembership.getLabel(
          episode?.episodeNumberWithPrefix,
          episode?.episodeNumber,
        ),
      }),
    );
  }

  /*
   * The episode that keeps an incident out of every other one: the latest
   * episode it is in, when the project allows an incident in only one
   * episode (EpisodeSingleMembership). Null when it is in no episode, or
   * when the project allows several. The member rows are read first, so
   * the project's switch is read only for an incident that is in an
   * episode - adding one that is in none, the usual case, never reads it.
   */
  @CaptureSpan()
  public async findHoldingEpisodeId(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<ObjectID | null> {
    const latestEpisodeId: ObjectID | null =
      await this.findLatestEpisodeIdOf(data);

    if (!latestEpisodeId) {
      return null;
    }

    const isOnlyOneEpisodeAllowed: boolean =
      await EpisodeSingleMembershipCheck.isOn({
        projectId: data.projectId,
        kind: INCIDENT_SINGLE_MEMBERSHIP,
      });

    return isOnlyOneEpisodeAllowed ? latestEpisodeId : null;
  }

  /*
   * The latest episode an incident is in, by its member rows: null when it is in
   * none. Read as OneUptime - it decides what a write may do.
   */
  @CaptureSpan()
  private async findLatestEpisodeIdOf(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<ObjectID | null> {
    const membership: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        incidentId: data.incidentId,
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

    return membership?.incidentEpisodeId || null;
  }

  /*
   * The incidents among `incidentIds` that are in an episode, when the
   * project allows an incident in only one episode (EpisodeSingleMembership)
   * - the ones no other episode may take. Empty when none is in an episode,
   * or when the project allows several; read like findHoldingEpisodeId,
   * the member rows first.
   */
  @CaptureSpan()
  public async findIncidentIdsHeldInEpisodes(data: {
    projectId: ObjectID;
    incidentIds: Array<ObjectID>;
  }): Promise<Set<string>> {
    if (data.incidentIds.length === 0) {
      return new Set();
    }

    const members: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        incidentId: QueryHelper.any(data.incidentIds),
      },
      select: {
        incidentId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const incidentIdsInAnEpisode: Set<string> = new Set();

    for (const member of members) {
      if (member.incidentId) {
        incidentIdsInAnEpisode.add(
          EpisodeMembersAdd.normalizeId(member.incidentId),
        );
      }
    }

    if (incidentIdsInAnEpisode.size === 0) {
      return incidentIdsInAnEpisode;
    }

    const isOnlyOneEpisodeAllowed: boolean =
      await EpisodeSingleMembershipCheck.isOn({
        projectId: data.projectId,
        kind: INCIDENT_SINGLE_MEMBERSHIP,
      });

    return isOnlyOneEpisodeAllowed ? incidentIdsInAnEpisode : new Set();
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
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

    /*
     * One of several incidents added together (EpisodeMembersBatch): the
     * episode's count, its last-added time and its feed entry are written
     * once, for all of them, by whoever is adding them. The incident's own
     * side - its episode, its feed entry - is written here as always.
     */
    const isAddedTogether: boolean = EpisodeMembersBatch.isAddedTogether({
      props: onCreate.createBy.props,
      miscDataProps: onCreate.createBy.miscDataProps,
    });

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
    if (!isAddedTogether) {
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
    if (!isAddedTogether) {
      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: createdItem.incidentEpisodeId,
        projectId: createdItem.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.IncidentAdded,
        displayColor: Yellow500,
        feedInfoInMarkdown: EpisodeMembersBatch.getAddedFeedMarkdown({
          mentions: [incidentMention],
          nouns: INCIDENT_NOUNS,
        }),
        userId: createdItem.addedByUserId || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    }

    // Create feed item on incident
    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId,
      projectId: createdItem.projectId,
      incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
      displayColor: Yellow500,
      feedInfoInMarkdown:
        mdText`Added to ${episodeMention.subject}${episodeMention.titleSuffix}`.toString(),
      userId: createdItem.addedByUserId || undefined,
      apiKeyActor: FeedApiKeyActorUtil.fromProps(onCreate.createBy.props),
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
        incidentEpisodeId: true,
        incidentId: true,
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
              feedInfoInMarkdown:
                mdText`${incidentMention.subject} removed from episode${incidentMention.titleSuffix}`.toString(),
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
              feedInfoInMarkdown:
                mdText`Removed from ${episodeMention.subject}${episodeMention.titleSuffix}`.toString(),
              apiKeyActor: FeedApiKeyActorUtil.fromProps(
                onDelete.deleteBy.props,
              ),
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

  /*
   * POST /incident-episode-member/add-incidents: several incidents added to
   * an episode in one request (EpisodeMembersAdd) - from the incidents
   * lists' Add to Existing Episode, and from the episode's own Add
   * Incidents.
   *
   * Checked as the caller, before anything is written: that they may add
   * incidents to episodes at all, and that they can see the episode - the
   * whole request is refused otherwise - then each incident. An incident
   * they cannot see is answered like one that does not exist, and is not
   * added; one in the episode already is left as it is; one in another
   * episode, in a project that allows an incident in only one
   * (EpisodeSingleMembership), is not added and says why. Every other is added
   * as a member of its own, through this service's create, so each is the
   * same row, with the same follow-ons on the incident, as an incident added
   * on its own; the episode's side is written once for all of them
   * (addedTogether).
   *
   * The answer names every incident asked for, in the order asked, once.
   */
  @CaptureSpan()
  public async addIncidentsToEpisode(data: {
    incidentEpisodeId: unknown;
    incidentIds: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<EpisodeMembersAddResult> {
    const incidentEpisodeId: ObjectID = EpisodeMembersAdd.parseEpisodeId({
      value: data.incidentEpisodeId,
      key: INCIDENT_EPISODE_ID_KEY,
    });

    const incidentIds: Array<ObjectID> = EpisodeMembersAdd.parseIds({
      value: data.incidentIds,
      key: INCIDENT_IDS_KEY,
      nouns: INCIDENT_NOUNS,
    });

    const projectId: ObjectID | undefined = data.props.tenantId;

    if (!projectId) {
      throw new BadDataException(
        "A project is required to add incidents to an episode.",
      );
    }

    this.checkCallerMayAddMembers({
      projectId: projectId,
      incidentEpisodeId: incidentEpisodeId,
      incidentId: incidentIds[0]!,
      props: data.props,
    });

    const episode: IncidentEpisode | null = await CallerVisibleRead.find(() => {
      return IncidentEpisodeService.findOneById({
        id: incidentEpisodeId,
        select: { _id: true, projectId: true, isPrivate: true },
        props: data.props,
      });
    });

    if (!episode || !isSameId(episode.projectId, projectId)) {
      throw new BadDataException(
        "The episode to add the incidents to does not exist in this project, or you do not have access to it.",
      );
    }

    await this.assertEpisodeReached({
      episode: episode,
      episodeId: incidentEpisodeId,
      props: data.props,
    });

    const {
      visible: visibleIncidentIds,
      outOfReach: incidentIdsOutOfReach,
    }: { visible: Set<string>; outOfReach: Set<string> } =
      await this.findIncidentIdsCallerCanSee({
        projectId: projectId,
        incidentIds: incidentIds,
        props: data.props,
      });

    const incidentIdsInEpisode: Set<string> =
      await this.findIncidentIdsInEpisode({
        incidentEpisodeId: incidentEpisodeId,
        incidentIds: incidentIds.filter((incidentId: ObjectID) => {
          return visibleIncidentIds.has(
            EpisodeMembersAdd.normalizeId(incidentId),
          );
        }),
      });

    /*
     * Of the rest, the ones in another episode already, when the project
     * allows an incident in only one (EpisodeSingleMembership): each is not
     * added, and says why. The others are added as always.
     */
    const incidentIdsInAnotherEpisode: Set<string> =
      await this.findIncidentIdsHeldInEpisodes({
        projectId: projectId,
        incidentIds: incidentIds.filter((incidentId: ObjectID) => {
          const key: string = EpisodeMembersAdd.normalizeId(incidentId);
          return visibleIncidentIds.has(key) && !incidentIdsInEpisode.has(key);
        }),
      });

    /*
     * The API key that asked, when no person did: the entry each incident
     * gets names it, as an incident added on its own through the API does.
     */
    const apiKeyActor: FeedApiKeyActor = FeedApiKeyActorUtil.fromProps(
      data.props,
    );

    const result: EpisodeMembersAddResult = EpisodeMembersAdd.emptyResult();
    const addedIncidentIds: Array<ObjectID> = [];

    for (const incidentId of incidentIds) {
      const key: string = EpisodeMembersAdd.normalizeId(incidentId);

      if (!visibleIncidentIds.has(key)) {
        result.notAdded.push({ id: key, reason: INCIDENT_NOT_FOUND_REASON });
        continue;
      }

      if (incidentIdsOutOfReach.has(key)) {
        result.notAdded.push({ id: key, reason: INCIDENT_PRIVATE_REASON });
        continue;
      }

      if (incidentIdsInEpisode.has(key)) {
        result.alreadyInEpisode.push(key);
        continue;
      }

      if (incidentIdsInAnotherEpisode.has(key)) {
        result.notAdded.push({
          id: key,
          reason: INCIDENT_IN_ANOTHER_EPISODE_REASON,
        });
        continue;
      }

      // One the caller may not add as a member of their own. See the helper.
      const refusal: string | null = await this.getMemberAddRefusal({
        projectId: projectId,
        incidentEpisodeId: incidentEpisodeId,
        incidentId: incidentId,
        props: data.props,
      });

      if (refusal) {
        result.notAdded.push({ id: key, reason: refusal });
        continue;
      }

      try {
        const wasAdded: boolean = await this.createMemberAddedTogether({
          projectId: projectId,
          incidentEpisodeId: incidentEpisodeId,
          incidentId: incidentId,
          addedByUserId: data.props.userId,
          apiKeyActor: apiKeyActor,
          isFounder: false,
        });

        if (wasAdded) {
          result.added.push(key);
          addedIncidentIds.push(incidentId);
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
            ? INCIDENT_IN_ANOTHER_EPISODE_REASON
            : error instanceof Error && error.message
              ? error.message
              : "This incident could not be added to the episode.";

        logger.error(
          `IncidentEpisodeMemberService could not add incident ${key} to episode ${incidentEpisodeId.toString()}: ${message}`,
          {
            projectId: projectId.toString(),
            incidentEpisodeId: incidentEpisodeId.toString(),
            incidentId: key,
          } as LogAttributes,
        );

        result.notAdded.push({ id: key, reason: message });
      }
    }

    await this.updateEpisodeAfterAddingTogether({
      projectId: projectId,
      incidentEpisodeId: incidentEpisodeId,
      addedIncidentIds: addedIncidentIds,
      addedByUserId: data.props.userId,
      raiseSeverity: true,
      writeFeedItem: true,
    });

    return result;
  }

  /*
   * An incident episode created with the incidents it is for
   * (miscDataProps[INCIDENT_IDS_TO_ADD_KEY], see EpisodeMembersAdd): the
   * ids, checked by IncidentEpisodeService.onBeforeCreate before the episode
   * number is taken and before anything is written. Every one must be an
   * incident the caller can see in the project - one that is not refuses
   * the whole create, so no episode is left behind without some of the
   * incidents it was created for - and the caller must be allowed to add
   * incidents to episodes. In a project that allows an incident in only one
   * episode (EpisodeSingleMembership), one that is in an episode already
   * refuses the whole create too, naming the incidents that are. Hands back
   * the ids, each once, and the most severe of the incidents' severities.
   */
  @CaptureSpan()
  public async validateIncidentsForNewEpisode(data: {
    projectId: ObjectID;
    incidentIds: unknown;
    props: DatabaseCommonInteractionProps;
    // The labels the episode is created with, which its members carry too.
    labels?: unknown;
  }): Promise<IncidentsForNewEpisode> {
    const incidentIds: Array<ObjectID> = EpisodeMembersAdd.parseIds({
      value: data.incidentIds,
      key: INCIDENT_IDS_TO_ADD_KEY,
      nouns: INCIDENT_NOUNS,
    });

    this.checkCallerMayAddMembers({
      projectId: data.projectId,
      /*
       * The episode does not exist yet: the permission is the model's, asked
       * of a member that names the first incident.
       */
      incidentEpisodeId: ObjectID.generate(),
      incidentId: incidentIds[0]!,
      props: data.props,
    });

    const incidents: Array<Incident> =
      (await CallerVisibleRead.find(() => {
        return IncidentService.findBy({
          query: {
            _id: QueryHelper.any(incidentIds),
            projectId: data.projectId,
          },
          select: {
            _id: true,
            incidentSeverityId: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
            isPrivate: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: data.props,
        });
      })) || [];

    const visibleIncidentIds: Set<string> = new Set(
      incidents.map((incident: Incident): string => {
        return EpisodeMembersAdd.normalizeId(incident._id || "");
      }),
    );

    const allVisible: boolean = incidentIds.every((incidentId: ObjectID) => {
      return visibleIncidentIds.has(EpisodeMembersAdd.normalizeId(incidentId));
    });

    if (!allVisible) {
      throw new BadDataException(
        "Some of the incidents to add to the episode do not exist in this project, or you do not have access to them.",
      );
    }

    /*
     * A private one the caller sees but whose owners' permissions do not let
     * them add it to an episode refuses the whole create, as one they cannot
     * see does (PrivateRecordPermission).
     */
    const outOfReach: Set<string> =
      await PrivateRecordWriteCheck.findUnreachable({
        modelType: Model,
        type: DatabaseRequestType.Create,
        recordService: IncidentService as unknown as DatabaseService<BaseModel>,
        records: incidents,
        props: data.props,
      });

    if (outOfReach.size > 0) {
      throw new NotAuthorizedException(
        "Some of the incidents to add to the episode are private, and none of the teams of yours that own them may add them to an episode.",
      );
    }

    /*
     * Each one the caller may add as a member of their own, to the episode
     * as it will be saved (its labels): one they may not refuses the whole
     * create, as one they cannot see does. See getMemberAddRefusal.
     */
    const pendingEpisode: PendingRecord =
      EpisodeMemberAddScope.getPendingEpisode({
        episodeModelType: IncidentEpisode,
        labels: data.labels,
      });

    for (const incidentId of incidentIds) {
      const refusal: string | null = await this.getMemberAddRefusal({
        projectId: data.projectId,
        incidentEpisodeId: pendingEpisode.id,
        incidentId: incidentId,
        props: data.props,
        pendingEpisode: pendingEpisode,
      });

      if (refusal) {
        throw new CreateScopeException(refusal);
      }
    }

    /*
     * In an episode already, in a project that allows an incident in only
     * one: the new episode may not take them, so it is not created. Each is
     * named by its number - the caller can see every one of them - in the
     * order asked.
     */
    const incidentIdsInAnEpisode: Set<string> =
      await this.findIncidentIdsHeldInEpisodes({
        projectId: data.projectId,
        incidentIds: incidentIds,
      });

    if (incidentIdsInAnEpisode.size > 0) {
      const incidentById: Map<string, Incident> = new Map();

      for (const incident of incidents) {
        incidentById.set(
          EpisodeMembersAdd.normalizeId(incident._id || ""),
          incident,
        );
      }

      const labels: Array<string | null> = [];

      for (const incidentId of incidentIds) {
        const key: string = EpisodeMembersAdd.normalizeId(incidentId);

        if (!incidentIdsInAnEpisode.has(key)) {
          continue;
        }

        const incident: Incident | undefined = incidentById.get(key);

        labels.push(
          EpisodeSingleMembership.getLabel(
            incident?.incidentNumberWithPrefix,
            incident?.incidentNumber,
          ),
        );
      }

      throw new RecordInAnotherEpisodeException(
        EpisodeSingleMembership.getNewEpisodeRefusal({
          kind: INCIDENT_SINGLE_MEMBERSHIP,
          recordLabels: labels,
        }),
      );
    }

    return {
      incidentIds: incidentIds,
      mostSevereIncidentSeverityId: await this.getMostSevereSeverityId(
        incidents
          .map((incident: Incident): ObjectID | undefined => {
            return incident.incidentSeverityId;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          }),
      ),
    };
  }

  /*
   * The incidents an episode was created with, added once it exists (called
   * by IncidentEpisodeService.onCreateSuccess, after the episode's privacy
   * rules have run, with the ids validateIncidentsForNewEpisode checked).
   * Each is a founding member, as the first incident of an episode a
   * grouping rule opens is: the episode's "created" notification covers it,
   * so its owners are not told again that it was added. The episode's count
   * is written once; its feed entry naming them comes after its "Episode
   * Created" entry (createIncidentsAddedFeedItem), and its severity is the
   * one it was created with. Never throws: an incident that cannot be added
   * is logged and left out. Hands back the ids added.
   */
  @CaptureSpan()
  public async addIncidentsToNewEpisode(data: {
    projectId: ObjectID;
    incidentEpisodeId: ObjectID;
    incidentIds: Array<ObjectID>;
    addedByUserId: ObjectID | undefined;
    apiKeyActor?: FeedApiKeyActor | undefined;
  }): Promise<Array<ObjectID>> {
    const addedIncidentIds: Array<ObjectID> = [];

    for (const incidentId of data.incidentIds) {
      try {
        const wasAdded: boolean = await this.createMemberAddedTogether({
          projectId: data.projectId,
          incidentEpisodeId: data.incidentEpisodeId,
          incidentId: incidentId,
          addedByUserId: data.addedByUserId,
          apiKeyActor: data.apiKeyActor || {},
          isFounder: true,
        });

        if (wasAdded) {
          addedIncidentIds.push(incidentId);
        }
      } catch (error) {
        logger.error(
          `IncidentEpisodeMemberService could not add incident ${incidentId.toString()} to the episode it was created with: ${error}`,
          {
            projectId: data.projectId.toString(),
            incidentEpisodeId: data.incidentEpisodeId.toString(),
            incidentId: incidentId.toString(),
          } as LogAttributes,
        );
      }
    }

    await this.updateEpisodeAfterAddingTogether({
      projectId: data.projectId,
      incidentEpisodeId: data.incidentEpisodeId,
      addedIncidentIds: addedIncidentIds,
      addedByUserId: data.addedByUserId,
      raiseSeverity: false,
      writeFeedItem: false,
    });

    return addedIncidentIds;
  }

  /*
   * The episode's one feed entry - and its one Slack / Microsoft Teams post
   * - for incidents added together: "**3 incidents** added to episode:",
   * then each by its number, and its title unless it is private
   * (EpisodeMembersBatch). Read as root; nothing is written when none of the
   * incidents exists (any more). Never throws.
   */
  @CaptureSpan()
  public async createIncidentsAddedFeedItem(data: {
    projectId: ObjectID;
    incidentEpisodeId: ObjectID;
    incidentIds: Array<ObjectID>;
    addedByUserId: ObjectID | undefined;
  }): Promise<void> {
    if (data.incidentIds.length === 0) {
      return;
    }

    try {
      const incidents: Array<Incident> = await IncidentService.findBy({
        query: {
          _id: QueryHelper.any(data.incidentIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          title: true,
          isPrivate: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const incidentById: Map<string, Incident> = new Map();

      for (const incident of incidents) {
        incidentById.set(
          EpisodeMembersAdd.normalizeId(incident._id || ""),
          incident,
        );
      }

      // In the order they were added.
      const mentions: Array<EpisodeMemberFeedMention> = [];

      for (const incidentId of data.incidentIds) {
        const incident: Incident | undefined = incidentById.get(
          EpisodeMembersAdd.normalizeId(incidentId),
        );

        if (incident) {
          mentions.push(describeIncident(incident));
        }
      }

      if (mentions.length === 0) {
        return;
      }

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: data.incidentEpisodeId,
        projectId: data.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.IncidentAdded,
        displayColor: Yellow500,
        feedInfoInMarkdown: EpisodeMembersBatch.getAddedFeedMarkdown({
          mentions: mentions,
          nouns: INCIDENT_NOUNS,
        }),
        userId: data.addedByUserId,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    } catch (error) {
      logger.error(
        `IncidentEpisodeMemberService could not write the feed entry for incidents added together: ${error}`,
        {
          projectId: data.projectId.toString(),
          incidentEpisodeId: data.incidentEpisodeId.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * Whether the caller may add incidents to episodes in the project: the
   * member model's create permission, asked of the member the request would
   * write. A refusal names what is missing. Root writes are OneUptime's own.
   */
  private checkCallerMayAddMembers(data: {
    projectId: ObjectID;
    incidentEpisodeId: ObjectID;
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (data.props.isRoot) {
      return;
    }

    const member: Model = new Model();
    member.projectId = data.projectId;
    member.incidentEpisodeId = data.incidentEpisodeId;
    member.incidentId = data.incidentId;
    member.addedBy = data.props.userId
      ? IncidentEpisodeMemberAddedBy.Manual
      : IncidentEpisodeMemberAddedBy.API;

    ModelPermission.checkCreatePermissions(Model, member, data.props);
  }

  /*
   * Why the caller may not add one incident to an episode as a member of
   * their own - what their permission to create members reaches: its
   * labels, its Owned scope (the incidents they or their teams own), its
   * blocks with labels - or null when they may (EpisodeMemberAddScope). The
   * row is asked about as it will be written.
   */
  private async getMemberAddRefusal(data: {
    projectId: ObjectID;
    incidentEpisodeId: ObjectID;
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
    pendingEpisode?: PendingRecord | undefined;
  }): Promise<string | null> {
    const member: Model = new Model();
    member.projectId = data.projectId;
    member.incidentEpisodeId = data.incidentEpisodeId;
    member.incidentId = data.incidentId;

    return await EpisodeMemberAddScope.getRefusal({
      memberService: this,
      member: member,
      props: data.props,
      pendingEpisode: data.pendingEpisode,
    });
  }

  /*
   * The incidents among `incidentIds` the caller can see in the project,
   * read as them: privacy, labels and owners decide, as on the incidents
   * list. A read the caller may not make at all finds none.
   */
  /*
   * A PRIVATE EPISODE IS ADDED TO ONLY THROUGH THE TEAMS THAT OWN IT: its
   * members are a part of it, changed only with the permissions of the
   * teams that own it and of the people named as its owners
   * (PrivateRecordPermission). `episode` is the caller's own read of it,
   * isPrivate with it: one that is not private is not asked again.
   */
  private async assertEpisodeReached(data: {
    episode: IncidentEpisode;
    episodeId: ObjectID | string;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const reaches: boolean = await PrivateRecordWriteCheck.reaches({
      modelType: Model,
      type: DatabaseRequestType.Create,
      recordService:
        IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      recordId: new ObjectID(data.episodeId.toString()),
      props: data.props,
      readRecord: data.episode,
    });

    if (!reaches) {
      throw new NotAuthorizedException(
        `You do not have permission to add incidents to this episode. ${PrivateRecordPermission.PRIVATE_WRITE_REASON}`,
      );
    }
  }

  private async findIncidentIdsCallerCanSee(data: {
    projectId: ObjectID;
    incidentIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ visible: Set<string>; outOfReach: Set<string> }> {
    const incidents: Array<Incident> =
      (await CallerVisibleRead.find(() => {
        return IncidentService.findBy({
          query: {
            _id: QueryHelper.any(data.incidentIds),
            projectId: data.projectId,
          },
          select: {
            _id: true,
            isPrivate: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: data.props,
        });
      })) || [];

    return {
      visible: new Set(
        incidents.map((incident: Incident): string => {
          return EpisodeMembersAdd.normalizeId(incident._id || "");
        }),
      ),
      /*
       * Of them, the private ones the caller's add does not reach: a
       * incident's membership is a part of it, changed only with the
       * permissions of the teams that own it (PrivateRecordPermission).
       */
      outOfReach: await PrivateRecordWriteCheck.findUnreachable({
        modelType: Model,
        type: DatabaseRequestType.Create,
        recordService: IncidentService as unknown as DatabaseService<BaseModel>,
        records: incidents,
        props: data.props,
      }),
    };
  }

  // The incidents among `incidentIds` that are in the episode already.
  private async findIncidentIdsInEpisode(data: {
    incidentEpisodeId: ObjectID;
    incidentIds: Array<ObjectID>;
  }): Promise<Set<string>> {
    if (data.incidentIds.length === 0) {
      return new Set();
    }

    const members: Array<Model> = await this.findBy({
      query: {
        incidentEpisodeId: data.incidentEpisodeId,
        incidentId: QueryHelper.any(data.incidentIds),
      },
      select: {
        incidentId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return new Set(
      members.map((member: Model): string => {
        return EpisodeMembersAdd.normalizeId(member.incidentId || "");
      }),
    );
  }

  /*
   * One incident added together with others: a member of its own, made
   * through this service's create as OneUptime's write for the person who
   * asked - named as the one who added it, or the API key that asked when
   * no person did - with the episode's side left to the batch. A founding
   * member (the incidents an episode is created with) is marked as covered
   * by the episode's created notification. False when the incident turned
   * out to be in the episode already (two adds racing).
   */
  private async createMemberAddedTogether(data: {
    projectId: ObjectID;
    incidentEpisodeId: ObjectID;
    incidentId: ObjectID;
    addedByUserId: ObjectID | undefined;
    apiKeyActor: FeedApiKeyActor;
    isFounder: boolean;
  }): Promise<boolean> {
    const member: Model = new Model();
    member.projectId = data.projectId;
    member.incidentEpisodeId = data.incidentEpisodeId;
    member.incidentId = data.incidentId;
    member.addedBy = data.addedByUserId
      ? IncidentEpisodeMemberAddedBy.Manual
      : IncidentEpisodeMemberAddedBy.API;
    member.addedAt = OneUptimeDate.getCurrentDate();

    if (data.addedByUserId) {
      member.addedByUserId = data.addedByUserId;
      member.createdByUserId = data.addedByUserId;
    }

    if (data.isFounder) {
      member.isOwnerNotifiedOfIncidentAdded = true;
    }

    try {
      await this.create({
        data: member,
        props: {
          isRoot: true,
          ...FeedApiKeyActorUtil.toProps(data.apiKeyActor),
        },
        miscDataProps: EpisodeMembersBatch.getMiscDataProps(),
      });

      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === INCIDENT_ALREADY_IN_EPISODE_MESSAGE
      ) {
        return false;
      }

      throw error;
    }
  }

  /*
   * The episode's side of incidents added together, once for all of them:
   * its count (and a title kept from a template), its last-added time, its
   * one feed entry when asked, then its severity raised to the most severe
   * incident added when asked - as a grouping rule raises it (an incident
   * episode's feed then says so). Nothing when none was added. Never
   * throws: each step is logged if it fails.
   */
  private async updateEpisodeAfterAddingTogether(data: {
    projectId: ObjectID;
    incidentEpisodeId: ObjectID;
    addedIncidentIds: Array<ObjectID>;
    addedByUserId: ObjectID | undefined;
    raiseSeverity: boolean;
    writeFeedItem: boolean;
  }): Promise<void> {
    if (data.addedIncidentIds.length === 0) {
      return;
    }

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      incidentEpisodeId: data.incidentEpisodeId.toString(),
    };

    try {
      await IncidentEpisodeService.updateIncidentCount(data.incidentEpisodeId);
      await IncidentEpisodeService.updateLastIncidentAddedAt(
        data.incidentEpisodeId,
      );
    } catch (error) {
      logger.error(
        `Error updating the episode's count after incidents were added together: ${error}`,
        logAttributes,
      );
    }

    /*
     * The entry naming what was added comes before the severity it may
     * raise, so the feed reads what happened, then what that changed.
     */
    if (data.writeFeedItem) {
      await this.createIncidentsAddedFeedItem({
        projectId: data.projectId,
        incidentEpisodeId: data.incidentEpisodeId,
        incidentIds: data.addedIncidentIds,
        addedByUserId: data.addedByUserId,
      });
    }

    if (data.raiseSeverity) {
      try {
        const incidents: Array<Incident> = await IncidentService.findBy({
          query: {
            _id: QueryHelper.any(data.addedIncidentIds),
            projectId: data.projectId,
          },
          select: {
            incidentSeverityId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        const mostSevereIncidentSeverityId: ObjectID | null =
          await this.getMostSevereSeverityId(
            incidents
              .map((incident: Incident): ObjectID | undefined => {
                return incident.incidentSeverityId;
              })
              .filter((id: ObjectID | undefined): id is ObjectID => {
                return Boolean(id);
              }),
          );

        if (mostSevereIncidentSeverityId) {
          await IncidentEpisodeService.updateEpisodeSeverity(
            data.incidentEpisodeId,
            mostSevereIncidentSeverityId,
            true, // onlyIfHigher
          );
        }
      } catch (error) {
        logger.error(
          `Error raising the episode's severity after incidents were added together: ${error}`,
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

    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
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

    let mostSevere: IncidentSeverity | null = null;

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
