/*
 * The generated database components: eleven per model, across 227 models that
 * enable workflows. Nothing here is written by hand, so a single wrong string
 * in the generator is a wrong string on well over a thousand components — which
 * is how one shared documentation file came to be attached to eight of them and
 * to none of the three triggers.
 *
 * These pin the metadata a builder actually reads: which documentation each
 * component points at, which arguments it opens on, and what its own palette
 * entry says it does.
 */

import BaseModelComponent from "../../../Types/Workflow/Components/BaseModel";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import { describe, expect, test } from "@jest/globals";

const COMPONENTS: Array<ComponentMetadata> = BaseModelComponent.getComponents(
  new Monitor(),
);

type FindFunction = (idSuffix: string) => ComponentMetadata;

const find: FindFunction = (idSuffix: string): ComponentMetadata => {
  const found: ComponentMetadata | undefined = COMPONENTS.find(
    (component: ComponentMetadata) => {
      return component.id.endsWith(idSuffix);
    },
  );

  if (!found) {
    throw new Error(
      `No generated component ending "${idSuffix}". Found: ${COMPONENTS.map(
        (c: ComponentMetadata) => {
          return c.id;
        },
      ).join(", ")}`,
    );
  }

  return found;
};

type ArgumentOfFunction = (
  component: ComponentMetadata,
  id: string,
) => Argument | undefined;

const argumentOf: ArgumentOfFunction = (
  component: ComponentMetadata,
  id: string,
): Argument | undefined => {
  return component.arguments.find((argument: Argument) => {
    return argument.id === id;
  });
};

const COMPONENT_IDS: Array<string> = [
  "-find-one",
  "-find-many",
  "-create-one",
  "-create-many",
  "-update-one",
  "-update-many",
  "-delete-one",
  "-delete-many",
];

const TRIGGER_IDS: Array<string> = ["-on-create", "-on-update", "-on-delete"];

describe("generated database components", () => {
  test("a model with everything enabled gets eleven components", () => {
    expect(COMPONENTS).toHaveLength(11);
  });

  test("a model with workflows disabled gets none", () => {
    /*
     * enableWorkflowOn is declared non-optional but is genuinely absent on the
     * models that do not opt in, which is the case the generator guards.
     */
    const model: Monitor = new Monitor();
    (model as unknown as { enableWorkflowOn?: undefined }).enableWorkflowOn =
      undefined;

    expect(BaseModelComponent.getComponents(model)).toEqual([]);
  });

  test("every component carries the table name the editors need", () => {
    /*
     * Without this, ArgumentsForm cannot mount the schema-backed editors at
     * all — the whole column-picking behaviour is gated on it.
     */
    for (const component of COMPONENTS) {
      expect(component.tableName).toBe("Monitor");
    }
  });
});

describe("documentation links", () => {
  /*
   * One shared file used to serve all eight components, so on Create One most
   * of it described arguments that component does not have. Splitting it per
   * operation is only correct if every component points at its own file.
   */
  type ExpectDocsFunction = (idSuffix: string, fileName: string) => void;

  const expectDocs: ExpectDocsFunction = (
    idSuffix: string,
    fileName: string,
  ): void => {
    expect(find(idSuffix).documentationLink?.toString()).toBe(
      `/workflow/docs/${fileName}`,
    );
  };

  test("find components point at the find docs", () => {
    expectDocs("-find-one", "DatabaseFind.md");
    expectDocs("-find-many", "DatabaseFind.md");
  });

  test("create components point at the create docs", () => {
    expectDocs("-create-one", "DatabaseCreate.md");
    expectDocs("-create-many", "DatabaseCreate.md");
  });

  test("update components point at the update docs", () => {
    expectDocs("-update-one", "DatabaseUpdate.md");
    expectDocs("-update-many", "DatabaseUpdate.md");
  });

  test("delete components point at the delete docs", () => {
    expectDocs("-delete-one", "DatabaseDelete.md");
    expectDocs("-delete-many", "DatabaseDelete.md");
  });

  /*
   * The triggers had no documentationLink at all, so ComponentSettingsModal
   * rendered no documentation card for them and nothing explained the absence.
   */
  test("triggers now have documentation of their own", () => {
    for (const idSuffix of TRIGGER_IDS) {
      expectDocs(idSuffix, "DatabaseTriggers.md");
    }
  });

  test("no component is left pointing at the old shared file", () => {
    for (const component of COMPONENTS) {
      expect(component.documentationLink?.toString()).not.toContain(
        "DatabaseComponents.md",
      );
    }
  });

  test("every generated component has documentation", () => {
    for (const component of COMPONENTS) {
      expect(component.documentationLink).toBeDefined();
    }
  });
});

