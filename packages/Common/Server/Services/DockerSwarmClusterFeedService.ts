import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import DockerSwarmClusterFeed, {
  DockerSwarmClusterFeedEventType,
} from "../../Models/DatabaseModels/DockerSwarmClusterFeed";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<DockerSwarmClusterFeed> {
  public constructor() {
    super(DockerSwarmClusterFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public async createDockerSwarmClusterFeedItem(data: {
    dockerSwarmClusterId: ObjectID;
    feedInfoInMarkdown: string;
    dockerSwarmClusterFeedEventType: DockerSwarmClusterFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
  }): Promise<void> {
    /*
     * A feed item is a side effect of the thing that actually happened. It must
     * never be able to fail the write it is describing, so everything here is
     * swallowed and logged rather than thrown - same contract as
     * MonitorFeedService.
     */
    try {
      const feed: DockerSwarmClusterFeed = new DockerSwarmClusterFeed();

      if (!data.dockerSwarmClusterId) {
        throw new BadDataException("Docker Swarm Cluster ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.dockerSwarmClusterFeedEventType) {
        throw new BadDataException(
          "Docker Swarm Cluster feed event is required",
        );
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      feed.displayColor = data.displayColor;
      feed.dockerSwarmClusterId = data.dockerSwarmClusterId;
      feed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      feed.dockerSwarmClusterFeedEventType =
        data.dockerSwarmClusterFeedEventType;
      feed.projectId = data.projectId;
      feed.postedAt = data.postedAt || OneUptimeDate.getCurrentDate();

      if (data.userId) {
        feed.userId = data.userId;
      }

      if (data.moreInformationInMarkdown) {
        feed.moreInformationInMarkdown = data.moreInformationInMarkdown;
      }

      await this.create({
        data: feed,
        props: {
          isRoot: true,
        },
      });
    } catch (e) {
      logger.error("Error in creating Docker Swarm cluster feed", {
        projectId: data.projectId?.toString(),
        dockerSwarmClusterId: data.dockerSwarmClusterId?.toString(),
      } as LogAttributes);
      logger.error(e, {
        projectId: data.projectId?.toString(),
        dockerSwarmClusterId: data.dockerSwarmClusterId?.toString(),
      } as LogAttributes);

      // we dont throw this error as it is not a critical error
    }
  }
}

export default new Service();
