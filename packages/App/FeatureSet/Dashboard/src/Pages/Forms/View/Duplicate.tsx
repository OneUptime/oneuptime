import FormsCopy from "../../../Components/FormBuilder/FormsCopy";
import { loadFormRecordOptions } from "../../../Components/FormBuilder/FormBuilderData";
import {
  FormReferenceRecord,
  getHeldFormReferenceIds,
  loadHeldFormReferenceRecords,
} from "../../../Components/FormBuilder/OnSubmit/FormOnSubmitData";
import {
  FormQuestionData,
  getFormRecordOptionsWanted,
  loadFormQuestionData,
} from "../../../Components/FormBuilder/Templates/FormQuestionData";
import {
  fitFormTemplateToQuestions,
  FormTemplateEditorQuestion,
  getFormTemplateEditorQuestions,
} from "../../../Components/FormBuilder/Templates/FormTemplatesState";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Form from "Common/Models/DatabaseModels/Form";
import Route from "Common/Types/API/Route";
import {
  FormField,
  FormFieldSource,
  readFormFields,
} from "Common/Types/Form/FormField";
import {
  buildPublicForm,
  FormRecordOption,
} from "Common/Types/Form/FormPublic";
import {
  FormTargetOptionsSource,
  getFormTargetField,
} from "Common/Types/Form/FormTargetCatalog";
import {
  FormTargetSettingReferenceModel,
  getFormTargetSettingReferenceKeys,
} from "Common/Types/Form/FormTargetSettings";
import FormTargetType, {
  readFormTargetType,
} from "Common/Types/Form/FormTargetType";
import {
  FormTemplate,
  limitFormTemplatesToQuestions,
  readFormTemplates,
} from "Common/Types/Form/FormTemplate";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Duplicate Form: another form built like this one, to change for another
 * team or another case rather than build again from nothing. It asks only
 * the copy's name (DuplicateModel fills in "<name> 2"), and opens the copy
 * on its builder.
 *
 * The copy has everything a form is built from - its questions, templates,
 * On Submit settings, description, thank-you message, IP allowlist and
 * branding - and a link of its own, which the server mints for every new
 * form. It starts turned off, so nobody reaches it before it is ready; its
 * Share page turns it on. Its submissions start empty: they belong to the
 * original.
 */

type GetCopyTemplatesFunction = (copy: Form) => Promise<Array<FormTemplate>>;

/*
 * The copy's templates, each keeping only what it can still use, as the
 * Templates page saves one (fitFormTemplateToQuestions): its answers that
 * suit their questions and its settings for questions the form asks. The
 * server judges a new form's templates whole, so an answer left behind by a
 * question removed or changed since - never used by the original - would
 * get the copy refused. Without the project's custom fields and records
 * (the read failed), the copy keeps what the questions' ids allow.
 */
const getCopyTemplates: GetCopyTemplatesFunction = async (
  copy: Form,
): Promise<Array<FormTemplate>> => {
  const fields: Array<FormField> = readFormFields(copy.fields);
  const targetType: FormTargetType = readFormTargetType(copy.targetType);

  try {
    const questionData: FormQuestionData = await loadFormQuestionData({
      targetType,
      fields,
    });

    const questions: Array<FormTemplateEditorQuestion> =
      getFormTemplateEditorQuestions(
        buildPublicForm({
          form: { name: copy.name || "", fields: copy.fields, targetType },
          customFields: questionData.customFields,
          recordOptions: questionData.recordOptions,
          isCaptchaRequired: false,
        }),
      );

    return readFormTemplates(copy.templates).map(
      (template: FormTemplate): FormTemplate => {
        return fitFormTemplateToQuestions({ template, questions });
      },
    );
  } catch {
    return limitFormTemplatesToQuestions({
      templates: copy.templates,
      fieldIds: fields.map((field: FormField): string => {
        return field.id;
      }),
    });
  }
};

type KeepRecordsStillThereFunction = (copy: Form) => Promise<void>;

/*
 * The records the copy names, kept where they are still there. A new form
 * is judged whole, so the server refuses a copy whose questions offer, or
 * whose settings name, a record deleted since - or a label or severity
 * archived since, which no submitter may pick - though the original keeps
 * it. Each record is read by its id, as the server reads it (#10646): one
 * past the project's first 10,000 of its kind is never mistaken for one
 * that is gone, and the copy keeps it. Without the reads (one failed), the
 * copy is sent as it is, and the server says what it refuses.
 */
