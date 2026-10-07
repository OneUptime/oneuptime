/*
 * Types/Workflow/CreateFromTemplate: which Create One steps can declare a
 * record from a template, the setting they get, the column the record
 * remembers it in, and how the setting's value is read - and the help the
 * step shows for it.
 */

import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
} from "../../../Types/Workflow/Component";
import BaseModelComponents from "../../../Types/Workflow/Components/BaseModel";
import {
  INCIDENT_TEMPLATE_ARGUMENT_ID,
  getCreateFromTemplateArgument,
  getCreateFromTemplateColumn,
  getCreateFromTemplateTableNames,
  readTemplateId,
} from "../../../Types/Workflow/CreateFromTemplate";
import ComponentDocumentation, {
  ComponentDocumentationTopic,
} from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import { getComponentDocumentation } from "../../../Types/Workflow/Documentation/Index";
import { describe, expect, test } from "@jest/globals";

function createOne(model: Incident | Label): ComponentMetadata {
  return BaseModelComponents.getComponents(model).find(
    (component: ComponentMetadata): boolean => {
      return component.id.endsWith("-create-one");
    },
  )!;
}

function helpOf(metadata: ComponentMetadata): ComponentDocumentation {
  return getComponentDocumentation({
    metadata: metadata,
    stepId: `${metadata.id}-1`,
  })!;
}

describe("the tables whose Create One step declares from a template", () => {
  test("an incident, from one of the project's incident templates", () => {
    expect(getCreateFromTemplateTableNames()).toEqual(["Incident"]);

    const setting: Argument | null = getCreateFromTemplateArgument("Incident");

    expect(setting).toEqual(
      expect.objectContaining({
        id: INCIDENT_TEMPLATE_ARGUMENT_ID,
        name: "Incident Template",
        type: ComponentInputType.IncidentTemplateSelect,
        required: false,
      }),
    );
    expect(getCreateFromTemplateColumn("Incident")).toBe(
      "createdIncidentTemplateId",
    );
  });

  test("no other table has the setting", () => {
    for (const tableName of ["Label", "Alert", "ScheduledMaintenance", ""]) {
      expect(getCreateFromTemplateArgument(tableName)).toBeNull();
      expect(getCreateFromTemplateColumn(tableName)).toBeNull();
    }

    expect(getCreateFromTemplateArgument(undefined)).toBeNull();
    expect(getCreateFromTemplateColumn(undefined)).toBeNull();
  });

  test("each step gets a setting of its own: changing one changes no other", () => {
    const first: Argument = getCreateFromTemplateArgument("Incident")!;
    first.name = "Changed";

    expect(getCreateFromTemplateArgument("Incident")!.name).toBe(
      "Incident Template",
    );
  });
});

describe("readTemplateId", () => {
  test("the ID as picked, spaces around it left out", () => {
    expect(readTemplateId("7c000000-0000-4000-8000-0000000000a1")).toBe(
      "7c000000-0000-4000-8000-0000000000a1",
    );
    expect(readTemplateId("  7c000000-0000-4000-8000-0000000000a1\n")).toBe(
      "7c000000-0000-4000-8000-0000000000a1",
    );
  });

  test("nothing picked: an empty setting, or one that is not text", () => {
    for (const value of [undefined, null, "", "   ", 7, true, {}, []]) {
      expect(readTemplateId(value)).toBeNull();
    }
  });

  test("text that is not an ID is handed on as it is, for the step to refuse in its own words", () => {
    expect(readTemplateId("checkout")).toBe("checkout");
  });
});

describe("the step's help", () => {
  test("Create One Incident says how to declare from a template, before the fields", () => {
    const help: ComponentDocumentation = helpOf(createOne(new Incident()));

    expect(help.steps[0]).toBe(
      "To declare it from a template, pick the template under **Incident Template**. Then **JSON Object** only needs what should differ from it.",
    );

    const topic: ComponentDocumentationTopic | undefined = help.learnMore.find(
      (candidate: ComponentDocumentationTopic): boolean => {
        return candidate.title === "Declaring it from a template";
      },
    );

    expect(topic).toBeDefined();
    expect(topic!.paragraphs.join(" ")).toContain(
      "anything **JSON Object** sets wins over the template's - a state included",
    );
    expect(topic!.paragraphs.join(" ")).toContain(
      "a template from another project, or one that was deleted, takes **Error**",
    );
  });

  test("a record with no templates says nothing of them", () => {
    const help: ComponentDocumentation = helpOf(createOne(new Label()));

    expect(JSON.stringify(help)).not.toContain("template");
  });
});
