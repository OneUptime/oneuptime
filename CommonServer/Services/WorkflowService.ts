import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Workflow';
import DatabaseService, { OnUpdate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';
import { ComponentType, NodeDataProp, NodeType } from "Common/Types/Workflow/Component";


export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }


    protected override async onUpdateSuccess(onUpdate: OnUpdate<Model>, _updatedItemIds: ObjectID[]): Promise<OnUpdate<Model>> {
        

        /// save trigger and trigger args. 

        let trigger: NodeDataProp | null = null;
        
        if (onUpdate.updateBy.data && (onUpdate.updateBy.data as any).graph && ((onUpdate.updateBy.data as any).graph as any)['nodes'] as Array<JSONObject>) {
            // check if it has a trigger node. 
            for (const node of ((onUpdate.updateBy.data as any).graph as any)['nodes'] as Array<JSONObject>) {
                const nodeData = node["data"] as NodeDataProp;
                if(nodeData.componentType === ComponentType.Trigger && nodeData.nodeType === NodeType.Node){
                    // found the trigger; 
                    trigger = nodeData;
                }
            }
        }

        await this.updateOneById({
            id: new ObjectID(onUpdate.updateBy.query._id! as any), 
            data: {
                triggerId: trigger?.metadataId!,
                triggerArguments: trigger?.arguments || {}
            } as any,
            props: {
                isRoot: true, 
                ignoreHooks: true, 
            }
        });

        return onUpdate;
    }
}
export default new Service();