const keepRecordsStillThere: KeepRecordsStillThereFunction = async (
  copy: Form,
): Promise<void> => {
  const targetType: FormTargetType = readFormTargetType(copy.targetType);
  const fields: Array<FormField> = readFormFields(copy.fields);

  try {
    const offered: Map<FormTargetOptionsSource, Set<string>> = new Map();

    for (const [source, wanted] of getFormRecordOptionsWanted({
      targetType,
      fields,
    })) {
      const found: Array<FormRecordOption> =
        wanted.ids.length > 0
          ? await loadFormRecordOptions(source, wanted.ids)
          : [];

      offered.set(
        source,
        new Set<string>(
          found.map((record: FormRecordOption): string => {
            return record.id;
          }),
        ),
      );
    }

    const settings: Record<string, unknown> = {
      ...((copy.targetSettings || {}) as Record<string, unknown>),
    };

    const heldIds: Map<
      FormTargetSettingReferenceModel,
      Array<string>
    > = getHeldFormReferenceIds({ targetType, settings: settings });
    const named: Map<FormTargetSettingReferenceModel, Set<string>> = new Map();

    for (const [model, ids] of heldIds) {
      const found: Array<FormReferenceRecord> = (
        await loadHeldFormReferenceRecords({ model, ids })
      ).records;

      named.set(
        model,
        new Set<string>(
          found.map((record: FormReferenceRecord): string => {
            return record.id;
          }),
        ),
      );
    }

    copy.fields = fields.map((field: FormField): FormField => {
      const source: FormTargetOptionsSource | undefined =
        field.source === FormFieldSource.TargetField
          ? getFormTargetField(targetType, field.targetField)?.optionsSource
          : undefined;
      const there: Set<string> | undefined = source
        ? offered.get(source)
        : undefined;

      if (!there || !field.allowedOptionIds) {
        return field;
      }

      return {
        ...field,
        allowedOptionIds: field.allowedOptionIds.filter(
          (id: string): boolean => {
            return there.has(id.toLowerCase());
          },
        ),
      };
    }) as unknown as JSONArray;

    for (const setting of getFormTargetSettingReferenceKeys(targetType)) {
      const there: Set<string> | undefined = named.get(setting.model);
      const value: unknown = settings[setting.key];

      if (!there || value === undefined || value === null) {
        continue;
      }

      if (setting.kind === "id") {
        if (typeof value !== "string" || !there.has(value.toLowerCase())) {
          delete settings[setting.key];
        }

        continue;
      }

      settings[setting.key] = (Array.isArray(value) ? value : []).filter(
        (id: unknown): boolean => {
          return typeof id === "string" && there.has(id.toLowerCase());
        },
      );
    }

    copy.targetSettings = settings as JSONObject;
  } catch {
    // The copy as it is: the server says what it refuses.
  }
};

/*
 * The copy as it is saved: turned off, and without an IP allowlist the
 * original does not have - the allowlist needs the Scale plan, and sending
 * it empty would still ask for that plan. One the original has is copied:
 * dropping a form's network restriction must never be silent. It names only
 * the records that are still there (keepRecordsStillThere), and its
 * templates keep only what they can still use (getCopyTemplates).
 */
export const prepareFormCopy: (copy: Form) => Promise<void> = async (
  copy: Form,
): Promise<void> => {
  copy.isEnabled = false;

  if (!copy.ipWhitelist || !copy.ipWhitelist.trim()) {
    copy.removeValue("ipWhitelist");
  }

  await keepRecordsStillThere(copy);

  if (Array.isArray(copy.templates)) {
    copy.templates = (await getCopyTemplates(copy)) as unknown as JSONArray;
  }
};
const FormDuplicate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // .../forms/<id>/duplicate: the form is the next-to-last segment.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DuplicateModel<Form>
        modelType={Form}
        modelId={modelId}
        description={FormsCopy.duplicateFormNote}
        fieldsToDuplicate={{
          description: true,
          targetType: true,
          fields: true,
          templates: true,
          targetSettings: true,
          successMessage: true,
          ipWhitelist: true,
          logoFileId: true,
          logoAltText: true,
          faviconFileId: true,
        }}
        prepareCopy={prepareFormCopy}
        navigateToOnSuccess={RouteUtil.populateRouteParams(
          RouteMap[PageMap.FORMS] as Route,
        )}
        fieldsToChange={[
          {
            field: {
              name: true,
            },
            title: "Name",
            description: FormsCopy.nameDescription,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: FormsCopy.namePlaceholder,
          },
        ]}
      />
    </Fragment>
  );
};

export default FormDuplicate;
