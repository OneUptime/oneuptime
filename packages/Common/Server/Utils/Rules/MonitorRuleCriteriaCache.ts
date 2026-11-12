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

  /*
   * Hands the cache a monitor read already, with the columns getMonitor
   * reads (name, description, labels): a reader that matches the rules
   * against many monitors it has read (WhoIsToldService.resolveProject)
   * then reads none of them again.
   */
  public seed(monitor: Monitor): void {
    const key: string | undefined = monitor.id?.toString();

    if (!key) {
      return;
    }

    this.monitorsById.set(key, Promise.resolve(monitor));
  }

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
