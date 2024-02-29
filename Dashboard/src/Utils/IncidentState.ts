import ObjectID from "Common/Types/ObjectID";
import IncidentState from "Model/Models/IncidentState";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export default class IncidentStateUtil { 
    public static async getUnresolvedIncidentStates(projectId: ObjectID): Promise<IncidentState[]> {
        const incidentStates = await ModelAPI.getList<IncidentState>({
            modelType: IncidentState,
            query: {
                projectId: projectId,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            sort: {
                order: SortOrder.Ascending
            },
            select: {
                _id: true,
                isResolvedState: true,
            }
        });

        const unresolvedIncidentStates = [];

        for(const state of incidentStates.data) {
            if(!state.isResolvedState) {
                unresolvedIncidentStates.push(state);
            }else{
                break; // everything after resolved state is resolved
            }
        }
        
        return unresolvedIncidentStates;
    }
}