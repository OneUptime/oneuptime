import { loadFormCustomFields, loadFormRecordOptions } from "../FormBuilderData";
import FormsCopy from "../FormsCopy";
import {
  FormTemplateEditorQuestion,
  getFormTemplateAnsweredLabels,
  getFormTemplateEditorQuestions,
  getFormTemplateEditorValues,
  getFormTemplateShareLink,
  readFormTemplateFromEditor,
  TEMPLATE_DEFAULT_KEY,
  TEMPLATE_NAME_KEY,
} from "./FormTemplatesState";
import Form from "Common/Models/DatabaseModels/Form";
import {
  FormField,
  FormFieldSource,
  readFormFields,
} from "Common/Types/Form/FormField";
import {
  BuiltPublicForm,
  buildPublicForm,
  FormCustomFieldDefinition,
  FormRecordOption,
  PublicFormField,
} from "Common/Types/Form/FormPublic";
import {
  FormTargetFieldDefinition,
  FormTargetOptionsSource,
  getFormTargetField,
} from "Common/Types/Form/FormTargetCatalog";
import FormTargetType, {
  readFormTargetType,
} from "Common/Types/Form/FormTargetType";
import {
  duplicateFormTemplate,
  FORM_MAX_TEMPLATES,
  FORM_TEMPLATE_NAME_MAX_LENGTH,
  FormTemplate,
  FormTemplatesChange,
  moveFormTemplate,
  readFormTemplates,
  removeFormTemplate,
  saveFormTemplate,
} from "Common/Types/Form/FormTemplate";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  buildPublicFormFields,
  getPublicFormFieldKey,
} from "Common/UI/Components/PublicForm/PublicFormFields";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

/*
 * A form's templates (Forms > a form > Templates): named sets of answers
 * people can start the form from - one per case a team reports often - so a
 * single form, and a single link, serves them all.
 *
 * Each template is listed with what it fills in, and can be edited,
 * duplicated, moved, deleted, or shared by its own link, which opens the
 * form with it filled in. Its editor is the form itself: every question,
 * hidden ones too, none required (FormTemplatesState). The default template
 * is the one the form opens with.
 *
 * Every change is saved at once, as the whole list, and the server checks
 * each answer against the question it answers: what it refuses is said in
 * the dialog the change came from, or over the list.
 */

export interface ComponentProps {
  formId: ObjectID;
}

type RecordOptions = Partial<
  Record<FormTargetOptionsSource, Array<FormRecordOption>>
>;

interface EditorState {
  // The template being edited; undefined for a new one.
  template: FormTemplate | undefined;
}

const ICON_BUTTON_CLASS_NAME: string =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40";

// How many of the questions a template fills in its row names.
const LISTED_LABELS: number = 6;

