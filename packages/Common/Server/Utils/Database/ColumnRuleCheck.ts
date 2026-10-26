import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseService from "../../Services/DatabaseService";
import UpdateBy from "../../Types/Database/UpdateBy";

/*
 * A RULE OVER A FEW COLUMNS OF A RECORD, HELD BY THE API AS THE FORM HOLDS IT.
 *
 * Some settings are two columns that mean something only together, and one
 * pair of them means nothing at all: a scheduled maintenance reminder rule
 * that waits for its event to start and stops when it starts, or an on-call
 * policy that says it repeats 0 times. The Dashboard's forms ask one plain
 * question and can never write such a pair; everything else that writes the
 * record - the API, Terraform, MCP, a workflow - goes through its service,
 * which holds it to the same rule here:
 *
 *   - a create is judged as the record it makes: what it writes, with the
 *     rule reading a column it does not write as the column's default;
 *   - an update that writes one of the rule's columns is judged as each
 *     record it writes will be: what it writes over the record as stored
 *     (read the way every hook reads an update's rows,
 *     DatabaseService.findRowsAndHoldUpdateToThem). An update that writes
 *     none of them is not judged at all.
 *
 * A record stored before its service held the rule keeps working as it did,
 * and stays editable: an update that leaves the rule's columns as they are
 * stored - a rename, or Terraform sending back the values it read - saves.
 * Only an update that changes them must leave values the rule allows.
 *
 * The refusal is a BadDataException, so the API answers 400 with the rule's
 * own words.
 */

export interface ColumnRule {
  // The columns the rule reads, as the model names them.
  columns: ReadonlyArray<string>;
  /*
   * Why these values cannot be saved, or null when they can. A column the
   * values do not have - not written, and not stored - is the column's
   * default, as the rule itself reads it.
   */
  getRefusal: (values: Record<string, unknown>) => string | null;
}

const asRecord: (value: unknown) => Record<string, unknown> = (
  value: unknown,
): Record<string, unknown> => {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
};

/*
 * Whether two values of one column are the same value, as the database
 * would store them: a count sent as text is its number, and nothing and
 * null are both no value.
 */
const isSameValue: (a: unknown, b: unknown) => boolean = (
  a: unknown,
  b: unknown,
): boolean => {
  if ((a === null || a === undefined) && (b === null || b === undefined)) {
    return true;
  }

  if (a === b) {
    return true;
  }

  const isNumeric: (value: unknown) => boolean = (value: unknown): boolean => {
    return (
      typeof value === "number" ||
      (typeof value === "string" &&
        value.trim().length > 0 &&
        Number.isFinite(Number(value)))
    );
  };

  if (isNumeric(a) && isNumeric(b)) {
    return Number(a) === Number(b);
  }

  return false;
};

export default class ColumnRuleCheck {
  // The rule's columns a write writes: present in its data, null included.
  public static getWrittenColumns(
    data: unknown,
    rule: ColumnRule,
  ): Array<string> {
    const values: Record<string, unknown> = asRecord(data);

    return rule.columns.filter((column: string): boolean => {
      return values[column] !== undefined;
    });
  }

  // A new record, as its create writes it.
  public static checkCreate(data: unknown, rule: ColumnRule): void {
    const values: Record<string, unknown> = asRecord(data);
    const picked: Record<string, unknown> = {};

    for (const column of rule.columns) {
      if (values[column] !== undefined) {
        picked[column] = values[column];
      }
    }

    const refusal: string | null = rule.getRefusal(picked);

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }

  /*
   * An update, as each record it writes will be. The records are read only
   * when the update writes one of the rule's columns.
   */
  public static async checkUpdate<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
    rule: ColumnRule;
  }): Promise<void> {
    const written: Record<string, unknown> = asRecord(data.updateBy.data);
    const writtenColumns: Array<string> = this.getWrittenColumns(
      written,
      data.rule,
    );

    if (writtenColumns.length === 0) {
      return;
    }

    const select: Record<string, boolean> = {};

    for (const column of data.rule.columns) {
      select[column] = true;
    }

    const stored: Array<TModel> =
      await data.service.findRowsAndHoldUpdateToThem(
        data.updateBy,
        select as never,
      );

    for (const row of stored) {
      const storedValues: Record<string, unknown> = asRecord(row);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      for (const column of data.rule.columns) {
        if (storedValues[column] !== undefined) {
          before[column] = storedValues[column];
        }

        const value: unknown = writtenColumns.includes(column)
          ? written[column]
          : storedValues[column];

        if (value !== undefined) {
          after[column] = value;
        }
      }

      const refusal: string | null = data.rule.getRefusal(after);

      if (!refusal) {
        continue;
      }

      // Stored that way already, and left as it is: it saves as it did.
      const isLeftAsStored: boolean = data.rule.columns.every(
        (column: string): boolean => {
          return isSameValue(after[column], before[column]);
        },
      );

      if (isLeftAsStored) {
        continue;
      }

      throw new BadDataException(refusal);
    }
  }
}
