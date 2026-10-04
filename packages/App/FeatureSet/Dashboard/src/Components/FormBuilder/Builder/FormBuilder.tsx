import FormBrandingSection from "../Branding/FormBrandingSection";
import {
  FORM_BRANDING_SELECT,
  FormBrandingValues,
  readFormBrandingValues,
} from "../Branding/FormBrandingValues";
import {
  loadFormCustomFields,
  loadFormRecordOptions,
} from "../FormBuilderData";
import {
  areFormFieldsEqual,
  createPaletteField,
  duplicateFormField,
  FormFieldsChange,
  FormPaletteState,
  getFormPaletteState,
  insertFormField,
  moveFormField,
  moveFormFieldBy,
  removeFormField,
  updateFormField,
} from "../FormBuilderState";
import FormsCopy from "../FormsCopy";
import FormPreviewModal from "./FormPreviewModal";
import QuestionCard from "./QuestionCard";
import QuestionPalette, { PaletteItem } from "./QuestionPalette";
import Form from "Common/Models/DatabaseModels/Form";
import {
  FormField,
  FormFieldSource,
  readFormFields,
  translateFormFieldDefaults,
  validateFormFields,
} from "Common/Types/Form/FormField";
import {
  FormCustomFieldDefinition,
  FormRecordOption,
} from "Common/Types/Form/FormPublic";
import {
  FormTargetFieldDefinition,
  FormTargetOptionsSource,
  getFormTargetField,
} from "Common/Types/Form/FormTargetCatalog";
import { readFormTargetSettings } from "Common/Types/Form/FormTargetSettings";
import FormTargetType, {
  readFormTargetType,
} from "Common/Types/Form/FormTargetType";
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
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DroppableProvided,
  DropResult,
} from "react-beautiful-dnd";
import useAsyncEffect from "use-async-effect";

/*
 * The form builder (Forms > a form > Build): the form as the people it is
 * shared with will see it, built question by question.
 *
 * On the left, the canvas: the form's name and description, then every
 * question in order - drag one by its handle to move it (or use Move Up and
 * Move Down), select one to edit it in place. On the right, the palette:
 * questions of the form's own, the fields of what the form creates, its
 * custom fields and the submitter's details. Preview shows the real public
 * form drawn from the questions being built.
 *
 * Changes are a draft until Save Changes, which writes the questions in one
 * request - the server checks them against the form's target, and says what
 * is wrong if anything is. Closing or reloading the tab with unsaved changes
 * asks first.
 *
 * Over the questions, folded, is the form's Branding (FormBrandingSection):
 * its logo and favicon, the OneUptime ones until it has its own. They are
 * saved on their own, from the section's dialog, and never touch a draft of
 * the questions; Preview draws the logo as the page will.
 */

export interface ComponentProps {
  formId: ObjectID;
}

type RecordOptions = Partial<
  Record<FormTargetOptionsSource, Array<FormRecordOption>>
>;

