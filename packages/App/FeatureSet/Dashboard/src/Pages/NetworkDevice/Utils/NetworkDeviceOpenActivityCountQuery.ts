import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";

/*
 * The queries behind the badges on a network device's Incidents and Alerts
 * menu items (issue #5341): how many of the incidents and alerts linked to
 * the device are still open.
 *
 * They count through the `networkDevices` relation, the same one the two
 * tabs list by, so a badge never disagrees with the tab it sits on.
 *
 * Kept free of React, RouteMap and Navigation so a plain-node test can pin
 * the query shape.
 */

export interface NetworkDeviceOpenActivityCountQueryInput {
  projectId: ObjectID | null;
  networkDeviceId: ObjectID;
  /*
   * The project's unresolved state ids, or null while they are still
   * loading (or could not be loaded).
   */
  unresolvedStateIds: Array<ObjectID> | null;
}

/*
 * Undefined means "do not count yet". CountModelSideMenuItem sends no
 * request and shows no badge for an undefined query, which is right in each
 * case:
 *  - no project in the address: there is nothing to scope the count to;
 *  - states not loaded: an `Includes([])` stand-in would send a request that
 *    is thrown away a moment later, and flash a badge that means nothing;
 *  - a project with no unresolved states at all: nothing can be open.
 */
type CanCountFunction = (
  data: NetworkDeviceOpenActivityCountQueryInput,
) => boolean;

const canCount: CanCountFunction = (
  data: NetworkDeviceOpenActivityCountQueryInput,
): boolean => {
  return Boolean(
    data.projectId &&
      data.unresolvedStateIds &&
      data.unresolvedStateIds.length > 0,
  );
};

export type GetNetworkDeviceOpenIncidentCountQueryFunction = (
  data: NetworkDeviceOpenActivityCountQueryInput,
) => Query<Incident> | undefined;

export const getNetworkDeviceOpenIncidentCountQuery: GetNetworkDeviceOpenIncidentCountQueryFunction =
  (
    data: NetworkDeviceOpenActivityCountQueryInput,
  ): Query<Incident> | undefined => {
    if (!canCount(data)) {
      return undefined;
    }

    return {
      projectId: data.projectId!,
      networkDevices: new Includes([data.networkDeviceId]),
      currentIncidentStateId: new Includes(data.unresolvedStateIds!),
    };
  };

export type GetNetworkDeviceOpenAlertCountQueryFunction = (
  data: NetworkDeviceOpenActivityCountQueryInput,
) => Query<Alert> | undefined;

export const getNetworkDeviceOpenAlertCountQuery: GetNetworkDeviceOpenAlertCountQueryFunction =
  (
    data: NetworkDeviceOpenActivityCountQueryInput,
  ): Query<Alert> | undefined => {
    if (!canCount(data)) {
      return undefined;
    }

    return {
      projectId: data.projectId!,
      networkDevices: new Includes([data.networkDeviceId]),
      currentAlertStateId: new Includes(data.unresolvedStateIds!),
    };
  };
