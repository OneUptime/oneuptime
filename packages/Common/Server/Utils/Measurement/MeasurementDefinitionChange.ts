import MeasurementStateReference from "./MeasurementStateReference";

/*
 * Whether an update changes what a measurement measures.
 *
 * Changing a measurement's start, end, unit or whether it is on rewrites its
 * history: every incident is recomputed by the backfill worker. An update
 * that only names those columns does not change them, and the dashboard's
 * edit form names every one of them on every save - a rename included - so
 * a column being present is not enough: its value has to be different from
 * the one stored. Otherwise renaming a measurement recomputed every incident
 * of the project.
 */
export interface MeasurementPickedStateColumns {
  // The id column, startIncidentStateId.
  stateIdKey: string;
  // The relation, startIncidentState.
  stateKey: string;
}

export default class MeasurementDefinitionChange {
  // Empty, null and missing are the same: nothing set.
  private static normalize(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value.trim();
    }

    return String(value);
  }

  public static isChanged(data: {
    update: Record<string, unknown>;
    stored: Record<string, unknown>;
    // Compared as they are: anchor types, roles, occurrences, isEnabled, unit.
    columns: Array<string>;
    // Compared by the state they name, however the update names it.
    pickedStates: Array<MeasurementPickedStateColumns>;
  }): boolean {
    const sets: (key: string) => boolean = (key: string): boolean => {
      return Object.prototype.hasOwnProperty.call(data.update, key);
    };

    for (const column of data.columns) {
      if (
        sets(column) &&
        MeasurementDefinitionChange.normalize(data.update[column]) !==
          MeasurementDefinitionChange.normalize(data.stored[column])
      ) {
        return true;
      }
    }

    for (const pickedState of data.pickedStates) {
      if (!sets(pickedState.stateIdKey) && !sets(pickedState.stateKey)) {
        continue;
      }

      const updatedStateId: string =
        MeasurementStateReference.getStateIdForUpdate({
          update: data.update,
          stateIdKey: pickedState.stateIdKey,
          stateKey: pickedState.stateKey,
          storedStateId: data.stored[pickedState.stateIdKey],
        }) || "";

      const storedStateId: string =
        MeasurementStateReference.getId(data.stored[pickedState.stateIdKey]) ||
        "";

      if (updatedStateId !== storedStateId) {
        return true;
      }
    }

    return false;
  }
}
