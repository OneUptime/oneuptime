import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { useOutletContext } from "react-router-dom";

/*
 * What every tab of a Cloud row's page shares: which kind of row it is.
 *
 * The CloudResource table holds both cloud environments and the resources
 * discovered from cloud monitoring (CloudResourceKind), and they share one
 * route tree - the same id opens either. The layout reads the kind once and
 * hands it down, so the side menu, the title and the tabs that differ
 * (Overview, Metrics, Settings, Documentation, Delete) agree without each
 * fetching it.
 */
export interface CloudResourceViewOutletContext {
  cloudResourceKind: CloudResourceKind;
}

/*
 * The kind the layout read. A tab rendered outside the layout (a test, or
 * a route mounted elsewhere) reads as an environment, which is what every
 * row was before resources existed.
 */
export function useCloudResourceViewContext(): CloudResourceViewOutletContext {
  const context: CloudResourceViewOutletContext | undefined | null =
    useOutletContext<CloudResourceViewOutletContext | undefined | null>();

  return {
    cloudResourceKind:
      context?.cloudResourceKind || CloudResourceKind.Environment,
  };
}
