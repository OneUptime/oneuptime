import { resolveReferenceId } from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * resolveReferenceId feeds the project-scoped FK guard in every create/update
 * hook that carries a cross-project reference (incident state/severity, monitor
 * status, etc.). The same logical reference arrives in several shapes, and the
 * guard silently passes (letting a foreign-project id persist, which then makes
 * that project undeletable) if any shape is read wrong. These tests pin every
 * shape the resolver must understand — especially the bare-uuid-string relation
 * slot, which only becomes a relation entity AFTER onBeforeUpdate runs, so the
 * naive `value?._id` read would miss it.
 */

describe("resolveReferenceId", () => {
  it("returns undefined for null/undefined/empty inputs", () => {
    expect(resolveReferenceId(undefined)).toBeUndefined();
    expect(resolveReferenceId(null)).toBeUndefined();
    expect(resolveReferenceId("")).toBeUndefined();
  });

  it("returns a bare uuid string as-is (the update-path relation slot)", () => {
    const uuid: string = "c3d4e5f6-a7b8-9012-cdef-345678901234";

    expect(resolveReferenceId(uuid)).toBe(uuid);
  });

  it("returns an ObjectID instance unchanged", () => {
    const id: ObjectID = ObjectID.generate();

    expect(resolveReferenceId(id)).toBe(id);
  });

  it("reads the _id string off a relation object", () => {
    const uuid: string = ObjectID.generate().toString();

    expect(resolveReferenceId({ _id: uuid })).toBe(uuid);
  });

  it("reads the id member off a relation object when _id is absent", () => {
    const id: ObjectID = ObjectID.generate();

    expect(resolveReferenceId({ id })).toBe(id);
  });

  it("prefers _id over id when a relation object carries both", () => {
    const idMember: ObjectID = ObjectID.generate();
    const underscoreId: string = ObjectID.generate().toString();

    expect(resolveReferenceId({ _id: underscoreId, id: idMember })).toBe(
      underscoreId,
    );
  });

  it("returns undefined for a relation object that carries neither _id nor id", () => {
    expect(resolveReferenceId({})).toBeUndefined();
    expect(resolveReferenceId({ name: "not a reference" })).toBeUndefined();
  });
});
