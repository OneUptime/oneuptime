import { AppApiHostname } from "../EnvironmentConfig";
import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import { OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import API from "Common/Utils/API";
import Model from "Common/Models/DatabaseModels/Workflow";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    /// save trigger and trigger args.

    if (
      onUpdate.updateBy.data &&
      (onUpdate.updateBy.data as any).graph &&
      (((onUpdate.updateBy.data as any).graph as any)[
        "nodes"
      ] as Array<JSONObject>)
    ) {
      let trigger: NodeDataProp | null = null;

      // check if it has a trigger node.
      for (const node of ((onUpdate.updateBy.data as any).graph as any)[
        "nodes"
      ] as Array<JSONObject>) {
        const nodeData: NodeDataProp = node["data"] as any;
        if (
          nodeData.componentType === ComponentType.Trigger &&
          nodeData.nodeType === NodeType.Node
        ) {
          // found the trigger;
          trigger = nodeData;
        }
      }

      await this.updateOneById({
        id: new ObjectID(onUpdate.updateBy.query._id! as any),
        data: {
          triggerId: trigger?.metadataId || null,
          triggerArguments: trigger?.arguments || {},
        } as any,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }

    await API.post<EmptyResponseData>(
      new URL(
        Protocol.HTTP,
        AppApiHostname,
        new Route("/api/workflow/update/" + onUpdate.updateBy.query._id!),
      ),
      {},
      {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    );

    return onUpdate;
  }
}
export default new Service();
