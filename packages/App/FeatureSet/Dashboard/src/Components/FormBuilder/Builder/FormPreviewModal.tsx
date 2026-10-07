import { FormBrandingValues } from "../Branding/FormBrandingValues";
import FormsCopy from "../FormsCopy";
import { FormField } from "Common/Types/Form/FormField";
import {
  BuiltPublicForm,
  buildPublicForm,
  findPublicFormTemplate,
  FormCustomFieldDefinition,
  FormRecordOption,
  getPublicFormStartTemplate,
  PublicFormTemplate,
} from "Common/Types/Form/FormPublic";
import { FormTargetOptionsSource } from "Common/Types/Form/FormTargetCatalog";
import FormTargetType from "Common/Types/Form/FormTargetType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  buildPublicFormFields,
  getPublicFormInitialValues,
} from "Common/UI/Components/PublicForm/PublicFormFields";
import PublicFormLogo from "Common/UI/Components/PublicForm/PublicFormLogo";
import PublicFormTemplatePicker from "Common/UI/Components/PublicForm/PublicFormTemplatePicker";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * The form as the people it is shared with see it, from the questions being
 * built - saved or not. Drawn by buildPublicForm and buildPublicFormFields,
 * exactly as the public page draws the saved form, so the browser's checks
 * (a required answer, an email that is one address) run here too. Nothing is
 * ever sent: submitting says so, and offers to fill the form in again. Its
 * logo is the form's own, or the OneUptime logo, drawn by the component the
 * page draws it with. A form with templates opens with its default, and
 * lists them over its questions as the page does; hidden questions are not
 * shown, as the page does not show them.
 */

export interface ComponentProps {
  name: string;
  description?: string | undefined;
  fields: Array<FormField>;
  targetType: FormTargetType;
  customFields: Array<FormCustomFieldDefinition>;
  recordOptions: Partial<
    Record<FormTargetOptionsSource, Array<FormRecordOption>>
  >;
  defaultOptionValues?: Partial<Record<string, string>> | undefined;
  // The form's logo, its alt text and its favicon, as saved.
  branding?: FormBrandingValues | undefined;
  // The form's templates, as saved (Form.templates).
  templates?: unknown;
  onClose: () => void;
}

const FormPreviewModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  // Bumped by "Fill It In Again": a new key is a fresh, empty form.
  const [instance, setInstance] = useState<number>(0);

  const built: BuiltPublicForm = useMemo((): BuiltPublicForm => {
    return buildPublicForm({
      form: {
        name: props.name,
        description: props.description,
        fields: props.fields,
        targetType: props.targetType,
        logoFile: props.branding?.logoFile,
        logoAltText: props.branding?.logoAltText,
        faviconFile: props.branding?.faviconFile,
        templates: props.templates,
      },
      customFields: props.customFields,
      recordOptions: props.recordOptions,
      defaultOptionValues: props.defaultOptionValues,
      isCaptchaRequired: false,
    });
  }, [
    props.name,
    props.description,
    props.fields,
    props.targetType,
    props.customFields,
    props.recordOptions,
    props.defaultOptionValues,
    props.branding,
    props.templates,
  ]);

  // The template the preview is filled in from, as the page opens with it.
  const [templateId, setTemplateId] = useState<string | null>(
    (): string | null => {
      return getPublicFormStartTemplate({ form: built.form })?.id || null;
    },
  );

  const template: PublicFormTemplate | undefined = findPublicFormTemplate(
    built.form,
    templateId,
  );

  return (
    <Modal
      title={FormsCopy.previewTitle}
      description={FormsCopy.previewDescription}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div
        className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 sm:px-8"
        data-testid="form-preview"
      >
        <div className="mx-auto max-w-2xl">
          <PublicFormLogo
            logo={built.form.logo}
            altText={built.form.logoAltText}
          />
          <h2 className="mt-5 text-center text-2xl font-semibold tracking-tight text-gray-900 [overflow-wrap:anywhere]">
            {built.form.name}
          </h2>

          {built.skipped.length > 0 ? (
            <div className="mt-4">
              <Alert
                type={AlertType.WARNING}
                title={FormsCopy.previewSkipped}
                dataTestId="form-preview-skipped"
              />
            </div>
          ) : (
            <></>
          )}

          <div className="mt-6 rounded-xl border border-gray-200 bg-white px-4 py-6 shadow-sm sm:px-8">
            {isSubmitted ? (
              <div
                className="py-6 text-center"
                data-testid="form-preview-submitted"
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                  <Icon
                    icon={IconProp.CheckCircle}
                    className="h-7 w-7 text-emerald-600"
                  />
                </div>
                <p className="mt-4 text-sm font-medium text-gray-900">
                  {tx(FormsCopy.previewSubmitted)}
                </p>
                <div className="mt-6 flex justify-center">
                  <Button
                    title={FormsCopy.previewAgain}
                    buttonStyle={ButtonStyleType.NORMAL}
                    className="!ml-0"
                    dataTestId="form-preview-again"
                    onClick={() => {
                      setIsSubmitted(false);
                      setInstance((value: number): number => {
                        return value + 1;
                      });
                    }}
                  />
                </div>
              </div>
            ) : (
              <>
                {built.form.description ? (
                  <div className="mb-6 border-b border-gray-100 pb-6 text-sm text-gray-700">
                    <MarkdownViewer text={built.form.description} />
                  </div>
                ) : (
                  <></>
                )}
                {built.form.templates && built.form.templates.length > 0 ? (
                  <PublicFormTemplatePicker
                    templates={built.form.templates}
                    selectedTemplateId={template ? template.id : null}
                    label={tx("Template")}
                    description={tx(FormsCopy.templatePickerDescription)}
                    placeholder={tx(FormsCopy.noTemplate)}
                    dataTestId="form-preview-template-picker"
                    onChange={(chosen: string | null) => {
                      setTemplateId(chosen);
                      setInstance((value: number): number => {
                        return value + 1;
                      });
                    }}
                  />
                ) : (
                  <></>
                )}
                <BasicForm
                  key={instance}
                  id="form-preview-form"
                  fields={buildPublicFormFields(built.form, {
                    dataTestIdPrefix: "form-preview-field",
                  })}
                  initialValues={getPublicFormInitialValues(
                    built.form,
                    template,
                  )}
                  showAsColumns={1}
                  maxPrimaryButtonWidth={true}
                  disableAutofocus={true}
                  submitButtonText="Submit"
                  onSubmit={(_values: JSONObject) => {
                    setIsSubmitted(true);
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default FormPreviewModal;
