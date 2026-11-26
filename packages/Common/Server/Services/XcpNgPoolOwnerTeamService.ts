import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/XcpNgPoolOwnerTeam";
import XcpNgPoolFeedService from "./XcpNgPoolFeedService";
import { XcpNgPoolFeedEventType } from "../../Models/DatabaseModels/XcpNgPoolFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import Team from "../../Models/DatabaseModels/Team";
import TeamService from "./TeamService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import XcpNgPoolService from "./XcpNgPoolService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * The rows are gone by the time onDeleteSuccess runs, so the feed item has
     * to be built from what was read here: the rows the delete removes, and
     * the delete held to them (findRowsAndHoldDeleteToThem).
     */
    const itemsToDelete: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        xcpNgPoolId: true,
        projectId: true,
        teamId: true,
      },
    );

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
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedByUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    const itemsToDelete: Array<Model> = onDelete.carryForward.itemsToDelete;

    for (const item of itemsToDelete) {
      const xcpNgPoolId: ObjectID | undefined = item.xcpNgPoolId;
      const projectId: ObjectID | undefined = item.projectId;
      const teamId: ObjectID | undefined = item.teamId;

      if (!xcpNgPoolId || !projectId || !teamId) {
        continue;
      }

      const team: Team | null = await TeamService.findOneById({
        id: teamId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!team || !team.name) {
        continue;
      }

      await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
        xcpNgPoolId: xcpNgPoolId,
        projectId: projectId,
        xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.OwnerTeamRemoved,
        displayColor: Red500,
        feedInfoInMarkdown:
          mdText`👨🏻‍👩🏻‍👦🏻 Removed team **${team.name}** as an owner of ${await XcpNgPoolService.getXcpNgPoolMarkdownLink(
            projectId,
            xcpNgPoolId,
          )}.`.toString(),
        userId: deletedByUserId || undefined,
      });
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const xcpNgPoolId: ObjectID | undefined = createdItem.xcpNgPoolId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const teamId: ObjectID | undefined = createdItem.teamId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (xcpNgPoolId && teamId && projectId) {
      const team: Team | null = await TeamService.findOneById({
        id: teamId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (team && team.name) {
        await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
          xcpNgPoolId: xcpNgPoolId,
          projectId: projectId,
          xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.OwnerTeamAdded,
          displayColor: Gray500,
          feedInfoInMarkdown:
            mdText`👨🏻‍👩🏻‍👦🏻 Added team **${team.name}** as an owner of ${await XcpNgPoolService.getXcpNgPoolMarkdownLink(
              projectId,
              xcpNgPoolId,
            )}.`.toString(),
          userId: createdByUserId || undefined,
        });
      }
    }

    return createdItem;
  }
}

export default new Service();
