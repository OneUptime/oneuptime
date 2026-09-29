import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import RelationSelect from "../../../../Server/Types/Database/RelationSelect";
import Select from "../../../../Server/Types/Database/Select";
import SelectUtil from "../../../../Server/Types/Database/SelectUtil";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, it } from "@jest/globals";

/*
 * SelectUtil.sanitizeSelect walks the top level of a caller-supplied select and
 * splits it into two shapes TypeORM needs kept apart: the scalar `select` (left
 * as-is) and a `relationSelect` naming which relations to join. A key is a
 * relation when model.isEntityColumn(key) is true - that is, its column
 * metadata type is Entity or EntityArray.
 *
 * For every relation key it does two things regardless of what the caller
 * asked for:
 *   - records `relationSelect[key] = true`, and
 *   - rewrites `select[key]` to an object that ALWAYS carries `_id: true`.
 *
 * The forced `_id: true` is deliberate and security-relevant: the source
 * comment says a whole-object relation select is narrowed to just the id, and
 * the id is merged in AFTER the caller's own keys so it cannot be turned off.
 * Non-relation keys are never touched and never appear in relationSelect. The
 * `select` object is MUTATED in place and returned; relationSelect is fresh.
 *
 * These models are used as fixtures because their column metadata is stable:
 *   - OnCallDutyPolicyEscalationRuleSchedule: `project` /
 *     `onCallDutyPolicySchedule` are Entity relations, `projectId` /
 *     `onCallDutyPolicyScheduleId` / `_id` are scalar ObjectID columns. It has
 *     no `name` column, so `name` is used below only as the unknown-column case.
 *   - Monitor: `labels` / `dependsOnMonitors` are EntityArray relations and
 *     `name` is a real scalar column, covering the second entity enum value.
 */

type SanitizeResult<TBaseModel extends BaseModel> = {
  select: Select<TBaseModel>;
  relationSelect: RelationSelect<TBaseModel>;
};

