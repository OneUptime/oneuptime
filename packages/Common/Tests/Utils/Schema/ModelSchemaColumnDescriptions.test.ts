import { getOpenApiMetadata } from "@asteasolutions/zod-to-openapi";
import { ZodType } from "zod";
import { ModelSchema, ModelSchemaType } from "../../../Utils/Schema/ModelSchema";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";

/*
 * A column's description in the spec is its own words, then who may read
 * and write it: "Date and Time when the object was created. Permissions -
 * Create: [...], Read: [...], Update: [...]". The two used to be joined with
 * ". " whatever the words ended with, and most of them end with a full stop
 * of their own: 12,833 of the spec's 21,861 column descriptions read
 * "created.. Permissions - ..." (13,518 of 22,072 when this test was
 * written). The API reference, MCP and anyone reading the spec saw it.
 */

type ModelType = new () => DatabaseBaseModel;

const PERMISSIONS: string =
  "Permissions - Create: [Project Owner], Read: [Project Member], Update: [Project Owner]";

// Every description of a schema's columns, by column, as the spec has it.
function getColumnDescriptions(
  schema: ModelSchemaType,
): Array<[string, string]> {
  const shape: Record<string, ZodType> = (
    schema as unknown as { shape: Record<string, ZodType> }
  ).shape;

  return Object.entries(shape)
    .map(([name, column]: [string, ZodType]): [string, string] => {
      const description: unknown = getOpenApiMetadata(column)?.description;
      return [name, typeof description === "string" ? description : ""];
    })
    .filter(([, description]: [string, string]) => {
      return description.length > 0;
    });
}

// Punctuation directly before " Permissions - ": a sentence ended twice.
function endsTwiceBeforePermissions(description: string): boolean {
  const index: number = description.indexOf(" Permissions - ");

  if (index < 2) {
    return false;
  }

  const last: string = description.charAt(index - 1);
  const beforeLast: string = description.charAt(index - 2);

  return last === "." && [".", "!", "?"].includes(beforeLast);
}

describe("ModelSchema.describeColumnWithPermissions", () => {
  test("adds no second full stop to words that end with one", () => {
    expect(
      ModelSchema.describeColumnWithPermissions(
        "Date and Time when the object was created.",
        PERMISSIONS,
      ),
    ).toBe(`Date and Time when the object was created. ${PERMISSIONS}`);
  });

  test("keeps a question or an exclamation as its own sentence", () => {
    expect(
      ModelSchema.describeColumnWithPermissions(
        "Are owners notified of this resource ownership?",
        PERMISSIONS,
      ),
    ).toBe(`Are owners notified of this resource ownership? ${PERMISSIONS}`);

    expect(
      ModelSchema.describeColumnWithPermissions(
        "Never share this key!",
        PERMISSIONS,
      ),
    ).toBe(`Never share this key! ${PERMISSIONS}`);
  });

  test("ends words without punctuation with a full stop", () => {
    expect(
      ModelSchema.describeColumnWithPermissions(
        "Friendly name of the monitor",
        PERMISSIONS,
      ),
    ).toBe(`Friendly name of the monitor. ${PERMISSIONS}`);

    // A closing bracket or quote is not the end of a sentence.
    expect(
      ModelSchema.describeColumnWithPermissions(
        "How often it runs (in minutes)",
        PERMISSIONS,
      ),
    ).toBe(`How often it runs (in minutes). ${PERMISSIONS}`);
  });

  test("trims the words before it joins them", () => {
    expect(
      ModelSchema.describeColumnWithPermissions(
        "  The monitor's status.  ",
        PERMISSIONS,
      ),
    ).toBe(`The monitor's status. ${PERMISSIONS}`);
  });

  test("is the permissions alone for a column with no words, and the words alone without permissions", () => {
    expect(ModelSchema.describeColumnWithPermissions("", PERMISSIONS)).toBe(
      PERMISSIONS,
    );
    expect(ModelSchema.describeColumnWithPermissions("   ", PERMISSIONS)).toBe(
      PERMISSIONS,
    );
    expect(
      ModelSchema.describeColumnWithPermissions("The monitor's name.", ""),
    ).toBe("The monitor's name.");
  });
});

describe("the spec's column descriptions", () => {
  test("say a column's own words once, then its permissions (Monitor)", () => {
    const descriptions: Map<string, string> = new Map(
      getColumnDescriptions(
        ModelSchema.getReadModelSchema({ modelType: Monitor }),
      ),
    );

    const createdAt: string | undefined = descriptions.get("createdAt");
    expect(createdAt).toBeDefined();
    expect(createdAt).toMatch(
      new RegExp("^Date and Time when the object was created\\. Permissions - "),
    );
  });

  test("keep a question's question mark (MonitorOwnerUser.isOwnerNotified)", () => {
    const descriptions: Map<string, string> = new Map(
      getColumnDescriptions(
        ModelSchema.getReadModelSchema({ modelType: MonitorOwnerUser }),
      ),
    );

    expect(descriptions.get("isOwnerNotified")).toMatch(
      new RegExp("\\? Permissions - Create: \\["),
    );
  });

  test("never end a sentence twice, in any model's create, read or update schema", () => {
    const doubled: Array<string> = [];
    let checked: number = 0;

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const name: string = new modelType().tableName || modelType.name;

      for (const [kind, schema] of [
        ["create", ModelSchema.getCreateModelSchema({ modelType })],
        ["read", ModelSchema.getReadModelSchema({ modelType })],
        ["update", ModelSchema.getUpdateModelSchema({ modelType })],
      ] as Array<[string, ModelSchemaType]>) {
        for (const [column, description] of getColumnDescriptions(schema)) {
          if (!description.includes(" Permissions - ")) {
            continue;
          }

          checked++;

          if (endsTwiceBeforePermissions(description)) {
            doubled.push(`${name}.${column} (${kind}): ${description}`);
          }
        }
      }
    }

    // The sweep read the descriptions it is about: thousands of them.
    expect(checked).toBeGreaterThan(10000);
    expect(doubled.slice(0, 20)).toEqual([]);
  });
});
