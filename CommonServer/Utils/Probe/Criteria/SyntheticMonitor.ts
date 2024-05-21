import { CheckOn, CriteriaFilter } from 'Common/Types/Monitor/CriteriaFilter';
import SyntheticMonitorResponse from 'Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse';
import CustomCodeMonitoringCriteria from './CustomCodeMonitorCriteria';

export default class SyntheticMonitoringCriteria {
    public static async isMonitorInstanceCriteriaFilterMet(input: {
        monitorResponse: Array<SyntheticMonitorResponse>;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        
        for(const syntheticMonitorResponse of input.monitorResponse) {


            // check custom code monitoring criteria first 

            const result = CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
                monitorResponse: syntheticMonitorResponse,
                criteriaFilter: input.criteriaFilter
            })

            if(result) {
                return result;
            }


            // check browser type and screen type. 

            

        }


        return null;
    }
}
