import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * How the Top Functions tile ranks, in the Profiler's own three ways:
 *
 *   self   the time (or memory) in each function's own code;
 *   total  each function and everything it calls;
 *   own    only the application's own functions, each with the library,
 *          runtime and system code it calls - what a change to it can win
 *          back ("Your code").
 */
export type DashboardProfileTopFunctionsRank = "self" | "total" | "own";

/*
 * The functions that take the most of a kind of profile in the dashboard's
 * time range, ranked, each one click from the Profiler.
 */
export default interface DashboardProfileTopFunctionsComponent
  extends BaseComponent {
  componentType: DashboardComponentType.ProfileTopFunctions;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    /*
     * The service (or host, cluster, ...) whose profiles to read, as the
     * flame graph tile reads it. Left out, every profiled service, or the
     * ones the dashboard's service variable picks.
     */
    serviceId?: string | undefined;
    // What to analyze: a kind of profile. Left out, CPU time.
    profileKind?: string | undefined;
    // How the functions are ranked. Left out, by Self.
    rankBy?: DashboardProfileTopFunctionsRank | undefined;
    // How many functions the tile lists: 1 to 50, 10 when left out.
    maxRows?: number | undefined;
  };
}
