import {
  loadFormCustomFields,
  loadFormRecordOptions,
} from "../FormBuilderData";
import { FormField, FormFieldSource } from "Common/Types/Form/FormField";
import {
  FormCustomFieldDefinition,
  FormRecordOption,
} from "Common/Types/Form/FormPublic";
import {
  FormTargetFieldDefinition,
  FormTargetOptionsSource,
  getFormTargetField,
} from "Common/Types/Form/FormTargetCatalog";
import FormTargetType from "Common/Types/Form/FormTargetType";

/*
 * What a form's questions need to be built as the public page builds them
 * (buildPublicForm), read from the current project: the target's custom
 * fields, when a question is one, and the records each choice question
 * offers - every kind once. The Templates page reads it to draw a
 * template's editor, and Duplicate Form to keep only what a copy's
 * templates can still use.
 */

export type FormRecordOptionsBySource = Partial<
  Record<FormTargetOptionsSource, Array<FormRecordOption>>
>;

export interface FormQuestionData {
  customFields: Array<FormCustomFieldDefinition>;
  recordOptions: FormRecordOptionsBySource;
}

export type LoadFormQuestionDataFunction = (data: {
  targetType: FormTargetType;
  fields: Array<FormField>;
}) => Promise<FormQuestionData>;

export const loadFormQuestionData: LoadFormQuestionDataFunction = async (data: {
  targetType: FormTargetType;
  fields: Array<FormField>;
}): Promise<FormQuestionData> => {
  const sources: Set<FormTargetOptionsSource> =
    new Set<FormTargetOptionsSource>();

  for (const question of data.fields) {
    if (question.source !== FormFieldSource.TargetField) {
      continue;
    }

    const definition: FormTargetFieldDefinition | undefined =
      getFormTargetField(data.targetType, question.targetField);

    if (definition?.optionsSource) {
      sources.add(definition.optionsSource);
    }
  }

  const recordOptions: FormRecordOptionsBySource = {};

  for (const source of sources) {
    recordOptions[source] = await loadFormRecordOptions(source);
  }

  const asksCustomField: boolean = data.fields.some(
    (question: FormField): boolean => {
      return question.source === FormFieldSource.TargetCustomField;
    },
  );

  return {
    customFields: asksCustomField
      ? await loadFormCustomFields(data.targetType)
      : [],
    recordOptions: recordOptions,
  };
};
