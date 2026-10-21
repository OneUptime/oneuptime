import FormsCopy from "../../../Components/FormBuilder/FormsCopy";
import {
  FormQuestionData,
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
import { FormField, readFormFields } from "Common/Types/Form/FormField";
import { buildPublicForm } from "Common/Types/Form/FormPublic";
import FormTargetType, {
  readFormTargetType,
} from "Common/Types/Form/FormTargetType";
import {
  FormTemplate,
  limitFormTemplatesToQuestions,
  readFormTemplates,
} from "Common/Types/Form/FormTemplate";
import { JSONArray } from "Common/Types/JSON";
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

/*
 * The copy as it is saved: turned off, and without an IP allowlist the
 * original does not have - the allowlist needs the Scale plan, and sending
 * it empty would still ask for that plan. One the original has is copied:
 * dropping a form's network restriction must never be silent. Its templates
 * keep only what they can still use (getCopyTemplates).
 */
export const prepareFormCopy: (copy: Form) => Promise<void> = async (
  copy: Form,
): Promise<void> => {
  copy.isEnabled = false;

  if (!copy.ipWhitelist || !copy.ipWhitelist.trim()) {
    copy.removeValue("ipWhitelist");
  }

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
