import { ServiceLevelObjectiveFeedEventType } from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import Team from "../../Models/DatabaseModels/Team";
import { Gray500, Red500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import logger, { LogAttributes } from "../Utils/Logger";
import SloFeedUtil from "../Utils/Slo/SloFeedUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import TeamService from "./TeamService";

/*
 * The team twin of ServiceLevelObjectiveOwnerUserService: who put which team
 * on the hook for this SLO, and who took it off. Team names are escaped - the
 * feed renders without safe mode - and a feed failure is logged rather than
 * thrown, because the owner row has already been written or deleted.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * The rows are gone by the time onDeleteSuccess runs, so the feed item has
     * to be built from what was read here. The read only feeds the feed, so a
     * failure must not block the delete itself. It runs before permissions
     * are applied, hence the tenant pin (see SloFeedUtil).
     */
    let itemsToDelete: Array<Model> = [];

    try {
      itemsToDelete = await this.findBy({
        query: SloFeedUtil.getTenantPinnedQuery({
          query: deleteBy.query,
          tenantId: deleteBy.props.tenantId,
        }),
        limit: deleteBy.limit,
        skip: deleteBy.skip,
        props: {
          isRoot: true,
        },
        select: {
          // Matched against the ids the delete really removed.
          _id: true,
          serviceLevelObjectiveId: true,
          projectId: true,
          teamId: true,
        },
      });
    } catch (err) {
      logger.error(
        `Error reading SLO owner teams before delete for the SLO feed: ${err}`,
      );
    }

    return {
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
      deleteBy: deleteBy,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedByUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    // Only the owner teams this delete really removed (see SloFeedUtil).
    const itemsToDelete: Array<Model> = SloFeedUtil.getRowsActuallyDeleted({
      rows:
        (onDelete.carryForward?.itemsToDelete as Array<Model> | undefined) ||
        [],
      deletedIds: itemIdsBeforeDelete,
    });

    for (const item of itemsToDelete) {
      const serviceLevelObjectiveId: ObjectID | undefined =
        item.serviceLevelObjectiveId;
      const projectId: ObjectID | undefined = item.projectId;
      const teamId: ObjectID | undefined = item.teamId;

      if (!serviceLevelObjectiveId || !projectId || !teamId) {
        continue;
      }

      try {
        const teamName: string | null = await this.getEscapedTeamName(teamId);

        if (!teamName) {
          continue;
        }

        await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
          {
            serviceLevelObjectiveId: serviceLevelObjectiveId,
            projectId: projectId,
            serviceLevelObjectiveFeedEventType:
              ServiceLevelObjectiveFeedEventType.OwnerTeamRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👨🏻‍👩🏻‍👦🏻 Removed team **${teamName}** as an owner of ${await ServiceLevelObjectiveService.getSloMarkdownLink(
              {
                projectId: projectId,
                sloId: serviceLevelObjectiveId,
              },
            )}.`,
            userId: deletedByUserId || undefined,
          },
        );
      } catch (err) {
        logger.error(
          `Error writing the owner-team-removed feed item for SLO ${serviceLevelObjectiveId.toString()}: ${err}`,
          { projectId: projectId.toString() } as LogAttributes,
        );
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const serviceLevelObjectiveId: ObjectID | undefined =
      createdItem.serviceLevelObjectiveId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const teamId: ObjectID | undefined = createdItem.teamId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (!serviceLevelObjectiveId || !teamId || !projectId) {
      return createdItem;
    }

    try {
      const teamName: string | null = await this.getEscapedTeamName(teamId);

      if (!teamName) {
        return createdItem;
      }

      await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
        {
          serviceLevelObjectiveId: serviceLevelObjectiveId,
          projectId: projectId,
          serviceLevelObjectiveFeedEventType:
            ServiceLevelObjectiveFeedEventType.OwnerTeamAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `👨🏻‍👩🏻‍👦🏻 Added team **${teamName}** as an owner of ${await ServiceLevelObjectiveService.getSloMarkdownLink(
            {
              projectId: projectId,
              sloId: serviceLevelObjectiveId,
            },
          )}.`,
          userId: createdByUserId || undefined,
        },
      );
    } catch (err) {
      logger.error(
        `Error writing the owner-team-added feed item for SLO ${serviceLevelObjectiveId.toString()}: ${err}`,
        { projectId: projectId.toString() } as LogAttributes,
      );
    }

    return createdItem;
  }

  // Null when the team is gone or has no name, so no half-empty item is posted.
  private async getEscapedTeamName(teamId: ObjectID): Promise<string | null> {
    const team: Team | null = await TeamService.findOneById({
      id: teamId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    const teamName: string = escapeMarkdownInline(team?.name || "").trim();

    return teamName || null;
  }
}

export default new Service();
