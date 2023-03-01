import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Workflow';
import DatabaseService, { OnUpdate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';
import {
    ComponentType,
    NodeDataProp,
    NodeType,
} from 'Common/Types/Workflow/Component';
import API from 'Common/Utils/API';
import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import URL from 'Common/Types/API/URL';
import Protocol from 'Common/Types/API/Protocol';
import { WorkflowHostname } from '../Config';
import Route from 'Common/Types/API/Route';
import ClusterKeyAuthorization from '../Middleware/ClusterKeyAuthorization';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onUpdateSuccess(
        onUpdate: OnUpdate<Model>,
        _updatedItemIds: ObjectID[]
    ): Promise<OnUpdate<Model>> {
        /// save trigger and trigger args.

        if (
            onUpdate.updateBy.data &&
            (onUpdate.updateBy.data as any).graph &&
            (((onUpdate.updateBy.data as any).graph as any)[
                'nodes'
            ] as Array<JSONObject>)
        ) {
            let trigger: NodeDataProp | null = null;

            // check if it has a trigger node.
            for (const node of ((onUpdate.updateBy.data as any).graph as any)[
                'nodes'
            ] as Array<JSONObject>) {
                const nodeData: NodeDataProp = node['data'] as NodeDataProp;
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
                    triggerId: trigger?.metadataId! || null,
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
                WorkflowHostname,
                new Route('/workflow/update/' + onUpdate.updateBy.query._id!)
            ),
            {},
            {
                ...ClusterKeyAuthorization.getClusterKeyHeaders(),
            }
        );

        return onUpdate;
    }
}
export default new Service();
