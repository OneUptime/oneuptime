import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "CommonServer/Services/MonitorService";

export default class ProbeMonitorResponse {
    public static async processProbeResponseArray(monitorId: ObjectID, probeMonitorResponses: Array<ProbeMonitorResponse>): void {
        // save data to Clickhouse.

        // fetch monitor 

        const monitor = await MonitorService.findOneById({
            id: monitorId,
            select: {
                monitorSteps: true,
                monitorType: true
            },
            props: {
                isRoot: true
            }
        });


        if(!monitor){
            throw new BadDataException("Monitor not found");
        }

        // now process probe response monitors
    }
}