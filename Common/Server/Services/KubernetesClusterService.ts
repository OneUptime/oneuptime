import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/KubernetesCluster";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async findOrCreateByClusterIdentifier(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
  }): Promise<Model> {
    // Try to find existing cluster
    const existingCluster: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        clusterIdentifier: data.clusterIdentifier,
      },
      select: {
        _id: true,
        projectId: true,
        clusterIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingCluster) {
      return existingCluster;
    }

    // Create new cluster
    const newCluster: Model = new Model();
    newCluster.projectId = data.projectId;
    newCluster.name = data.clusterIdentifier;
    newCluster.clusterIdentifier = data.clusterIdentifier;
    newCluster.otelCollectorStatus = "connected";
    newCluster.lastSeenAt = OneUptimeDate.getCurrentDate();

    const createdCluster: Model = await this.create({
      data: newCluster,
      props: {
        isRoot: true,
      },
    });

    return createdCluster;
  }

  @CaptureSpan()
  public async updateLastSeen(clusterId: ObjectID): Promise<void> {
    await this.updateOneById({
      id: clusterId,
      data: {
        lastSeenAt: OneUptimeDate.getCurrentDate(),
        otelCollectorStatus: "connected",
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async markDisconnectedClusters(): Promise<void> {
    const fiveMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -5,
    );

    const connectedClusters: Array<Model> = await this.findBy({
      query: {
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(fiveMinutesAgo),
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const cluster of connectedClusters) {
      if (cluster._id) {
        await this.updateOneById({
          id: new ObjectID(cluster._id.toString()),
          data: {
            otelCollectorStatus: "disconnected",
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }
}

export default new Service();
