import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UniqueColumnsTogether, {
  UniqueColumnsTogetherMetadata,
} from "../../../Types/Database/UniqueColumnsTogether";
import { describe, expect, test } from "@jest/globals";

/*
 * @UniqueColumnsTogether is read off the model PROTOTYPE by
 * DatabaseService.create (see issue #3394), so the ways a prototype value can
 * go wrong are the ways this can: a second decorator overwriting the first, a
 * subclass writing into its parent's list, or a caller's array being mutated
 * after the fact.
 */

describe("UniqueColumnsTogether", () => {
  test("a model without it declares no constraint", () => {
    class Plain extends BaseModel {}

    expect(new Plain().getUniqueColumnsTogether()).toEqual([]);
  });

  test("records the columns and the message", () => {
    @UniqueColumnsTogether(
      ["incidentId", "teamId", "projectId"],
      "This team is already an owner of this incident.",
    )
    class Owner extends BaseModel {}

    expect(new Owner().getUniqueColumnsTogether()).toEqual([
      {
        columnNames: ["incidentId", "teamId", "projectId"],
        errorMessage: "This team is already an owner of this incident.",
      },
    ]);
  });

  test("is stackable - a second declaration does not replace the first", () => {
    @UniqueColumnsTogether(["projectId", "name"], "Name is taken.")
    @UniqueColumnsTogether(["projectId", "slug"], "Slug is taken.")
    class Twice extends BaseModel {}

    const constraints: Array<UniqueColumnsTogetherMetadata> =
      new Twice().getUniqueColumnsTogether();

    expect(constraints).toHaveLength(2);
    expect(
      constraints.map((c: UniqueColumnsTogetherMetadata) => {
        return c.errorMessage;
      }),
    ).toEqual(expect.arrayContaining(["Name is taken.", "Slug is taken."]));
  });

  test("a subclass adds to its own list and leaves the parent's alone", () => {
    @UniqueColumnsTogether(["projectId", "name"], "Name is taken.")
    class Parent extends BaseModel {}

    @UniqueColumnsTogether(["projectId", "slug"], "Slug is taken.")
    class Child extends Parent {}

    expect(new Parent().getUniqueColumnsTogether()).toEqual([
      { columnNames: ["projectId", "name"], errorMessage: "Name is taken." },
    ]);
    expect(new Child().getUniqueColumnsTogether()).toEqual([
      { columnNames: ["projectId", "slug"], errorMessage: "Slug is taken." },
    ]);
  });

  test("an undecorated subclass inherits its parent's constraint", () => {
    @UniqueColumnsTogether(["projectId", "name"], "Name is taken.")
    class Parent extends BaseModel {}

    class Child extends Parent {}

    expect(new Child().getUniqueColumnsTogether()).toHaveLength(1);
  });

  test("keeps its own copy of the column list", () => {
    const columns: Array<string> = ["projectId", "name"];

    @UniqueColumnsTogether(columns, "Name is taken.")
    class Owner extends BaseModel {}

    columns.push("somethingElse");

    expect(new Owner().getUniqueColumnsTogether()[0]!.columnNames).toEqual([
      "projectId",
      "name",
    ]);
  });

  test("is not an own property, so it never ends up in a serialized row", () => {
    @UniqueColumnsTogether(["projectId", "name"], "Name is taken.")
    class Owner extends BaseModel {}

    const model: Owner = new Owner();

    expect(Object.keys(model)).not.toContain("uniqueColumnsTogether");
    expect(JSON.stringify(model)).not.toContain("Name is taken.");
  });
});
