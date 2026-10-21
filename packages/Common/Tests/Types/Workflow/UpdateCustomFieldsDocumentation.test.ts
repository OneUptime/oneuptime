import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import ComponentMetadata from "../../../Types/Workflow/Component";
import BaseModelComponent from "../../../Types/Workflow/Components/BaseModel";
import {
  CUSTOM_FIELDS_COLUMN,
  hasCustomFieldsColumn,
} from "../../../Types/Workflow/CustomFieldsColumn";
import ComponentDocumentation, {
  ComponentDocumentationTopic,
} from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import { documentationTextToPlain } from "../../../Types/Workflow/Documentation/DocumentationText";
import { getComponentDocumentation } from "../../../Types/Workflow/Documentation/Index";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The help of the Update steps says what they do to custom fields: they merge
 * into what a record holds (https://github.com/OneUptime/oneuptime/issues/4469),
 * which is not what writing any other field does, so it has to be said - on
 * every model that has custom fields, and on no other.
 */

type StepFunction = (model: BaseModel, suffix: string) => ComponentMetadata;

const step: StepFunction = (
  model: BaseModel,
  suffix: string,
): ComponentMetadata => {
  const found: ComponentMetadata | undefined = BaseModelComponent.getComponents(
    model,
  ).find((metadata: ComponentMetadata) => {
    return metadata.id.endsWith(suffix);
  });

  if (!found) {
    throw new Error(`${model.tableName} has no ${suffix} step`);
  }

  return found;
};

type CustomFieldsTopicFunction = (
  metadata: ComponentMetadata,
) => ComponentDocumentationTopic | undefined;

const customFieldsTopic: CustomFieldsTopicFunction = (
  metadata: ComponentMetadata,
): ComponentDocumentationTopic | undefined => {
  const documentation: ComponentDocumentation | null =
    getComponentDocumentation({
      metadata: metadata,
      stepId: "update-step",
      graphComponents: [],
    });

  return documentation?.learnMore.find((topic: ComponentDocumentationTopic) => {
    return topic.title === "Custom fields";
  });
};

describe("the Update steps' help on custom fields", () => {
  test("Update One Incident says only the custom fields named change", () => {
    const topic: ComponentDocumentationTopic | undefined = customFieldsTopic(
      step(new Incident(), "-update-one"),
    );

    expect(topic).toBeDefined();

    const text: string = topic!.paragraphs
      .map((paragraph: string) => {
        return documentationTextToPlain(paragraph);
      })
      .join(" ");

    expect(text).toContain("Only the ones you name change");
    expect(text).toContain("keeps its value");
    expect(text).toContain("set it to null");
    expect(text).toContain("set customFields itself to null");
  });

  test("its example is Data that sets one custom field", () => {
    const topic: ComponentDocumentationTopic | undefined = customFieldsTopic(
      step(new Incident(), "-update-one"),
    );

    const data: JSONObject = JSON.parse(topic!.example!.code!) as JSONObject;

    expect(Object.keys(data)).toEqual([CUSTOM_FIELDS_COLUMN]);
    expect(Object.keys(data[CUSTOM_FIELDS_COLUMN] as JSONObject)).toHaveLength(
      1,
    );
  });

  test("Update Many says the same", () => {
    expect(
      customFieldsTopic(step(new Incident(), "-update-many")),
    ).toBeDefined();
  });

  test("a model without custom fields does not mention them", () => {
    expect(customFieldsTopic(step(new Label(), "-update-one"))).toBeUndefined();
    expect(
      customFieldsTopic(step(new Label(), "-update-many")),
    ).toBeUndefined();
  });

  test("every model with custom fields that a workflow can update says it", () => {
    const models: Array<BaseModel> = Entities.map(
      (modelType: { new (): BaseModel }): BaseModel => {
        return new modelType();
      },
    ).filter((model: BaseModel) => {
      return (
        hasCustomFieldsColumn(model) && Boolean(model.enableWorkflowOn?.update)
      );
    });

    // Incidents, alerts, monitors, status pages and more.
    expect(models.length).toBeGreaterThanOrEqual(5);

    for (const model of models) {
      for (const suffix of ["-update-one", "-update-many"]) {
        expect({
          step: step(model, suffix).id,
          hasTopic: Boolean(customFieldsTopic(step(model, suffix))),
        }).toEqual({ step: step(model, suffix).id, hasTopic: true });
      }
    }
  });
});

describe("hasCustomFieldsColumn", () => {
  test("is true of a model that keeps custom fields", () => {
    expect(hasCustomFieldsColumn(new Incident())).toBe(true);
  });

  test("is false of a model that has none", () => {
    expect(hasCustomFieldsColumn(new Label())).toBe(false);
  });
});
