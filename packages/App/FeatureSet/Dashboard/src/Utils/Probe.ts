import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { APP_API_URL } from "Common/UI/Config";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProjectUtil from "Common/UI/Utils/Project";

export default class ProbeUtil {
  /*
   * Every probe this project can monitor with: its own custom probes plus the
   * global ones (which are not project rows, so they come from their own
   * endpoint).
   */
  public static async getAllProbes(): Promise<Array<Probe>> {
    // The two lists are independent, so fetch them in parallel.
    const [projectProbeList, globalProbeList]: [
      ListResult<Probe>,
      ListResult<Probe>,
    ] = await Promise.all([
      ModelAPI.getList<Probe>({
        modelType: Probe,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
          _id: true,
          shouldAutoEnableProbeOnNewMonitors: true,
        },
        sort: {},
      }),
      ModelAPI.getList<Probe>({
        modelType: Probe,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
          _id: true,
          shouldAutoEnableProbeOnNewMonitors: true,
        },
        sort: {},
        requestOptions: {
          overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
            "/probe/global-probes",
          ),
        },
      }),
    ]);

    for (const probe of projectProbeList.data) {
      probe.isGlobalProbe = false;
    }

    /*
     * The global-probes endpoint does not select isGlobalProbe, but every row
     * it returns is one by definition - and callers need the flag to know
     * which probes a project's "disable global probes" setting applies to.
     */
    for (const probe of globalProbeList.data) {
      probe.isGlobalProbe = true;
    }

    return [...projectProbeList.data, ...globalProbeList.data];
  }
}
