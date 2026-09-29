import RelationValueUtil from "../../../../Server/Utils/Database/RelationValueUtil";
import Label from "../../../../Models/DatabaseModels/Label";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The helpers DatabaseService.hasSameValues and AuditLogService lean on to
 * decide whether a relation actually changed.
 *
 * The bug they exist for: a relation value is a model instance, and both a
 * model instance and a plain `{ _id }` object stringify to "[object Object]",
 * so swapping an SLO's labels A,B for C,D compared as unchanged and neither
 * the workflow nor the audit entry fired. What matters is the set of ids a
 * value refers to - in whichever of the shapes the write path hands over.
 */

const ID_A: string = "0193c0de-0000-4aaa-8bbb-00000000000a";
const ID_B: string = "0193c0de-0000-4aaa-8bbb-00000000000b";
const ID_C: string = "0193c0de-0000-4aaa-8bbb-00000000000c";

type MakeLabelFunction = (id: string) => Label;

const makeLabel: MakeLabelFunction = (id: string): Label => {
  const label: Label = new Label();
  label._id = id;
  return label;
};

describe("RelationValueUtil.getRelationId", () => {
  test("reads the id of every shape a relation value arrives in", () => {
    expect(RelationValueUtil.getRelationId(makeLabel(ID_A))).toBe(ID_A);
    expect(RelationValueUtil.getRelationId({ _id: ID_A })).toBe(ID_A);
    expect(RelationValueUtil.getRelationId({ id: ID_A })).toBe(ID_A);
    expect(RelationValueUtil.getRelationId({ _id: new ObjectID(ID_A) })).toBe(
      ID_A,
    );
    expect(RelationValueUtil.getRelationId(ID_A)).toBe(ID_A);
    expect(RelationValueUtil.getRelationId(new ObjectID(ID_A))).toBe(ID_A);
  });

  test("prefers _id over id", () => {
    expect(RelationValueUtil.getRelationId({ _id: ID_A, id: ID_B })).toBe(ID_A);
  });

  test("returns null for values that reference nothing", () => {
    expect(RelationValueUtil.getRelationId(null)).toBeNull();
    expect(RelationValueUtil.getRelationId(undefined)).toBeNull();
    expect(RelationValueUtil.getRelationId("")).toBeNull();
    expect(RelationValueUtil.getRelationId(new Label())).toBeNull();
    expect(RelationValueUtil.getRelationId({ name: "Production" })).toBeNull();
    expect(RelationValueUtil.getRelationId({ _id: "" })).toBeNull();
    expect(RelationValueUtil.getRelationId({ _id: 42 })).toBeNull();
    expect(RelationValueUtil.getRelationId(42)).toBeNull();
    expect(RelationValueUtil.getRelationId(true)).toBeNull();
    expect(RelationValueUtil.getRelationId([ID_A])).toBeNull();
  });
});

describe("RelationValueUtil.getRelationIdSet", () => {
  test("sorts and de-duplicates the ids of a many-to-many value", () => {
    expect(
      RelationValueUtil.getRelationIdSet([
        makeLabel(ID_C),
        { _id: ID_A },
        ID_B,
        new ObjectID(ID_A),
      ]),
    ).toEqual([ID_A, ID_B, ID_C]);
  });

  test("compares ids case-insensitively, as Postgres compares uuids", () => {
    expect(RelationValueUtil.getRelationIdSet([ID_A.toUpperCase()])).toEqual([
      ID_A,
    ]);
  });

  test("wraps a many-to-one value as a single id", () => {
    expect(RelationValueUtil.getRelationIdSet(makeLabel(ID_B))).toEqual([ID_B]);
  });

  test("an empty relation is an empty set, not an unknown one", () => {
    expect(RelationValueUtil.getRelationIdSet([])).toEqual([]);
  });

  test("is unknown when the value is absent or any element is not a reference", () => {
    expect(RelationValueUtil.getRelationIdSet(null)).toBeNull();
    expect(RelationValueUtil.getRelationIdSet(undefined)).toBeNull();
    expect(
      RelationValueUtil.getRelationIdSet([makeLabel(ID_A), new Label()]),
    ).toBeNull();
    expect(
      RelationValueUtil.getRelationIdSet([{ _id: ID_A }, { name: "x" }]),
    ).toBeNull();
  });
});

describe("RelationValueUtil.haveSameRelationIds", () => {
  test("a same-count swap is a change - the case toString() missed", () => {
    expect(
      RelationValueUtil.haveSameRelationIds(
        [makeLabel(ID_A), makeLabel(ID_B)],
        [makeLabel(ID_C), makeLabel(ID_A)],
      ),
    ).toBe(false);

    // The pre-fix comparison really did see these as equal.
    expect(String([makeLabel(ID_A), makeLabel(ID_B)])).toBe(
      String([makeLabel(ID_C), makeLabel(ID_A)]),
    );
  });

  test("the same rows in another order and another shape are unchanged", () => {
    expect(
      RelationValueUtil.haveSameRelationIds(
        [makeLabel(ID_A), makeLabel(ID_B)],
        [{ _id: ID_B }, ID_A.toUpperCase()],
      ),
    ).toBe(true);
  });

  test("adding or removing a row is a change", () => {
    expect(
      RelationValueUtil.haveSameRelationIds(
        [makeLabel(ID_A)],
        [makeLabel(ID_A), makeLabel(ID_B)],
      ),
    ).toBe(false);
    expect(RelationValueUtil.haveSameRelationIds([makeLabel(ID_A)], [])).toBe(
      false,
    );
  });

  test("two empty relations are unchanged", () => {
    expect(RelationValueUtil.haveSameRelationIds([], [])).toBe(true);
  });

  test("many-to-one values compare by their single id", () => {
    expect(RelationValueUtil.haveSameRelationIds(makeLabel(ID_A), ID_A)).toBe(
      true,
    );
    expect(
      RelationValueUtil.haveSameRelationIds(makeLabel(ID_A), makeLabel(ID_B)),
    ).toBe(false);
  });

  test("cannot tell when either side has no ids, so the caller decides", () => {
    expect(
      RelationValueUtil.haveSameRelationIds(undefined, [makeLabel(ID_A)]),
    ).toBeNull();
    expect(
      RelationValueUtil.haveSameRelationIds([makeLabel(ID_A)], null),
    ).toBeNull();
    expect(
      RelationValueUtil.haveSameRelationIds([new Label()], [new Label()]),
    ).toBeNull();
  });
});
