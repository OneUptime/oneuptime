import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { APP_API_URL } from "Common/UI/Config";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProjectUtil from "Common/UI/Utils/Project";

export default class ProbeUtil {
  public static async getAllProbes(): Promise<Array<Probe>> {
    const projectProbeList: ListResult<Probe> = await ModelAPI.getList({
      modelType: Probe,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
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
        overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
          "/probe/global-probes",
        ),
      },
    });

    return [...projectProbeList.data, ...globalProbeList.data];
  }
}
