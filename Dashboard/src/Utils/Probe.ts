import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import ListResult from 'CommonUI/src/Utils/BaseDatabase/ListResult';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import Probe from 'Model/Models/Probe';
import DashboardNavigation from './Navigation';
import URL from 'Common/Types/API/URL';
import { APP_API_URL } from 'CommonUI/src/Config';

export default class ProbeUtil {
    public static async getAllProbes(): Promise<Array<Probe>> {
        const projectProbeList: ListResult<Probe> = await ModelAPI.getList({
            modelType: Probe,
            query: {
                projectId: DashboardNavigation.getProjectId()?.toString(),
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
                name: true,
                _id: true,
            },
            sort: {},
        });

        const globalProbeList: ListResult<Probe> = await ModelAPI.getList({
            modelType: Probe,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
                name: true,
                _id: true,
            },
            sort: {},
            requestOptions: {
                overrideRequestUrl: URL.fromString(
                    APP_API_URL.toString()
                ).addRoute('/probe/global-probes'),
            },
        });

        return [...projectProbeList.data, ...globalProbeList.data];
    }
}