const FormTemplates: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [form, setForm] = useState<Form | null>(null);
  const [templates, setTemplates] = useState<Array<FormTemplate>>([]);
  const [customFields, setCustomFields] = useState<
    Array<FormCustomFieldDefinition>
  >([]);
  const [recordOptions, setRecordOptions] = useState<RecordOptions>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [listError, setListError] = useState<string>("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string>("");
  const [deleting, setDeleting] = useState<FormTemplate | null>(null);

  const updateGate: PermissionGateResult = PermissionGate.check(
    new Form(),
    ModelAction.Update,
  );
  const isReadOnly: boolean = !updateGate.isAllowed;

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setLoadError("");

    try {
      const loaded: Form | null = await ModelAPI.getItem<Form>({
        modelType: Form,
        id: props.formId,
        select: {
          name: true,
          targetType: true,
          fields: true,
          templates: true,
          shareKey: true,
        },
      });

      if (!loaded) {
        setLoadError(FormsCopy.formNotFound);
        setIsLoading(false);
        return;
      }

      const target: FormTargetType = readFormTargetType(loaded.targetType);
      const questions: Array<FormField> = readFormFields(loaded.fields);

      // The records each choice question offers, every kind once.
      const sources: Set<FormTargetOptionsSource> =
        new Set<FormTargetOptionsSource>();

      for (const question of questions) {
        if (question.source !== FormFieldSource.TargetField) {
          continue;
        }

        const definition: FormTargetFieldDefinition | undefined =
          getFormTargetField(target, question.targetField);

        if (definition?.optionsSource) {
          sources.add(definition.optionsSource);
        }
      }

      const options: RecordOptions = {};

      for (const source of sources) {
        options[source] = await loadFormRecordOptions(source);
      }

      const asksCustomField: boolean = questions.some(
        (question: FormField): boolean => {
          return question.source === FormFieldSource.TargetCustomField;
        },
      );

      setCustomFields(asksCustomField ? await loadFormCustomFields(target) : []);
      setRecordOptions(options);
      setTemplates(readFormTemplates(loaded.templates));
      setForm(loaded);
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    setEditor(null);
    setDeleting(null);
    await load();
  }, [props.formId.toString()]);

  /*
   * Saves the whole list. Resolves true once it is stored; otherwise the
   * server's reason goes where the change was made.
   */
  const persist: (
    next: Array<FormTemplate>,
    onError: (message: string) => void,
  ) => Promise<boolean> = async (
    next: Array<FormTemplate>,
    onError: (message: string) => void,
  ): Promise<boolean> => {
    setIsSaving(true);
    setListError("");

    try {
      await ModelAPI.updateById<Form>({
        modelType: Form,
        id: props.formId,
        data: {
          templates: next as unknown as JSONArray,
        },
      });

      setTemplates(next);
      setIsSaving(false);
      return true;
    } catch (err) {
      onError(API.getFriendlyMessage(err));
      setIsSaving(false);
      return false;
    }
  };

  if (isLoading) {
    return (
      <Card title="Templates" description={FormsCopy.templatesDescription}>
        <ComponentLoader />
      </Card>
    );
  }

  if (loadError || !form) {
    return (
      <Card title="Templates" description={FormsCopy.templatesDescription}>
        <ErrorMessage message={loadError || FormsCopy.formNotFound} />
      </Card>
    );
  }

  const targetType: FormTargetType = readFormTargetType(form.targetType);

  const built: BuiltPublicForm = buildPublicForm({
    form: {
      name: form.name,
      fields: form.fields,
      targetType: targetType,
    },
    customFields: customFields,
    recordOptions: recordOptions,
    isCaptchaRequired: false,
  });

  const questions: Array<FormTemplateEditorQuestion> =
    getFormTemplateEditorQuestions(built);

  const isFull: boolean = templates.length >= FORM_MAX_TEMPLATES;

  const shareKey: string | undefined = form.shareKey?.toString();

  const listChange: (change: Array<FormTemplate>) => void = (
    change: Array<FormTemplate>,
  ): void => {
    void persist(change, setListError);
  };

  const getEditorFields: () => Array<Field<JSONObject>> = (): Array<
    Field<JSONObject>
  > => {
    const hiddenIds: Set<string> = new Set<string>(
      questions
        .filter((question: FormTemplateEditorQuestion): boolean => {
          return question.isHidden;
        })
        .map((question: FormTemplateEditorQuestion): string => {
          return question.field.id;
        }),
    );

    const questionFields: Array<Field<JSONObject>> = buildPublicFormFields(
      {
        ...built.form,
        fields: questions.map(
          (question: FormTemplateEditorQuestion): PublicFormField => {
            return question.field;
          },
        ),
      },
      { dataTestIdPrefix: "form-template-field" },
    ).map((field: Field<JSONObject>): Field<JSONObject> => {
      const key: string = Object.keys(field.field || {})[0] || "";
      const isHidden: boolean = Array.from(hiddenIds).some(
        (id: string): boolean => {
          return getPublicFormFieldKey(id) === key;
        },
      );

      if (!isHidden) {
        return field;
      }

      // Said in the reader's language here: FieldLabel looks strings up.
      const note: string = tx(FormsCopy.hiddenQuestionHelp);

      return {
        ...field,
        description:
          typeof field.description === "string" && field.description
            ? `${note} ${field.description}`
            : note,
      };
    });

    return [
      {
        field: { [TEMPLATE_NAME_KEY]: true },
        title: "Template Name",
        description: FormsCopy.templateNameDescription,
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: FormsCopy.templateNamePlaceholder,
        validation: { maxLength: FORM_TEMPLATE_NAME_MAX_LENGTH },
        dataTestId: "form-template-name",
      },
      {
        field: { [TEMPLATE_DEFAULT_KEY]: true },
        title: "Default Template",
        description: FormsCopy.defaultTemplateDescription,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        dataTestId: "form-template-default",
      },
      ...questionFields,
    ];
  };

  const renderTemplate: (
    template: FormTemplate,
    index: number,
  ) => ReactElement = (template: FormTemplate, index: number): ReactElement => {
    const labels: Array<string> = getFormTemplateAnsweredLabels({
      template,
      questions,
    });

    return (
      <li
        key={template.id}
        className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between"
        data-testid={`form-template-${template.id}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
              data-testid={`form-template-name-${template.id}`}
            >
              {template.name}
            </span>
            {template.isDefault ? (
              <span
                className="inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
                data-testid={`form-template-default-${template.id}`}
              >
                {tx("Default")}
              </span>
            ) : (
              <></>
            )}
          </div>
          {labels.length > 0 ? (
            <ul
              className="mt-2 flex flex-wrap gap-1"
              data-testid={`form-template-answers-${template.id}`}
            >
              {labels.slice(0, LISTED_LABELS).map(
                (label: string, labelIndex: number): ReactElement => {
                  return (
                    <li
                      key={`${labelIndex}-${label}`}
                      className="max-w-full truncate rounded-md bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600 ring-1 ring-inset ring-gray-200"
                    >
                      {label}
                    </li>
                  );
                },
              )}
              {labels.length > LISTED_LABELS ? (
                <li className="px-1 py-0.5 text-xs text-gray-500">
                  +{labels.length - LISTED_LABELS}
                </li>
              ) : (
                <></>
              )}
            </ul>
          ) : (
            <></>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {shareKey ? (
            <CopyTextButton
              textToBeCopied={getFormTemplateShareLink({
                shareKey,
                templateId: template.id,
              })}
              label={FormsCopy.copyLink}
              copiedLabel={translateString("Copied!") || "Copied!"}
              title={FormsCopy.copyLink}
              size="sm"
              variant="soft"
            />
          ) : (
            <></>
          )}
          {isReadOnly ? (
            <></>
          ) : (
            <>
              <button
                type="button"
                className={ICON_BUTTON_CLASS_NAME}
                aria-label={`${tx(FormsCopy.moveUp)}: ${template.name}`}
                title={tx(FormsCopy.moveUp)}
                disabled={index === 0 || isSaving}
                data-testid={`form-template-move-up-${template.id}`}
                onClick={() => {
                  listChange(
                    moveFormTemplate({ templates, id: template.id, offset: -1 }),
                  );
                }}
              >
                <Icon icon={IconProp.ChevronUp} className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={ICON_BUTTON_CLASS_NAME}
                aria-label={`${tx(FormsCopy.moveDown)}: ${template.name}`}
                title={tx(FormsCopy.moveDown)}
                disabled={index === templates.length - 1 || isSaving}
                data-testid={`form-template-move-down-${template.id}`}
                onClick={() => {
                  listChange(
                    moveFormTemplate({ templates, id: template.id, offset: 1 }),
                  );
                }}
              >
                <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
              </button>
              <Button
                title="Edit"
                icon={IconProp.Edit}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                className="!ml-0"
                disabled={isSaving}
                dataTestId={`form-template-edit-${template.id}`}
                onClick={() => {
                  setEditorError("");
                  setEditor({ template });
                }}
              />
              <Button
                title={FormsCopy.duplicate}
                icon={IconProp.DocumentDuplicate}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                className="!ml-0"
                disabled={isFull || isSaving}
                tooltip={isFull ? FormsCopy.templatesFull : undefined}
                dataTestId={`form-template-duplicate-${template.id}`}
                onClick={() => {
                  const change: FormTemplatesChange = duplicateFormTemplate({
                    templates,
                    id: template.id,
                  });

                  listChange(change.templates);
                }}
              />
              <Button
                title="Delete"
                icon={IconProp.Trash}
                buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                buttonSize={ButtonSize.Small}
                className="!ml-0"
                disabled={isSaving}
                dataTestId={`form-template-delete-${template.id}`}
                onClick={() => {
                  setDeleting(template);
                }}
              />
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <Card
        title="Templates"
        description={FormsCopy.templatesDescription}
        buttons={
          isReadOnly
            ? []
            : [
                {
                  title: FormsCopy.addTemplate,
                  icon: IconProp.Add,
                  buttonStyle: ButtonStyleType.NORMAL,
                  disabled: isFull || isSaving,
                  tooltip: isFull ? FormsCopy.templatesFull : undefined,
                  onClick: () => {
                    setEditorError("");
                    setEditor({ template: undefined });
                  },
                },
              ]
        }
      >
        <div data-testid="form-templates">
          {isReadOnly && updateGate.disabledReason ? (
            <div className="mb-4">
              <Alert
                type={AlertType.INFO}
                title={updateGate.disabledReason}
                dataTestId="form-templates-read-only"
              />
            </div>
          ) : (
            <></>
          )}

          {listError ? (
            <div className="mb-4">
              <Alert
                type={AlertType.DANGER}
                title={<span>{listError}</span>}
                dataTestId="form-templates-error"
              />
            </div>
          ) : (
            <></>
          )}

          {templates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300">
              <EmptyState
                id="form-templates-empty"
                icon={IconProp.DocumentDuplicate}
                title="Templates"
                description={FormsCopy.templatesEmpty}
                paddingClassName="py-10"
              />
            </div>
          ) : (
            <ul className="space-y-3" data-testid="form-templates-list">
              {templates.map(renderTemplate)}
            </ul>
          )}
        </div>
      </Card>

      {editor ? (
        <BasicFormModal<JSONObject>
          title={editor.template ? FormsCopy.editTemplate : FormsCopy.addTemplate}
          description={FormsCopy.templateAnswersDescription}
          name="form-template"
          modalWidth={ModalWidth.Large}
          isLoading={isSaving}
          error={editorError || undefined}
          submitButtonText="Save"
          onClose={() => {
            setEditor(null);
            setEditorError("");
          }}
          onSubmit={(values: JSONObject) => {
            const template: FormTemplate = readFormTemplateFromEditor({
              values,
              questions,
              template: editor.template,
            });

            const change: FormTemplatesChange = saveFormTemplate({
              templates,
              template,
            });

            void persist(change.templates, setEditorError).then(
              (isSaved: boolean): void => {
                if (isSaved) {
                  setEditor(null);
                }
              },
            );
          }}
          formProps={{
            id: "form-template-form",
            fields: getEditorFields(),
            initialValues: getFormTemplateEditorValues({
              template: editor.template,
              questions,
            }),
          }}
        />
      ) : (
        <></>
      )}

      {deleting ? (
        <ConfirmModal
          title={FormsCopy.deleteTemplateTitle}
          description={FormsCopy.deleteTemplateDescription}
          submitButtonText="Delete"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          onClose={() => {
            setDeleting(null);
          }}
          onSubmit={() => {
            const removed: FormTemplate = deleting;

            void persist(
              removeFormTemplate({ templates, id: removed.id }),
              setListError,
            ).then((): void => {
              setDeleting(null);
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default FormTemplates;
