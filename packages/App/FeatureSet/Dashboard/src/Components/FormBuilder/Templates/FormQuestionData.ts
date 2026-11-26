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
 *
 * A choice question offers the records it names (allowedOptionIds), so
 * those are read by their ids, as the server reads them for the public page
 * (FormRecordOptions) - never looked for in the project's first 10,000 of a
 * kind (#10646). A question offering a monitor past them offered nothing
 * here: the Templates page could not set it, and Duplicate Form left it out
 * of the copy's templates. Only a kind a question may offer whole, naming
 * none (severities), is read whole.
 */

export interface FormRecordOptionsWanted {
  // Every record of the kind: a question offers them all.
  isEveryRecord: boolean;
  // Otherwise, the records the questions name.
  ids: Array<string>;
}

export type GetFormRecordOptionsWantedFunction = (data: {
  targetType: FormTargetType;
  fields: Array<FormField>;
}) => Map<FormTargetOptionsSource, FormRecordOptionsWanted>;

// The records each kind's questions offer, as they are to be read.
export const getFormRecordOptionsWanted: GetFormRecordOptionsWantedFunction =
  (data: {
    targetType: FormTargetType;
    fields: Array<FormField>;
  }): Map<FormTargetOptionsSource, FormRecordOptionsWanted> => {
    const wanted: Map<FormTargetOptionsSource, FormRecordOptionsWanted> =
      new Map();

    for (const question of data.fields) {
      if (question.source !== FormFieldSource.TargetField) {
        continue;
      }

      const definition: FormTargetFieldDefinition | undefined =
        getFormTargetField(data.targetType, question.targetField);

      if (!definition?.optionsSource) {
        continue;
      }

      const entry: FormRecordOptionsWanted = wanted.get(
        definition.optionsSource,
      ) || { isEveryRecord: false, ids: [] };

      const allowed: Array<string> = question.allowedOptionIds || [];

      if (allowed.length === 0 && !definition.mustChooseOptions) {
        entry.isEveryRecord = true;
      }

      for (const id of allowed) {
        const key: string = id.toLowerCase();

        if (!entry.ids.includes(key)) {
          entry.ids.push(key);
        }
      }

      wanted.set(definition.optionsSource, entry);
    }

    return wanted;
  };

export type LoadWantedFormRecordOptionsFunction = (
  source: FormTargetOptionsSource,
  wanted: FormRecordOptionsWanted,
) => Promise<Array<FormRecordOption>>;

export const loadWantedFormRecordOptions: LoadWantedFormRecordOptionsFunction =
  async (
    source: FormTargetOptionsSource,
    wanted: FormRecordOptionsWanted,
  ): Promise<Array<FormRecordOption>> => {
    if (wanted.isEveryRecord) {
      return await loadFormRecordOptions(source);
    }

    return wanted.ids.length > 0
      ? await loadFormRecordOptions(source, wanted.ids)
      : [];
  };

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
  const recordOptions: FormRecordOptionsBySource = {};

  for (const [source, wanted] of getFormRecordOptionsWanted(data)) {
    recordOptions[source] = await loadWantedFormRecordOptions(source, wanted);
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