const FormBuilder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [form, setForm] = useState<Form | null>(null);
  // The name and description shown over the questions; edited on their own.
  const [details, setDetails] = useState<{
    name: string;
    description: string;
  }>({ name: "", description: "" });
  const [savedFields, setSavedFields] = useState<Array<FormField>>([]);
  const [fields, setFields] = useState<Array<FormField>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<
    Array<FormCustomFieldDefinition>
  >([]);
  const [recordOptions, setRecordOptions] = useState<RecordOptions>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [hasJustSaved, setHasJustSaved] = useState<boolean>(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [isEditingDetails, setIsEditingDetails] = useState<boolean>(false);
  // The logo, its alt text and the favicon: the Branding section's.
  const [branding, setBranding] = useState<FormBrandingValues>({});
  const [brandingError, setBrandingError] = useState<string>("");

  // Sources whose records are loaded or on their way, so each loads once.
  const requestedSourcesRef: React.MutableRefObject<
    Set<FormTargetOptionsSource>
  > = useRef<Set<FormTargetOptionsSource>>(new Set());

  const targetType: FormTargetType = readFormTargetType(form?.targetType);

  const isDirty: boolean = !areFormFieldsEqual(fields, savedFields);

  const updateGate: PermissionGateResult = PermissionGate.check(
    new Form(),
    ModelAction.Update,
  );
  const isReadOnly: boolean = !updateGate.isAllowed;

  // The records a choice can offer, loaded the first time one needs them.
  const ensureRecordOptions: (
    source: FormTargetOptionsSource,
  ) => Promise<void> = async (
    source: FormTargetOptionsSource,
  ): Promise<void> => {
    if (requestedSourcesRef.current.has(source)) {
      return;
    }

    requestedSourcesRef.current.add(source);

    try {
      const options: Array<FormRecordOption> =
        await loadFormRecordOptions(source);

      setRecordOptions((current: RecordOptions): RecordOptions => {
        return { ...current, [source]: options };
      });
    } catch (err) {
      requestedSourcesRef.current.delete(source);
      setSaveError(API.getFriendlyMessage(err));
    }
  };

  const ensureRecordOptionsForFields: (
    questions: Array<FormField>,
    target: FormTargetType,
  ) => void = (questions: Array<FormField>, target: FormTargetType): void => {
    for (const question of questions) {
      if (question.source !== FormFieldSource.TargetField) {
        continue;
      }

      const definition: FormTargetFieldDefinition | undefined =
        getFormTargetField(target, question.targetField);

      if (definition?.optionsSource) {
        void ensureRecordOptions(definition.optionsSource);
      }
    }
  };

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setLoadError("");

    try {
      const loaded: Form | null = await ModelAPI.getItem<Form>({
        modelType: Form,
        id: props.formId,
        select: {
          name: true,
          description: true,
          targetType: true,
          fields: true,
          targetSettings: true,
          ...FORM_BRANDING_SELECT,
        },
      });

      if (!loaded) {
        setLoadError(FormsCopy.formNotFound);
        setIsLoading(false);
        return;
      }

      const target: FormTargetType = readFormTargetType(loaded.targetType);
      const questions: Array<FormField> = readFormFields(loaded.fields);

      setForm(loaded);
      setDetails({
        name: loaded.name || "",
        description: loaded.description || "",
      });
      setBranding(readFormBrandingValues(loaded));
      setSavedFields(questions);
      setFields(questions);
      setCustomFields(await loadFormCustomFields(target));
      ensureRecordOptionsForFields(questions, target);
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    requestedSourcesRef.current = new Set();
    setRecordOptions({});
    setSelectedId(null);
    await load();
  }, [props.formId.toString()]);

  // Leaving the page (closing the tab) with unsaved changes asks first.
  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const warn: (event: BeforeUnloadEvent) => void = (
      event: BeforeUnloadEvent,
    ): void => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);

    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [isDirty]);

  const applyChange: (change: FormFieldsChange) => void = (
    change: FormFieldsChange,
  ): void => {
    setFields(change.fields);
    setSelectedId(change.selectedId);
    setHasJustSaved(false);
    setSaveError("");
  };

  const addFromPalette: (item: PaletteItem) => void = (
    item: PaletteItem,
  ): void => {
    // A field's suggested label and help text, in the reader's language.
    const field: FormField = translateFormFieldDefaults({
      fields: [createPaletteField(item)],
      targetType: targetType,
      translate: tx,
    })[0] as FormField;

    if (item.kind === "target" && item.definition.optionsSource) {
      void ensureRecordOptions(item.definition.optionsSource);
    }

    applyChange(
      insertFormField({
        fields: fields,
        field: field,
        afterId: selectedId,
      }),
    );

    // The new question's card scrolls into view once it is drawn.
    window.setTimeout(() => {
      document
        .querySelector(`[data-testid="form-question-${field.id}"]`)
        ?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 0);
  };

  /*
   * The name and description again, after they were edited: only those, so
   * a draft of the questions is kept as it is.
   */
  const reloadDetails: () => Promise<void> = async (): Promise<void> => {
    try {
      const loaded: Form | null = await ModelAPI.getItem<Form>({
        modelType: Form,
        id: props.formId,
        select: {
          name: true,
          description: true,
        },
      });

      if (!loaded) {
        return;
      }

      setDetails({
        name: loaded.name || "",
        description: loaded.description || "",
      });
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }
  };

  // The branding again, after the Branding section saved it.
  const reloadBranding: () => Promise<void> = async (): Promise<void> => {
    try {
      const loaded: Form | null = await ModelAPI.getItem<Form>({
        modelType: Form,
        id: props.formId,
        select: FORM_BRANDING_SELECT,
      });

      if (!loaded) {
        return;
      }

      setBranding(readFormBrandingValues(loaded));
      setBrandingError("");
    } catch (err) {
      // Said in the Branding section: the questions were not touched.
      setBrandingError(API.getFriendlyMessage(err));
    }
  };

  const save: () => Promise<void> = async (): Promise<void> => {
    const problem: string | null = validateFormFields({
      value: fields,
      targetType: targetType,
    });

    if (problem) {
      setSaveError(problem);
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await ModelAPI.updateById<Form>({
        modelType: Form,
        id: props.formId,
        data: {
          fields: fields as unknown as JSONArray,
        },
      });

      setSavedFields(fields);
      setHasJustSaved(true);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const onDragEnd: (result: DropResult) => void = (
    result: DropResult,
  ): void => {
    if (!result.destination) {
      return;
    }

    applyChange({
      fields: moveFormField({
        fields: fields,
        fromIndex: result.source.index,
        toIndex: result.destination.index,
      }),
      selectedId: selectedId,
    });
  };

  if (isLoading) {
    return (
      <Card
        title={FormsCopy.builderTitle}
        description={FormsCopy.builderDescription}
      >
        <ComponentLoader />
      </Card>
    );
  }

  if (loadError || !form) {
    return (
      <Card
        title={FormsCopy.builderTitle}
        description={FormsCopy.builderDescription}
      >
        <ErrorMessage message={loadError || FormsCopy.formNotFound} />
      </Card>
    );
  }

  const palette: FormPaletteState = getFormPaletteState({
    fields: fields,
    targetType: targetType,
    customFields: customFields,
  });

  const defaultOptionValues: Partial<Record<string, string>> = {};
  const incidentSeverityId: unknown = (
    readFormTargetSettings({
      targetType: targetType,
      value: form.targetSettings,
    }) as JSONObject
  )["incidentSeverityId"];

  if (typeof incidentSeverityId === "string") {
    defaultOptionValues["incidentSeverityId"] = incidentSeverityId;
  }

  const statusText: string = isDirty
    ? FormsCopy.unsavedChanges
    : hasJustSaved
      ? FormsCopy.savedChanges
      : "";

  return (
    <>
      <FormBrandingSection
        formId={props.formId}
        formName={details.name}
        values={branding}
        isReadOnly={isReadOnly}
        error={brandingError}
        onSaved={() => {
          void reloadBranding();
        }}
      />

      <Card
        title={FormsCopy.builderTitle}
        description={FormsCopy.builderDescription}
        buttons={[
          {
            title: FormsCopy.preview,
            icon: IconProp.Eye,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setIsPreviewOpen(true);
            },
          },
          ...(isReadOnly
            ? []
            : [
                {
                  title: FormsCopy.saveChanges,
                  icon: IconProp.Check,
                  buttonStyle: ButtonStyleType.PRIMARY,
                  disabled: !isDirty || isSaving,
                  isLoading: isSaving,
                  onClick: () => {
                    void save();
                  },
                },
              ]),
        ]}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2" data-testid="form-canvas">
            {isReadOnly && updateGate.disabledReason ? (
              <div className="mb-4">
                <Alert
                  type={AlertType.INFO}
                  title={updateGate.disabledReason}
                  dataTestId="form-builder-read-only"
                />
              </div>
            ) : (
              <></>
            )}

            {saveError ? (
              <div className="mb-4">
                <Alert
                  type={AlertType.DANGER}
                  title={<span>{saveError}</span>}
                  dataTestId="form-builder-save-error"
                />
              </div>
            ) : (
              <></>
            )}

            {statusText || isDirty ? (
              <div
                className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
                data-testid="form-builder-status"
              >
                <span
                  className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                    isDirty ? "text-amber-700" : "text-emerald-700"
                  }`}
                >
                  <Icon
                    icon={isDirty ? IconProp.Pencil : IconProp.CheckCircle}
                    className="h-4 w-4"
                  />
                  {tx(statusText)}
                </span>
                {isDirty && !isReadOnly ? (
                  <Button
                    title={FormsCopy.discardChanges}
                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                    buttonSize={ButtonSize.Small}
                    dataTestId="form-builder-discard"
                    onClick={() => {
                      applyChange({ fields: savedFields, selectedId: null });
                    }}
                  />
                ) : (
                  <></>
                )}
              </div>
            ) : (
              <></>
            )}

            <div className="mb-4 rounded-lg border border-gray-200 border-t-4 border-t-indigo-500 bg-white p-4">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                <h3
                  className="min-w-0 text-lg font-semibold text-gray-900 [overflow-wrap:anywhere]"
                  data-testid="form-builder-name"
                >
                  {details.name}
                </h3>
                {isReadOnly ? (
                  <></>
                ) : (
                  <Button
                    title={FormsCopy.editFormDetails}
                    icon={IconProp.Edit}
                    buttonStyle={ButtonStyleType.NORMAL}
                    buttonSize={ButtonSize.Small}
                    className="shrink-0"
                    dataTestId="form-builder-edit-details"
                    onClick={() => {
                      setIsEditingDetails(true);
                    }}
                  />
                )}
              </div>
              {details.description ? (
                <div className="mt-2 text-sm text-gray-700">
                  <MarkdownViewer text={details.description} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-500">
                  {tx(FormsCopy.noDescription)}
                </p>
              )}
            </div>

            {fields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300">
                <EmptyState
                  id="form-builder-empty"
                  icon={IconProp.ClipboardDocumentList}
                  title={FormsCopy.emptyCanvasTitle}
                  description={FormsCopy.emptyCanvasDescription}
                  paddingClassName="py-10"
                />
              </div>
            ) : (
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable
                  droppableId="form-questions"
                  isDropDisabled={isReadOnly}
                >
                  {(droppableProvided: DroppableProvided) => {
                    return (
                      <div
                        ref={droppableProvided.innerRef}
                        {...droppableProvided.droppableProps}
                        className="space-y-3"
                        data-testid="form-questions"
                      >
                        {fields.map(
                          (field: FormField, index: number): ReactElement => {
                            return (
                              <Draggable
                                key={field.id}
                                draggableId={field.id}
                                index={index}
                                isDragDisabled={isReadOnly}
                              >
                                {(draggableProvided: DraggableProvided) => {
                                  return (
                                    <div
                                      ref={draggableProvided.innerRef}
                                      {...draggableProvided.draggableProps}
                                    >
                                      <QuestionCard
                                        field={field}
                                        index={index}
                                        count={fields.length}
                                        targetType={targetType}
                                        customFields={customFields}
                                        recordOptions={recordOptions}
                                        isSelected={selectedId === field.id}
                                        isReadOnly={isReadOnly}
                                        dragHandleProps={
                                          draggableProvided.dragHandleProps
                                        }
                                        onSelect={() => {
                                          setSelectedId(field.id);
                                          ensureRecordOptionsForFields(
                                            [field],
                                            targetType,
                                          );
                                        }}
                                        onDeselect={() => {
                                          setSelectedId(null);
                                        }}
                                        onChange={(
                                          changes: Partial<FormField>,
                                        ) => {
                                          applyChange({
                                            fields: updateFormField({
                                              fields: fields,
                                              id: field.id,
                                              changes: changes,
                                            }),
                                            selectedId: field.id,
                                          });
                                        }}
                                        onMove={(offset: number) => {
                                          applyChange({
                                            fields: moveFormFieldBy({
                                              fields: fields,
                                              id: field.id,
                                              offset: offset,
                                            }),
                                            selectedId: selectedId,
                                          });
                                        }}
                                        onDuplicate={() => {
                                          applyChange(
                                            duplicateFormField({
                                              fields: fields,
                                              id: field.id,
                                            }),
                                          );
                                        }}
                                        onDelete={() => {
                                          applyChange(
                                            removeFormField({
                                              fields: fields,
                                              id: field.id,
                                              targetType: targetType,
                                            }),
                                          );
                                        }}
                                      />
                                    </div>
                                  );
                                }}
                              </Draggable>
                            );
                          },
                        )}
                        {droppableProvided.placeholder}
                      </div>
                    );
                  }}
                </Droppable>
              </DragDropContext>
            )}
          </div>

          {isReadOnly ? (
            <></>
          ) : (
            <aside className="min-w-0" data-testid="form-builder-palette">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 lg:sticky lg:top-4">
                <h3 className="px-2 text-sm font-semibold text-gray-900">
                  {tx(FormsCopy.addQuestionTitle)}
                </h3>
                <p className="mb-3 mt-0.5 px-2 text-xs text-gray-500">
                  {tx(FormsCopy.addQuestionDescription)}
                </p>
                <QuestionPalette
                  targetType={targetType}
                  palette={palette}
                  onAdd={addFromPalette}
                />
              </div>
            </aside>
          )}
        </div>
      </Card>

      {isPreviewOpen ? (
        <FormPreviewModal
          name={details.name}
          description={details.description}
          fields={fields}
          targetType={targetType}
          customFields={customFields}
          recordOptions={recordOptions}
          defaultOptionValues={defaultOptionValues}
          branding={branding}
          onClose={() => {
            setIsPreviewOpen(false);
          }}
        />
      ) : (
        <></>
      )}

      {isEditingDetails ? (
        <ModelFormModal<Form>
          title={FormsCopy.editFormDetails}
          submitButtonText={FormsCopy.saveChanges}
          modalWidth={ModalWidth.Large}
          name="form-details"
          modelType={Form}
          modelIdToEdit={props.formId}
          onClose={() => {
            setIsEditingDetails(false);
          }}
          onSuccess={() => {
            setIsEditingDetails(false);
            void reloadDetails();
          }}
          formProps={{
            id: "form-details-form",
            modelType: Form,
            formType: FormType.Update,
            name: "Form Details",
            fields: [
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
              {
                field: {
                  description: true,
                },
                title: "Description",
                description: FormsCopy.descriptionDescription,
                fieldType: FormFieldSchemaType.Markdown,
                required: false,
                // Shown on the public page, where a private image cannot load.
                allowImageUpload: false,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default FormBuilder;