describe("the write payload is keyed on columns", () => {
  /*
   * This is what makes the row editor reachable. ArgumentsForm mounts it for
   * Query and for JSON arguments on a component that has a tableName; the write
   * payload must therefore stay ComponentInputType.JSON.
   *
   * Retyping it to BaseModel would look like the smaller change and is the
   * wrong one — BaseModel is in JSON5_TOLERANT_INPUT_TYPES, which changes how
   * RunWorkflow parses the value. This test is the tripwire for that.
   */
  test("Create One takes a JSON object", () => {
    const argument: Argument | undefined = argumentOf(
      find("-create-one"),
      "json",
    );

    expect(argument?.type).toBe(ComponentInputType.JSON);
    expect(argument?.required).toBe(true);
  });

  test("Update One and Update Many take a JSON object as data", () => {
    for (const idSuffix of ["-update-one", "-update-many"]) {
      const argument: Argument | undefined = argumentOf(find(idSuffix), "data");

      expect(argument?.type).toBe(ComponentInputType.JSON);
      expect(argument?.required).toBe(true);
    }
  });

  /*
   * Create Many holds a list of records, which rows cannot represent, so it
   * must stay a JSONArray and keep the raw code editor.
   */
  test("Create Many stays a JSON array", () => {
    expect(argumentOf(find("-create-many"), "json-array")?.type).toBe(
      ComponentInputType.JSONArray,
    );
  });

  /*
   * ArgumentsForm reads the argument id to decide whether the record editor
   * opens with a blank row for every column a create must supply: "json" is a
   * create, anything else is an update. An update that opened on six seeded
   * fields when the builder meant to set one would be a regression nothing else
   * here would catch, so the two spellings are pinned as a pair.
   */
  test('a create\'s payload is "json" and an update\'s is "data", never the reverse', () => {
    expect(argumentOf(find("-create-one"), "json")).toBeDefined();
    expect(argumentOf(find("-create-one"), "data")).toBeUndefined();

    for (const idSuffix of ["-update-one", "-update-many"]) {
      expect(argumentOf(find(idSuffix), "data")).toBeDefined();
      expect(argumentOf(find(idSuffix), "json")).toBeUndefined();
    }
  });

  test("no component declares a BaseModel argument", () => {
    /*
     * The bug this whole change came from: the row editor was selected only for
     * ComponentInputType.BaseModel, which is never an argument type here — only
     * a return value — so Record mode was unreachable.
     */
    for (const component of COMPONENTS) {
      for (const argument of component.arguments) {
        expect(argument.type).not.toBe(ComponentInputType.BaseModel);
      }
    }
  });
});

describe("skip and limit", () => {
  const PAGINATED: Array<string> = [
    "-find-many",
    "-update-many",
    "-delete-many",
  ];

  test("both are collapsed behind the advanced disclosure", () => {
    /*
     * Find Many otherwise opens with four equally weighted fields when two
     * decide what the step does. Every other generator already uses isAdvanced.
     */
    for (const idSuffix of PAGINATED) {
      expect(argumentOf(find(idSuffix), "skip")?.isAdvanced).toBe(true);
      expect(argumentOf(find(idSuffix), "limit")?.isAdvanced).toBe(true);
    }
  });

  test("neither is required, so collapsing them cannot hide a validation error", () => {
    /*
     * BasicForm skips validation for a field hidden by showIf, so a required
     * argument must never be collapsed. ArgumentsForm enforces this too; this
     * asserts the generator does not hand it the problem.
     */
    for (const idSuffix of PAGINATED) {
      expect(argumentOf(find(idSuffix), "skip")?.required).toBe(false);
      expect(argumentOf(find(idSuffix), "limit")?.required).toBe(false);
    }
  });

  /*
   * Read as pagination, Limit is why "Items Deleted: 10" gets taken to mean ten
   * records matched. The runtime defaults it to 10 and stops there, so it is a
   * cap and has to be worded as one.
   */
  test("limit is described as a cap, not as pagination", () => {
    const description: string =
      argumentOf(find("-delete-many"), "limit")?.description || "";

    expect(description).toContain("Defaults to 10");
    expect(description).not.toMatch(/pagination/i);
    expect(description).toMatch(/only affects 10/);
  });
});

describe("what the palette says each component does", () => {
  /*
   * These strings are the component's description in the picker, and the picker
   * searches them — so a wrong verb here is both misleading and unfindable.
   */
  test("Delete Many says it deletes, not that it finds", () => {
    const description: string = find("-delete-many").description;

    expect(description).toMatch(/^Delete many/);
    expect(description).not.toMatch(/find/i);
  });

  test("every delete argument is called Query, like every other component", () => {
    for (const idSuffix of ["-delete-one", "-delete-many"]) {
      expect(argumentOf(find(idSuffix), "query")?.name).toBe("Query");
    }
  });

  test("the On Update listen-on description is spelled correctly and honest", () => {
    const description: string =
      argumentOf(find("-on-update"), "listen-on")?.description || "";

    expect(description).not.toContain("upate");
    /*
     * OnTriggerBaseModel skips this filter entirely when the event carries no
     * record of which fields changed, so it cannot be described as a guarantee.
     */
    expect(description).toMatch(/skipped|anyway/);
  });
});

