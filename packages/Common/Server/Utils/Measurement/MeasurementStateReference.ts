import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The state one end of a measurement is pinned to, when that end is "the
 * moment it entered this state" (State Entered).
 *
 * A measurement model holds the state twice: the relation
 * (startIncidentState) and its id column (startIncidentStateId), and a
 * request may send either. The dashboard's state picker sends the relation
 * - ModelForm turns the picked id into a related row - while the services
 * validated the id column alone. So every measurement set up in the
 * dashboard to start or end at a state was refused with "Pick the state
 * this measurement starts from", the state picked right there on the form.
 * The services read the state through here instead, from whichever of the
 * two a request sent.
 *
 * Read only: the request is saved as it was sent. Writing the id column
 * next to a relation that sets the same database column would have the
 * update name that column twice.
 */
export default class MeasurementStateReference {
  /**
   * The id a value holds: an id (a string or an ObjectID), or a related row
   * ({ _id } or { id }). Undefined for anything else.
   */
  public static getId(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === "string") {
      return value.trim() || undefined;
    }

    if (value instanceof ObjectID) {
      return value.toString().trim() || undefined;
    }

    if (typeof value !== "object") {
      return undefined;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    // An ObjectID as JSON: { _type: "ObjectID", value }.
    if (record["_type"] === ObjectType.ObjectID) {
      return MeasurementStateReference.getId(record["value"]);
    }

    return (
      MeasurementStateReference.getId(record["_id"]) ||
      MeasurementStateReference.getId(record["id"])
    );
  }

  /**
   * The state a new measurement names: its id column, or else its relation.
   */
  public static getStateIdForCreate(data: {
    stateId: unknown;
    state: unknown;
  }): string | undefined {
    return (
      MeasurementStateReference.getId(data.stateId) ||
      MeasurementStateReference.getId(data.state)
    );
  }

  /**
   * The state a measurement names once an update is applied: what the
   * update sets - the id column, or the relation, where null clears it - and
   * otherwise the state it already had.
   */
  public static getStateIdForUpdate(data: {
    update: Record<string, unknown>;
    stateIdKey: string;
    stateKey: string;
    storedStateId: unknown;
  }): string | undefined {
    const sets: (key: string) => boolean = (key: string): boolean => {
      return Object.prototype.hasOwnProperty.call(data.update, key);
    };

    if (sets(data.stateIdKey)) {
      return MeasurementStateReference.getId(data.update[data.stateIdKey]);
    }

    if (sets(data.stateKey)) {
      return MeasurementStateReference.getId(data.update[data.stateKey]);
    }

    return MeasurementStateReference.getId(data.storedStateId);
  }
}
