import { describe, expect, test } from "@jest/globals";
import {
  getSloDetailsFormFields,
  getSloFormFields,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";

/*
 * The Overview's details card edits an SLO in place with these fields. They
 * are derived from the create form, so what can go wrong is the derivation:
 * picking up a settings field, losing one of the three when the create form
 * is reorganised, or carrying a create-wizard step id into a form that has no
 * steps.
 */

type SloField = ModelField<ServiceLevelObjective>;

function columnOf(field: SloField): string {
  const columns: Array<string> = Object.keys(
    field.field as unknown as Record<string, unknown>,
  );

  if (columns.length !== 1) {
    throw new Error(
      `Expected one column per SLO form field, got ${JSON.stringify(columns)}.`,
    );
  }

  return columns[0]!;
}

// The parts of a field a user sees; functions are compared by identity, so leave them out.
function visibleDefinitionOf(field: SloField): Record<string, unknown> {
  return {
    title: field.title,
    description: field.description,
    fieldType: field.fieldType,
    required: field.required,
    placeholder: field.placeholder,
    dropdownModal: field.dropdownModal,
  };
}

const DETAILS_FIELDS: Array<SloField> = getSloDetailsFormFields();
const CREATE_FIELDS: Array<SloField> = getSloFormFields();

describe("SLO details form fields", () => {
  test("edit only the SLO's name, description and labels, in that order", () => {
    expect(DETAILS_FIELDS.map(columnOf)).toEqual([
      "name",
      "description",
      "labels",
    ]);
  });

  test("belong to no form step", () => {
    DETAILS_FIELDS.forEach((field: SloField) => {
      expect(Object.prototype.hasOwnProperty.call(field, "stepId")).toBe(false);
    });
  });

  test("look exactly like the same fields in the create form", () => {
    DETAILS_FIELDS.forEach((detailsField: SloField) => {
      const createField: SloField | undefined = CREATE_FIELDS.find(
        (field: SloField): boolean => {
          return columnOf(field) === columnOf(detailsField);
        },
      );

      expect(createField).toBeDefined();
      expect(visibleDefinitionOf(detailsField)).toEqual(
        visibleDefinitionOf(createField!),
      );
    });
  });
});