describe("return values", () => {
  type ReturnValueOfFunction = (
    component: ComponentMetadata,
    id: string,
  ) => ReturnValue | undefined;

  const returnValueOf: ReturnValueOfFunction = (
    component: ComponentMetadata,
    id: string,
  ): ReturnValue | undefined => {
    return component.returnValues.find((returnValue: ReturnValue) => {
      return returnValue.id === id;
    });
  };

  /*
   * The type is rendered as a visible pill in the value picker, and the
   * picker's drill-in keys off it — so Create One returning "JSON" where Find
   * One returns "Database Record" was both inconsistent on screen and a missed
   * drill-in.
   */
  test("every component that returns one record types it as a record", () => {
    for (const idSuffix of [
      "-find-one",
      "-create-one",
      "-on-create",
      "-on-update",
      "-on-delete",
    ]) {
      expect(returnValueOf(find(idSuffix), "model")?.type).toBe(
        ComponentInputType.BaseModel,
      );
    }
  });

  test("every component that returns a list types it as a list", () => {
    for (const idSuffix of ["-find-many", "-create-many"]) {
      expect(returnValueOf(find(idSuffix), "models")?.type).toBe(
        ComponentInputType.BaseModelArray,
      );
    }
  });

  test("Create Many describes what it created, with the model name filled in", () => {
    const description: string =
      returnValueOf(find("-create-many"), "models")?.description || "";

    /*
     * It shipped the un-interpolated literal "Models created in the database",
     * which is the only description in the family that never names the model.
     */
    expect(description).toContain("Monitors");
    expect(description).not.toBe("Models created in the database");
  });

  test("counts come back from the components that change records", () => {
    expect(returnValueOf(find("-update-one"), "items-updated")?.type).toBe(
      ComponentInputType.Number,
    );
    expect(returnValueOf(find("-delete-many"), "items-deleted")?.type).toBe(
      ComponentInputType.Number,
    );
  });
});

describe("ports", () => {
  test("every component can branch on failure", () => {
    for (const idSuffix of COMPONENT_IDS) {
      const component: ComponentMetadata = find(idSuffix);

      expect(component.componentType).toBe(ComponentType.Component);
      expect(
        component.outPorts.map((port: { id: string }) => {
          return port.id;
        }),
      ).toEqual(expect.arrayContaining(["success", "error"]));
    }
  });

  test("triggers start a run, so they have no in port and cannot fail", () => {
    for (const idSuffix of TRIGGER_IDS) {
      const component: ComponentMetadata = find(idSuffix);

      expect(component.componentType).toBe(ComponentType.Trigger);
      expect(component.inPorts).toEqual([]);
      expect(
        component.outPorts.map((port: { id: string }) => {
          return port.id;
        }),
      ).toEqual(["success"]);
    }
  });
});

describe("a model that enables only some operations", () => {
  /*
   * MonitorSecret is the component in the report that started this work. It is
   * also a useful shape check: whatever it enables, it must never produce a
   * component pointing at documentation for an operation it does not have.
   */
  const secretComponents: Array<ComponentMetadata> =
    BaseModelComponent.getComponents(new MonitorSecret());

  test("only generates components for what the model enables", () => {
    const enabled: MonitorSecret = new MonitorSecret();

    for (const component of secretComponents) {
      if (component.id.includes("-create-")) {
        expect(enabled.enableWorkflowOn?.create).toBe(true);
      }
      if (component.id.includes("-delete-")) {
        expect(enabled.enableWorkflowOn?.delete).toBe(true);
      }
    }
  });

  test("each component's documentation matches its own operation", () => {
    for (const component of secretComponents) {
      const link: string = component.documentationLink?.toString() || "";

      if (component.id.includes("-create-")) {
        expect(link).toBe("/workflow/docs/DatabaseCreate.md");
      } else if (component.id.includes("-find-")) {
        expect(link).toBe("/workflow/docs/DatabaseFind.md");
      } else if (component.id.includes("-update-")) {
        expect(link).toBe("/workflow/docs/DatabaseUpdate.md");
      } else if (component.id.includes("-delete-")) {
        expect(link).toBe("/workflow/docs/DatabaseDelete.md");
      } else {
        expect(link).toBe("/workflow/docs/DatabaseTriggers.md");
      }
    }
  });
});
