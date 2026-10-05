import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RelationIdUtil from "../Database/RelationIdUtil";

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
 * Both are read, and a request naming two different states - or a state
 * and a clear - is refused, as every reference is
 * (RelationIdUtil.readConsistent): the two are one database column, and
 * which of them is stored depends on the shape of the write.
 *
 * Read only: the request is saved as it was sent.
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
   * The state a new measurement names, under either of its names: the id
   * column or the relation.
   */
  public static getStateIdForCreate(data: {
    stateId: unknown;
    state: unknown;
    // How a refusal names the two: "startIncidentStateId", "startIncidentState".
    stateIdKey?: string | undefined;
    stateKey?: string | undefined;
  }): string | undefined {
    return MeasurementStateReference.readAgreeing([
      { key: data.stateIdKey || "stateId", value: data.stateId },
      { key: data.stateKey || "state", value: data.state },
    ]);
  }

  /**
   * The state a measurement names once an update is applied: what the
   * update sets - under either name, where null clears it - and otherwise
   * the state it already had.
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

    if (!sets(data.stateIdKey) && !sets(data.stateKey)) {
      return MeasurementStateReference.getId(data.storedStateId);
    }

    return MeasurementStateReference.readAgreeing([
      { key: data.stateIdKey, value: data.update[data.stateIdKey] },
      { key: data.stateKey, value: data.update[data.stateKey] },
    ]);
  }

  /*
   * The one state the names a request sent hold, or undefined when they
   * hold none (or clear it), read by RelationIdUtil.readConsistent - the
   * rule every reference is read by: two different states, or a state
   * beside a clear, are refused, and the same id in any case is one id.
   * Each value is first put in a shape readConsistent reads: its id (getId
   * also reads an ObjectID as JSON), or null when it holds none.
   */
  private static readAgreeing(
    names: Array<{ key: string; value: unknown }>,
  ): string | undefined {
    const payload: Record<string, unknown> = {};

    for (const name of names) {
      if (name.value !== undefined) {
        payload[name.key] = MeasurementStateReference.getId(name.value) ?? null;
      }
    }

    const id: ObjectID | null = RelationIdUtil.readConsistent(
      payload,
      names.map((name: { key: string }): string => {
        return name.key;
      }),
      "State",
    );

    return id ? id.toString() : undefined;
  }
}
