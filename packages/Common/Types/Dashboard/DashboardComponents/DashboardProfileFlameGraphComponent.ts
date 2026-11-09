import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * The Profiler's flame graph as a dashboard tile: every profile of one
 * service (or of every profiled service) in the dashboard's time range,
 * merged into one graph.
 */
export default interface DashboardProfileFlameGraphComponent
  extends BaseComponent {
  componentType: DashboardComponentType.ProfileFlameGraph;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    /*
     * The service - or host, cluster, container host - whose profiles to
     * read: the id the Profiler's own address calls serviceId. Left out,
     * every profiled service, or the ones the dashboard's service variable
     * picks.
     */
    serviceId?: string | undefined;
    /*
     * What to analyze: a kind of profile ("cpu", "wall", "memory",
     * "allocations", "locks", "goroutines"). Left out, CPU time.
     */
    profileKind?: string | undefined;
  };
}
