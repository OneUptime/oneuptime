import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

/**
 * Matches at least one related entity in each group. Groups are combined with
 * AND, while ids within a group are combined with OR. An empty group matches
 * nothing; callers should omit the operator when there are no conditions.
 */
export default class IncludesAnyOfGroups extends QueryOperator<
  Array<Array<string>>
> {
  private readonly _groups: Array<Array<string>>;

  public constructor(groups: Array<Array<string>>) {
    super();

    if (!Array.isArray(groups) || groups.length === 0 || groups.length > 32) {
      throw new BadDataException(
        "IncludesAnyOfGroups requires between 1 and 32 groups.",
      );
    }

    let totalValues: number = 0;
    for (const group of groups) {
      if (!Array.isArray(group) || group.length > 1000) {
        throw new BadDataException(
          "IncludesAnyOfGroups requires arrays of at most 1000 ids.",
        );
      }

      totalValues += group.length;
      for (const value of group) {
        if (
          typeof value !== "string" ||
          value.length === 0 ||
          value.length > 256
        ) {
          throw new BadDataException(
            "IncludesAnyOfGroups ids must be nonempty strings of at most 256 characters.",
          );
        }
      }
    }

    if (totalValues > 10000) {
      throw new BadDataException(
        "IncludesAnyOfGroups supports at most 10000 ids in total.",
      );
    }

    this._groups = groups.map((group: Array<string>) => {
      return [...new Set(group)];
    });
  }

  public get groups(): Array<Array<string>> {
    return this._groups.map((group: Array<string>) => {
      return [...group];
    });
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.IncludesAnyOfGroups,
      value: this.groups,
    };
  }

  public static override fromJSON(json: JSONObject): IncludesAnyOfGroups {
    if (json["_type"] !== ObjectType.IncludesAnyOfGroups) {
      throw new BadDataException("Invalid IncludesAnyOfGroups JSON type.");
    }

    return new IncludesAnyOfGroups(json["value"] as Array<Array<string>>);
  }
}
