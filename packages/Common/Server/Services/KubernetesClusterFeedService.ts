import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import KubernetesClusterFeed, {
  KubernetesClusterFeedEventType,
} from "../../Models/DatabaseModels/KubernetesClusterFeed";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<KubernetesClusterFeed> {
  public constructor() {
    super(KubernetesClusterFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public async createKubernetesClusterFeedItem(data: {
    kubernetesClusterId: ObjectID;
    feedInfoInMarkdown: string;
    kubernetesClusterFeedEventType: KubernetesClusterFeedEventType;
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
      const feed: KubernetesClusterFeed = new KubernetesClusterFeed();

      if (!data.kubernetesClusterId) {
        throw new BadDataException("Kubernetes Cluster ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.kubernetesClusterFeedEventType) {
        throw new BadDataException("Kubernetes Cluster feed event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      feed.displayColor = data.displayColor;
      feed.kubernetesClusterId = data.kubernetesClusterId;
      feed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      feed.kubernetesClusterFeedEventType = data.kubernetesClusterFeedEventType;
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
      logger.error("Error in creating Kubernetes cluster feed", {
        projectId: data.projectId?.toString(),
        kubernetesClusterId: data.kubernetesClusterId?.toString(),
      } as LogAttributes);
      logger.error(e, {
        projectId: data.projectId?.toString(),
        kubernetesClusterId: data.kubernetesClusterId?.toString(),
      } as LogAttributes);

      // we dont throw this error as it is not a critical error
    }
  }
}

export default new Service();
