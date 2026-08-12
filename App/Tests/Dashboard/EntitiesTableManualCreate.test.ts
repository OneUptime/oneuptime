import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  INVENTORY_ENTITY_TYPES,
  MANUAL_ENTITY_TYPES,
} from "Common/Types/Telemetry/EntityTypeGroups";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The entity explorer is the only surface that creates manual CIs, and the
 * shape of that form is load-bearing:
 *
 *   - Offering a discovered or inventory-mirrored type in the dropdown
 *     produces a form that always fails, because the service rejects those
 *     (see TelemetryEntityManualCreate.test.ts).
 *   - Offering `entityKey` as a field would let a user set an identity that
 *     does not match what the server derives.
 *   - Losing the Source column makes the three kinds of row visually
 *     indistinguishable, which matters because only manual ones are really
 *     deletable — the others come back.
 *
 * The App suite runs in a plain Node environment with no React renderer, so
 * this pins the JSX wiring at source level, following the same invariant
 * pattern as EmptyResourceInventoryPages.test.ts. Whitespace is squashed so
 * Prettier can reflow props without making the test brittle.
 */

const ENTITIES_TABLE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Entities",
  "EntitiesTable.tsx",
);

function readSource(): string {
  return fs.readFileSync(ENTITIES_TABLE, "utf8");
}

function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(): string {
  return squash(stripComments(readSource()));
}

describe("the entity explorer file exists where the test expects it", () => {
  test("reads", () => {
    expect(fs.existsSync(ENTITIES_TABLE)).toBe(true);
  });
});

describe("manual creation is offered", () => {
  test("the table is creatable", () => {
    expect(readCode()).toContain("isCreateable={true}");
  });

  test("the create form is wired", () => {
    expect(readCode()).toContain("formFields={[");
  });

  test("the type dropdown is built from MANUAL_ENTITY_TYPES", () => {
    const code: string = readCode();

    expect(code).toContain("MANUAL_ENTITY_TYPES");
    expect(code).toContain("manualEntityTypeOptions");
  });

  test("the dropdown is not built from the full EntityType vocabulary", () => {
    /*
     * `Object.values(EntityType)` is correct for the FILTER (you filter by
     * any type) and wrong for the form (you create only manual ones). This
     * pins that the form options come from the restricted set.
     */
    const code: string = readCode();
    const formSection: string = code.slice(
      code.indexOf("formFields={["),
      code.indexOf("filters={["),
    );

    expect(formSection.length).toBeGreaterThan(0);
    expect(formSection).not.toContain("Object.values(EntityType)");
  });

  test("name and description are collected", () => {
    const code: string = readCode();

    expect(code).toContain("displayName: true");
    expect(code).toContain("description: true");
  });

  test("the entity key is never a form field", () => {
    /*
     * It is derived server-side from (project, type, name); a user-supplied
     * value would disagree with it.
     */
    const code: string = readCode();
    const formSection: string = code.slice(
      code.indexOf("formFields={["),
      code.indexOf("filters={["),
    );

    expect(formSection).not.toContain("entityKey: true");
  });

  test("the source is never a form field", () => {
    // Assigned by the service, and immutable after create.
    const code: string = readCode();
    const formSection: string = code.slice(
      code.indexOf("formFields={["),
      code.indexOf("filters={["),
    );

    expect(formSection).not.toContain("source: true");
  });
});

describe("the three row sources stay distinguishable", () => {
  test("Source is a column", () => {
    const code: string = readCode();
    const columnSection: string = code.slice(code.indexOf("columns={["));

    expect(columnSection).toContain("source: true");
  });

  test("Source is filterable", () => {
    const code: string = readCode();
    const filterSection: string = code.slice(
      code.indexOf("filters={["),
      code.indexOf("columns={["),
    );

    expect(filterSection).toContain("source: true");
  });

  test("the source filter offers every EntitySource", () => {
    expect(readCode()).toContain("Object.values(EntitySource)");
  });
});

describe("the imports match what the component uses", () => {
  test("imports EntitySource and the manual type set", () => {
    const source: string = readSource();

    expect(source).toContain(
      'import EntitySource from "Common/Types/Telemetry/EntitySource"',
    );
    expect(source).toContain("MANUAL_ENTITY_TYPES");
  });
});

describe("the restricted set the UI relies on", () => {
  test("is non-empty, or the create form would offer nothing", () => {
    expect(MANUAL_ENTITY_TYPES.size).toBeGreaterThan(0);
  });

  test("offers no type the server would reject", () => {
    for (const entityType of MANUAL_ENTITY_TYPES) {
      expect(INVENTORY_ENTITY_TYPES.has(entityType)).toBe(false);
      expect(entityType).not.toBe(EntityType.Service);
    }
  });

  test("EntitySource has values for the filter to offer", () => {
    expect(Object.values(EntitySource).length).toBeGreaterThan(1);
  });
});
