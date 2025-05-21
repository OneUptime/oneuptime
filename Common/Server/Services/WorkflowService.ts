import { WorkflowHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import { OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../Types/Workflow/Component";
import API from "../../Utils/API";
import Model from "../../Models/DatabaseModels/Workflow";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
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

    logger.debug("Updating workflow on the workflow service");

    await API.post<EmptyResponseData>(
      new URL(
        Protocol.HTTP,
        WorkflowHostname,
        new Route("/workflow/update/" + onUpdate.updateBy.query._id!),
      ),
      {},
      {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    );

    logger.debug("Updated workflow on the workflow service");

    return onUpdate;
  }
}
export default new Service();