describe("SelectUtil.sanitizeSelect - relation key set to a boolean", () => {
  it("replaces `true` on a relation with an id-only object", () => {
    /*
     * The else branch: the value is not an object, so spreading it contributes
     * nothing and the relation collapses to exactly `{ _id: true }`.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      project: true,
    };

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({ project: { _id: true } });
  });

  it("names that relation in relationSelect", () => {
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      project: true,
    };

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.relationSelect).toEqual({ project: true });
  });
});

describe("SelectUtil.sanitizeSelect - relation key set to an object", () => {
  it("keeps the caller's inner keys and adds _id", () => {
    /*
     * The object branch: the requested inner keys survive and `_id: true` is
     * merged alongside them. Inner keys are never validated by sanitizeSelect -
     * only top-level keys are checked against the model - so `name` here rides
     * through untouched even on a model whose relation happens to expose it.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      onCallDutyPolicySchedule: { name: true },
    } as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({
      onCallDutyPolicySchedule: { name: true, _id: true },
    });
    expect(result.relationSelect).toEqual({ onCallDutyPolicySchedule: true });
  });

  it("forces _id back on even when the caller set it false", () => {
    /*
     * Precedence: `_id: true` is spread in AFTER the caller's object, so an
     * explicit `_id: false` is overwritten rather than honoured. This is the
     * security guarantee - a relation read cannot suppress the joined id.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      onCallDutyPolicySchedule: { _id: false },
    } as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({
      onCallDutyPolicySchedule: { _id: true },
    });
  });

  it("leaves an already-correct id-only object idempotent", () => {
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      onCallDutyPolicySchedule: { _id: true },
    } as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({
      onCallDutyPolicySchedule: { _id: true },
    });
    expect(result.relationSelect).toEqual({ onCallDutyPolicySchedule: true });
  });
});

describe("SelectUtil.sanitizeSelect - non-relation keys", () => {
  it("leaves scalar columns exactly as passed", () => {
    /*
     * projectId and _id are ObjectID columns, not Entity/EntityArray, so
     * isEntityColumn is false and the branch is skipped entirely.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      projectId: true,
      _id: true,
    } as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({ projectId: true, _id: true });
  });

  it("never lists a scalar column in relationSelect", () => {
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      projectId: true,
      _id: true,
    } as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.relationSelect).toEqual({});
  });
});

describe("SelectUtil.sanitizeSelect - empty and mixed selects", () => {
  it("returns empty shapes for an empty select", () => {
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {};

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({});
    expect(result.relationSelect).toEqual({});
  });

  it("transforms relations and passes scalars through in one call", () => {
    /*
     * A realistic select: a scalar, a boolean relation, and an object relation
     * together. Each key follows its own branch and the results coexist.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      projectId: true,
      project: true,
      onCallDutyPolicySchedule: { _id: false },
    } as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({
      projectId: true,
      project: { _id: true },
      onCallDutyPolicySchedule: { _id: true },
    });
    expect(result.relationSelect).toEqual({
      project: true,
      onCallDutyPolicySchedule: true,
    });
  });

  it("lists exactly the relation keys, and only those, in relationSelect", () => {
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      projectId: true,
      project: true,
      onCallDutyPolicyScheduleId: true,
      onCallDutyPolicySchedule: { _id: true },
    } as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    const relationKeys: Array<string> = Object.keys(
      result.relationSelect as Record<string, unknown>,
    ).sort();

    expect(relationKeys).toEqual(["onCallDutyPolicySchedule", "project"]);
  });
});

describe("SelectUtil.sanitizeSelect - object identity and mutation", () => {
  it("mutates and returns the very select object it was handed", () => {
    /*
     * The returned `select` is the same reference, not a copy - callers rely on
     * the input being rewritten in place.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      project: true,
    };

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toBe(input);
    expect((input as Record<string, unknown>)["project"]).toEqual({
      _id: true,
    });
  });

  it("builds relationSelect as a fresh object distinct from select", () => {
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      project: true,
    };

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.relationSelect).not.toBe(result.select);
    expect(result.relationSelect).not.toBe(input);
  });
});

describe("SelectUtil.sanitizeSelect - typeof edge cases on relation values", () => {
  it("treats a null relation value as the object branch", () => {
    /*
     * `typeof null === "object"`, so null takes the object branch. Spreading
     * null yields nothing, leaving `{ _id: true }` - the relation is still
     * joined, not dropped.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      project: null,
    } as unknown as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({ project: { _id: true } });
    expect(result.relationSelect).toEqual({ project: true });
  });

  it("treats a numeric relation value as the non-object branch", () => {
    /*
     * `typeof 5 === "number"` takes the else branch; spreading a number adds no
     * keys, so the result is the same id-only object as the boolean case.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      project: 5,
    } as unknown as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    const result: SanitizeResult<OnCallDutyPolicyEscalationRuleSchedule> =
      SelectUtil.sanitizeSelect(OnCallDutyPolicyEscalationRuleSchedule, input);

    expect(result.select).toEqual({ project: { _id: true } });
    expect(result.relationSelect).toEqual({ project: true });
  });
});

describe("SelectUtil.sanitizeSelect - EntityArray relations", () => {
  it("handles a boolean EntityArray relation like any other relation", () => {
    /*
     * `labels` is an EntityArray column on Monitor. isEntityColumn returns true
     * for both Entity and EntityArray, so the same collapse-to-id happens.
     */
    const input: Select<Monitor> = {
      name: true,
      labels: true,
    } as Select<Monitor>;

    const result: SanitizeResult<Monitor> = SelectUtil.sanitizeSelect(
      Monitor,
      input,
    );

    expect(result.select).toEqual({
      name: true,
      labels: { _id: true },
    });
    expect(result.relationSelect).toEqual({ labels: true });
  });

  it("merges _id into an object-valued EntityArray relation", () => {
    const input: Select<Monitor> = {
      dependsOnMonitors: { name: true },
    } as Select<Monitor>;

    const result: SanitizeResult<Monitor> = SelectUtil.sanitizeSelect(
      Monitor,
      input,
    );

    expect(result.select).toEqual({
      dependsOnMonitors: { name: true, _id: true },
    });
    expect(result.relationSelect).toEqual({ dependsOnMonitors: true });
  });
});

describe("SelectUtil.sanitizeSelect - unknown column error path", () => {
  it("throws BadDataException for a key that is not a column on the model", () => {
    /*
     * isEntityColumn throws when a key has no column metadata, and
     * sanitizeSelect checks every top-level key, so an unknown column fails the
     * whole call. `name` is not a column on this model, which makes it the
     * unknown-key case here.
     */
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      name: true,
    } as unknown as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    expect(() => {
      return SelectUtil.sanitizeSelect(
        OnCallDutyPolicyEscalationRuleSchedule,
        input,
      );
    }).toThrow(BadDataException);
  });

  it("reports the offending column name in the error message", () => {
    const input: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
      totallyMadeUpColumn: true,
    } as unknown as Select<OnCallDutyPolicyEscalationRuleSchedule>;

    expect(() => {
      return SelectUtil.sanitizeSelect(
        OnCallDutyPolicyEscalationRuleSchedule,
        input,
      );
    }).toThrow("TableColumnMetadata not found for totallyMadeUpColumn column");
  });
});
