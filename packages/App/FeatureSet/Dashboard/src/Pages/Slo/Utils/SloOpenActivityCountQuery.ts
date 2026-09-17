import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";

/*
 * The queries behind the badges on the SLO side menu's Alerts and Incidents
 * items: how many of the records this SLO's burn rate rules raised are still
 * open.
 *
 * They count through the `serviceLevelObjectives` relation, the same one the
 * two tabs list, so a badge can never disagree with the tab it sits on. The
 * relation is written by the burn-rate worker, and the migration that added
 * it back-filled every alert and incident raised before it existed.
 *
 * Kept free of React, RouteMap and Navigation so a plain-node test can pin
 * the query shape.
 */

export interface SloOpenActivityCountQueryInput {
  projectId: ObjectID | null;
  sloId: ObjectID;
  /*
   * The project's unresolved state ids, or null while they are still
   * loading (or could not be loaded).
   */
  unresolvedStateIds: Array<ObjectID> | null;
}

/*
 * Undefined means "do not count yet". CountModelSideMenuItem issues no request
 * and shows no badge for an undefined query, which is right in each case:
 *  - no project in the URL: there is nothing to scope the count to;
 *  - states not loaded: an `Includes([])` placeholder would fire a request
 *    that is thrown away a moment later, and flash a badge that means nothing;
 *  - a project with no unresolved states at all: nothing can be open, so a
 *    request would only confirm it.
 */
type CanCountFunction = (data: SloOpenActivityCountQueryInput) => boolean;

const canCount: CanCountFunction = (
  data: SloOpenActivityCountQueryInput,
): boolean => {
  return Boolean(
    data.projectId &&
      data.unresolvedStateIds &&
      data.unresolvedStateIds.length > 0,
  );
};

export type GetSloOpenIncidentCountQueryFunction = (
  data: SloOpenActivityCountQueryInput,
) => Query<Incident> | undefined;

export const getSloOpenIncidentCountQuery: GetSloOpenIncidentCountQueryFunction =
  (data: SloOpenActivityCountQueryInput): Query<Incident> | undefined => {
    if (!canCount(data)) {
      return undefined;
    }

    return {
      projectId: data.projectId!,
      serviceLevelObjectives: new Includes([data.sloId]),
      currentIncidentStateId: new Includes(data.unresolvedStateIds!),
    };
  };

export type GetSloOpenAlertCountQueryFunction = (
  data: SloOpenActivityCountQueryInput,
) => Query<Alert> | undefined;

export const getSloOpenAlertCountQuery: GetSloOpenAlertCountQueryFunction = (
  data: SloOpenActivityCountQueryInput,
): Query<Alert> | undefined => {
  if (!canCount(data)) {
    return undefined;
  }

  return {
    projectId: data.projectId!,
    serviceLevelObjectives: new Includes([data.sloId]),
    currentAlertStateId: new Includes(data.unresolvedStateIds!),
  };
};
