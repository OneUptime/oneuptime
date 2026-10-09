import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { APP_API_URL } from "Common/UI/Config";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProjectUtil from "Common/UI/Utils/Project";

export default class ProbeUtil {
  /*
   * Every probe this project can monitor with: its own custom probes plus the
   * global ones (which are not project rows, so they come from their own
   * endpoint).
   *
   * A project's probes are read by whoever may pick one - who may read,
   * create or edit monitors, a monitor's probes or network devices among
   * them (Probe's read list). Whoever the permission snapshot says may not
   * is not asked about them, and still gets the global probes, which most
   * monitors run on. A refusal of a list the snapshot says the user may read
   * is an error, and is thrown as one.
   */
  public static async getAllProbes(): Promise<Array<Probe>> {
    // The two lists are independent, so fetch them in parallel.
    const [projectProbeList, globalProbeList]: [
      ListResult<Probe> | null,
      ListResult<Probe>,
    ] = await Promise.all([
      ProbeUtil.getProjectProbeList(),
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

    const projectProbes: Array<Probe> = projectProbeList?.data || [];

    for (const probe of projectProbes) {
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

    return [...projectProbes, ...globalProbeList.data];
  }

  /*
   * The project's own probes, or null for a user who may not list them. The
   * permission snapshot decides once it has landed. Until then - the first
   * paint after a login or a project switch - the list is asked for, and a
   * permission refusal (422) is taken as the answer the snapshot would have
   * given.
   */
  private static async getProjectProbeList(): Promise<ListResult<Probe> | null> {
    const hasSnapshot: boolean = PermissionGate.hasPermissionSnapshot();

    if (
      hasSnapshot &&
      !PermissionGate.check(new Probe(), ModelAction.Read).isAllowed
    ) {
      return null;
    }

    try {
      return await ModelAPI.getList<Probe>({
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
      });
    } catch (err) {
      if (
        !hasSnapshot &&
        err instanceof HTTPErrorResponse &&
        err.statusCode === 422
      ) {
        return null;
      }

      throw err;
    }
  }
}
