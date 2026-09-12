import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import MonitorService from "../../Services/MonitorService";

/**
 * Request-scoped cache for monitor-backed rule criteria. Correlated criteria
 * evaluate several filters against the same monitor, so querying inside every
 * legacy-filter callback otherwise multiplies reads by filters × monitors.
 */
export default class MonitorRuleCriteriaCache {
  private readonly monitorsById: Map<string, Promise<Monitor | null>> = new Map<
    string,
    Promise<Monitor | null>
  >();

  public getMonitor(id: ObjectID): Promise<Monitor | null> {
    const key: string = id.toString();
    const cachedMonitor: Promise<Monitor | null> | undefined =
      this.monitorsById.get(key);

    if (cachedMonitor) {
      return cachedMonitor;
    }

    const monitorPromise: Promise<Monitor | null> = MonitorService.findOneById({
      id: id,
      select: {
        name: true,
        description: true,
        labels: { _id: true },
      },
      props: { isRoot: true },
    });
    this.monitorsById.set(key, monitorPromise);

    return monitorPromise;
  }
}
