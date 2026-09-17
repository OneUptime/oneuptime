import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostFeedService from "./DockerHostFeedService";
import { DockerHostFeedEventType } from "../../Models/DatabaseModels/DockerHostFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import Team from "../../Models/DatabaseModels/Team";
import TeamService from "./TeamService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import DockerHostService from "./DockerHostService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
     * to be built from what was read here.
     */
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
      select: {
        dockerHostId: true,
        projectId: true,
        teamId: true,
      },
    });

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
      const dockerHostId: ObjectID | undefined = item.dockerHostId;
      const projectId: ObjectID | undefined = item.projectId;
      const teamId: ObjectID | undefined = item.teamId;

      if (!dockerHostId || !projectId || !teamId) {
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

      await DockerHostFeedService.createDockerHostFeedItem({
        dockerHostId: dockerHostId,
        projectId: projectId,
        dockerHostFeedEventType: DockerHostFeedEventType.OwnerTeamRemoved,
        displayColor: Red500,
        feedInfoInMarkdown: `👨🏻‍👩🏻‍👦🏻 Removed team **${team.name}** as an owner of ${await DockerHostService.getDockerHostMarkdownLink(
          projectId,
          dockerHostId,
        )}.`,
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
    const dockerHostId: ObjectID | undefined = createdItem.dockerHostId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const teamId: ObjectID | undefined = createdItem.teamId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (dockerHostId && teamId && projectId) {
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
        await DockerHostFeedService.createDockerHostFeedItem({
          dockerHostId: dockerHostId,
          projectId: projectId,
          dockerHostFeedEventType: DockerHostFeedEventType.OwnerTeamAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `👨🏻‍👩🏻‍👦🏻 Added team **${team.name}** as an owner of ${await DockerHostService.getDockerHostMarkdownLink(
            projectId,
            dockerHostId,
          )}.`,
          userId: createdByUserId || undefined,
        });
      }
    }

    return createdItem;
  }
}

export default new Service();
