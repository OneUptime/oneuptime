import ComponentLoader from "../ComponentLoader/ComponentLoader";
import { CodeEditorActions } from "../CodeEditor/CodeEditor";
import DictionaryForm, { ValueType } from "../Dictionary/Dictionary";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, { FormProps } from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "../Forms/Types/Field";
import { getAdvancedFormSection } from "../Forms/Utils/AdvancedFormSection";
import FormValues from "../Forms/Types/FormValues";
import ConditionEditor from "./Condition/ConditionEditor";
import CronScheduleField from "./CronScheduleField";
import ModelColumnEditor, {
  ModelColumnEditorMode,
  RecordIntent,
} from "./ModelColumnEditor";
import ModelFieldPicker from "./ModelFieldPicker";
import {
  ArgumentFormFieldType,
  componentInputTypeToFormFieldType,
  parseStringDictionaryValue,
} from "./Utils";
import {
  ArgumentControl,
  argumentControlFor,
} from "./ValuePicker/ArgumentControl";
import InsertValueButton from "./ValuePicker/InsertValueButton";
import { StepValueSources } from "./ValuePicker/StepGraph";
import {
  containsTemplateExpression,
  referenceForJSON,
} from "./ValuePicker/TemplateText";
import { ValuePickerProvider } from "./ValuePicker/ValuePickerContext";
import ValueSingleField, {
  ValueSingleFieldKind,
} from "./ValuePicker/ValueSingleField";
import { ValueSuggestionSource } from "./ValuePicker/ValueSuggestion";
import ValueTextField from "./ValuePicker/ValueTextField";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import {
  Argument,
  ComponentInputType,
  NodeDataProp,
  isArgumentRequired,
  isJSON5ToleratedInputType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { DropdownOption } from "../Dropdown/Dropdown";
import {
  getRecordChoiceSource,
  getRecordChoiceTypes,
  loadRecordChoices,
} from "./RecordChoices";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  translatableTerm,
  translateText,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

export interface ComponentProps {
  component: NodeDataProp;
  onHasFormValidationErrors: (values: Dictionary<boolean>) => void;
  workflowId: ObjectID;
  graphComponents: Array<NodeDataProp>;
  /*
   * Which steps run before and after this one (ValuePicker/StepGraph). The
   * value picker only offers the ones before. Without it, every other step.
   */
  valueSources?: StepValueSources | undefined;
  /*
   * Where the value picker's values come from: the steps before this one,
   * what they held the last times they ran, and the variables, unless a
   * caller says otherwise.
   */
  valueSuggestionSources?: Array<ValueSuggestionSource> | undefined;
  /*
   * The workflow's webhook URL, when the reader may see it. A step after a
   * Webhook that nothing has called yet offers a test request to copy.
   */
  webhookUrl?: string | undefined;
  onFormChange: (value: NodeDataProp) => void;
}

const SINGLE_FIELD_KINDS: Partial<
  Record<ArgumentControl, ValueSingleFieldKind>
> = {
  [ArgumentControl.Number]: ValueSingleFieldKind.Number,
  [ArgumentControl.Password]: ValueSingleFieldKind.Password,
  [ArgumentControl.Boolean]: ValueSingleFieldKind.Boolean,
  [ArgumentControl.Date]: ValueSingleFieldKind.Date,
  [ArgumentControl.DateTime]: ValueSingleFieldKind.DateTime,
};

type DescribeArgumentFunction = (
  translator: Translator,
  arg: Argument,
  // The step's settings as they are now, for one another can make optional.
  values?: JSONObject | undefined,
) => string;

// "Required. Where the email is sent." - the step's own words after the first.
export const REQUIRED_ARGUMENT_HELP: string = translationKey(
  "Required. {{description}}",
);
export const OPTIONAL_ARGUMENT_HELP: string = translationKey(
  "Optional. {{description}}",
);

/*
 * A setting's help: whether it is required, then what it is for. Under the
 * label for most settings, and under a switch's name beside it. Whether it
 * is required is read as the step is set up now (isArgumentRequired):
 * Create One Incident's JSON Object is optional once a template is picked.
 */
const describeArgument: DescribeArgumentFunction = (
  translator: Translator,
  arg: Argument,
  values?: JSONObject | undefined,
): string => {
  return translator.translateTemplate(
    isArgumentRequired(arg, values)
      ? REQUIRED_ARGUMENT_HELP
      : OPTIONAL_ARGUMENT_HELP,
    { description: translatableTerm(arg.description) },
  );
};

type ValidateTypedValueFunction = (
  type: ComponentInputType,
  value: unknown,
) => string | null;

/*
 * The checks a URL or an email box made of what was typed in it. They only
 * apply to a value typed out in full: one with a reference in it is not
 * known until the step runs.
 */
export const validateTypedValue: ValidateTypedValueFunction = (
  type: ComponentInputType,
  value: unknown,
): string | null => {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  if (containsTemplateExpression(value)) {
    return null;
  }

  if (type === ComponentInputType.URL) {
    try {
      URL.fromString(value.trim());
    } catch (err: unknown) {
      return err instanceof Exception
        ? err.getMessage()
        : (translateText("URL is not valid.") as string);
    }
  }

  if (type === ComponentInputType.Email && !Email.isValid(value.trim())) {
    return translateText("Email is not valid.") as string;
  }

  return null;
};

const ArgumentsForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const formRef: React.MutableRefObject<FormProps<
    FormValues<JSONObject>
  > | null> = useRef<FormProps<FormValues<JSONObject>> | null>(null);
  const [component, setComponent] = useState<NodeDataProp>(props.component);
  const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
    Dictionary<boolean>
  >({});

  /*
   * Arguments flagged isAdvanced are folded under More fields, as every
   * form's rarely needed options are (getAdvancedFormSection), so the
   * settings panel opens on the two or three fields that actually decide
   * what the step does rather than on every knob it has. The folded header
   * names them and shows the ones that hold a value, so an existing
   * configuration is never hidden from the person who comes back to read
   * it. A required argument is never folded, however it is flagged: it
   * belongs with the fields a step cannot do without.
   */
  const collapsibleAdvancedArguments: Array<Argument> = (
    component.metadata.arguments || []
  ).filter((arg: Argument) => {
    return Boolean(arg.isAdvanced) && !arg.required;
  });

  // One More fields section for the step's folded arguments.
  const moreFieldsSection: FormFieldCollapsibleSection<JSONObject> =
    getAdvancedFormSection<JSONObject>({ id: "workflow-step-more-fields" });

  const isCollapsibleAdvanced: (arg: Argument) => boolean = (
    arg: Argument,
  ): boolean => {
    return collapsibleAdvancedArguments.some((advancedArg: Argument) => {
      return advancedArg.id === arg.id;
    });
  };

  /*
   * StringDictionary arguments render as key/value rows, and the row editor
   * needs a real object. Every workflow written before that change stored a
   * JSON string, so parse those on the way into the form. Anything
   * parseStringDictionaryValue declines stays a string and keeps the JSON
   * editor (see componentInputTypeToFormFieldType), so the two always agree.
   */
  const formInitialValues: JSONObject = { ...(component.arguments || {}) };

  for (const arg of component.metadata.arguments || []) {
    if (arg.type !== ComponentInputType.StringDictionary) {
      continue;
    }

    const parsed: JSONObject | null = parseStringDictionaryValue(
      formInitialValues[arg.id],
    );

    if (parsed !== null) {
      formInitialValues[arg.id] = parsed;
    }
  }

  /*
   * Everyday settings first, folded ones last, each group keeping its
   * declared order: the fields of a folded section are one run at the end
   * of the form.
   */
  const orderedArguments: Array<Argument> = [
    ...(component.metadata.arguments || []).filter((arg: Argument) => {
      return !isCollapsibleAdvanced(arg);
    }),
    ...collapsibleAdvancedArguments,
  ];

  /*
   * The project's records that settings picked from a list offer: the
   * workflows of Execute Workflow's Workflow (the one being edited left
   * out), the incident templates of Create One Incident's Incident Template
   * (RecordChoices). Keyed by the setting's type; empty until the fetch
   * completes.
   */
  const recordChoiceTypes: Array<ComponentInputType> = getRecordChoiceTypes(
    component.metadata.arguments,
  );
  const recordChoiceTypesKey: string = recordChoiceTypes.join("|");

  const [recordChoices, setRecordChoices] = useState<
    Partial<Record<ComponentInputType, Array<DropdownOption>>>
  >({});
  const [isLoadingRecordChoices, setIsLoadingRecordChoices] =
    useState<boolean>(false);

  // Only a step with a setting picked from a list waits for its records.
  const isWaitingForRecordChoices: boolean =
    recordChoiceTypes.length > 0 && isLoadingRecordChoices;

  useEffect(() => {
    if (recordChoiceTypes.length === 0) {
      /*
       * A step with no such setting waits for nothing - even when the step
       * shown before it was still fetching its list.
       */
      setIsLoadingRecordChoices(false);
      return;
    }

    let cancelled: boolean = false;
    setIsLoadingRecordChoices(true);

    const loadChoices: () => Promise<void> = async (): Promise<void> => {
      const loaded: Partial<Record<ComponentInputType, Array<DropdownOption>>> =
        {};

      for (const type of recordChoiceTypes) {
        try {
          loaded[type] = await loadRecordChoices({
            type: type,
            workflowId: props.workflowId,
          });
        } catch {
          /*
           * Swallow: the dropdown will simply be empty and the user can try
           * again by re-opening the settings panel.
           */
          loaded[type] = [];
        }
      }

      if (!cancelled) {
        setRecordChoices(loaded);
        setIsLoadingRecordChoices(false);
      }
    };

    void loadChoices();

    return () => {
      cancelled = true;
    };
    // Only re-fetch when the component in the settings panel changes identity.
  }, [component.id, recordChoiceTypesKey]);

  useEffect(() => {
    props.onHasFormValidationErrors(hasFormValidationErrors);
  }, [hasFormValidationErrors]);

  useEffect(() => {
    props.onFormChange(component);
  }, [component]);

  type FieldForArgumentFunction = (
    arg: Argument,
    argIndex: number,
  ) => ArgumentFormFieldType & {
    getCustomElement?: (
      values: FormValues<JSONObject>,
      customProps: CustomElementProps,
    ) => ReactElement | undefined;
    codeEditorToolbarActions?:
      | ((editor: CodeEditorActions) => ReactNode)
      | undefined;
    customElementDrawsOwnLabel?: boolean | undefined;
  };

  const fieldForArgument: FieldForArgumentFunction = (
    arg: Argument,
    argIndex: number,
  ) => {
    const storedValue: unknown =
      component.arguments && component.arguments[arg.id]
        ? component.arguments[arg.id]
        : null;

    /*
     * Database Select args (the "Select Fields" / "Listen on" trigger inputs)
     * get a tree-style field picker backed by the model's schema, instead of
     * a raw JSON textarea. We need a tableName on the component metadata to
     * fetch the column list; without it, fall back to the JSON editor.
     */
    if (
      arg.type === ComponentInputType.Select &&
      Boolean(component.metadata.tableName)
    ) {
      return {
        fieldType: FormFieldSchemaType.CustomComponent,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customProps: CustomElementProps,
        ): ReactElement => {
          return (
            <ModelFieldPicker
              tableName={component.metadata.tableName as string}
              initialValue={customProps.initialValue}
              onChange={(value: string) => {
                void customProps.onChange?.(value);
              }}
              placeholder={customProps.placeholder}
              error={customProps.error}
              tabIndex={customProps.tabIndex}
            />
          );
        },
      };
    }

    /*
     * Query arguments (which records does this act on) and the write payload
     * (which values does it set) are both keyed on the model's columns, so
     * both get the row editor backed by the model schema. Same tableName
     * requirement as the field picker.
     *
     * The write payload is typed JSON, not BaseModel: Create One's "json" and
     * Update's "data" are declared ComponentInputType.JSON in
     * Types/Workflow/Components/BaseModel, and BaseModel appears there only as
     * a *return* value. Retyping those arguments would move them into
     * JSON5_TOLERANT_INPUT_TYPES and change how RunWorkflow parses them, so
     * the predicate is widened instead.
     *
     * tableName is set only by the database component generator, and the
     * only JSON-typed arguments on those components are the two above, so
     * this cannot reach a JSON argument on any other component.
     *
     * JSONArray (Create Many) is deliberately not included: it holds a list
     * of records, which rows cannot represent.
     *
     * Each of the row editor's value cells is a value picker of its own.
     */
    const columnEditorMode: ModelColumnEditorMode | undefined = !component
      .metadata.tableName
      ? undefined
      : arg.type === ComponentInputType.Query
        ? ModelColumnEditorMode.Query
        : arg.type === ComponentInputType.JSON ||
            arg.type === ComponentInputType.BaseModel
          ? ModelColumnEditorMode.Record
          : undefined;

    if (columnEditorMode) {
      return {
        fieldType: FormFieldSchemaType.CustomComponent,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customProps: CustomElementProps,
        ): ReactElement => {
          return (
            <ModelColumnEditor
              tableName={component.metadata.tableName as string}
              mode={columnEditorMode}
              /*
               * A create writes a whole record, so it opens with a row for
               * every column it must be given. An update legitimately writes
               * one column. The create payload is the argument called "json"
               * (BaseModel components); an update's is "data".
               */
              recordIntent={
                arg.id === "json" ? RecordIntent.Create : RecordIntent.Update
              }
              initialValue={customProps.initialValue}
              onChange={(value: string) => {
                void customProps.onChange?.(value);
              }}
              placeholder={customProps.placeholder}
              error={customProps.error}
              tabIndex={customProps.tabIndex}
            />
          );
        },
      };
    }

    /*
     * The Schedule trigger's CronTab argument gets a dedicated cron picker
     * (presets, custom expression with live preview, or a variable) instead
     * of a bare dropdown.
     */
    if (arg.type === ComponentInputType.CronTab) {
      return {
        fieldType: FormFieldSchemaType.CustomComponent,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customProps: CustomElementProps,
        ): ReactElement => {
          return (
            <CronScheduleField
              initialValue={customProps.initialValue as string | null}
              onChange={(value: string) => {
                void customProps.onChange?.(value);
              }}
              placeholder={customProps.placeholder}
              error={customProps.error}
              tabIndex={customProps.tabIndex}
            />
          );
        },
      };
    }

    const control: ArgumentControl = argumentControlFor({
      type: arg.type,
      value: storedValue,
      isRowsDictionary:
        arg.type === ComponentInputType.StringDictionary &&
        parseStringDictionaryValue(storedValue) !== null,
    });

    /*
     * The first setting takes the focus as the dialog opens, as BasicForm
     * gives it to a first text box: the keyboard starts where the step is set
     * up.
     */
    const autoFocus: boolean = argIndex === 0;

    if (
      control === ArgumentControl.Text ||
      control === ArgumentControl.MultiLineText
    ) {
      return {
        fieldType: FormFieldSchemaType.CustomComponent,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customProps: CustomElementProps,
        ): ReactElement => {
          return (
            <ValueTextField
              value={customProps.initialValue}
              onChange={(value: string) => {
                void customProps.onChange?.(value);
              }}
              multiline={control === ArgumentControl.MultiLineText}
              placeholder={customProps.placeholder}
              ariaLabelledby={customProps.ariaLabelledby}
              error={customProps.error}
              autoFocus={autoFocus}
              tabIndex={customProps.tabIndex}
              dataTestId={`workflow-argument-${arg.id}`}
              onBlur={customProps.onBlur}
            />
          );
        },
      };
    }

    const singleKind: ValueSingleFieldKind | undefined =
      SINGLE_FIELD_KINDS[control];

    if (singleKind) {
      /*
       * A switch is one row, as a switch field is everywhere else: the
       * switch, its name beside it and its help under the name. The form
       * draws no label above it.
       */
      const isSwitch: boolean = singleKind === ValueSingleFieldKind.Boolean;

      return {
        fieldType: FormFieldSchemaType.CustomComponent,
        customElementDrawsOwnLabel: isSwitch,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customProps: CustomElementProps,
        ): ReactElement => {
          return (
            <ValueSingleField
              kind={singleKind}
              title={isSwitch ? arg.name : undefined}
              description={
                isSwitch ? describeArgument(translator, arg) : undefined
              }
              value={
                singleKind === ValueSingleFieldKind.Boolean
                  ? component.arguments?.[arg.id]
                  : customProps.initialValue
              }
              onChange={(value: string | boolean) => {
                void customProps.onChange?.(value);
              }}
              placeholder={customProps.placeholder}
              ariaLabelledby={customProps.ariaLabelledby}
              error={customProps.error}
              autoFocus={autoFocus}
              tabIndex={customProps.tabIndex}
              dataTestId={`workflow-argument-${arg.id}`}
              onBlur={customProps.onBlur}
            />
          );
        },
      };
    }

    /*
     * Request headers and the like, as key/value rows: each value can be a
     * value from an earlier step or a variable - an Authorization header from
     * a secret variable is the usual one.
     */
    if (control === ArgumentControl.KeyValueRows) {
      return {
        fieldType: FormFieldSchemaType.CustomComponent,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customProps: CustomElementProps,
        ): ReactElement => {
          return (
            <DictionaryForm
              keyPlaceholder="Key"
              valuePlaceholder="Value"
              addButtonSuffix={arg.name}
              valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
              initialValue={
                customProps.initialValue &&
                typeof customProps.initialValue === "object"
                  ? customProps.initialValue
                  : {}
              }
              onChange={(value: Dictionary<unknown>) => {
                void customProps.onChange?.(value);
              }}
              renderTextValueInput={(row: {
                value: string;
                onChange: (value: string) => void;
                placeholder?: string | undefined;
                rowIndex: number;
              }): ReactElement => {
                return (
                  <ValueTextField
                    value={row.value}
                    onChange={row.onChange}
                    multiline={false}
                    placeholder={row.placeholder}
                    ariaLabel={translator.translateTemplate(
                      "{{name}} value {{number}}",
                      {
                        name: translatableTerm(arg.name),
                        number: row.rowIndex + 1,
                      },
                    )}
                    dataTestId={`workflow-argument-${arg.id}-value-${row.rowIndex}`}
                  />
                );
              }}
            />
          );
        },
      };
    }

    // Everything else is chosen by type: code, JSON, toggles, dropdowns.
    const baseField: ArgumentFormFieldType & {
      codeEditorToolbarActions?:
        | ((editor: CodeEditorActions) => ReactNode)
        | undefined;
    } = componentInputTypeToFormFieldType(arg.type, storedValue);

    if (
      control === ArgumentControl.JSONCode ||
      control === ArgumentControl.HTMLCode
    ) {
      const isJSON: boolean = control === ArgumentControl.JSONCode;

      baseField.codeEditorToolbarActions = (
        editor: CodeEditorActions,
      ): ReactNode => {
        return (
          <InsertValueButton
            dataTestId={`workflow-argument-${arg.id}-insert-value`}
            onPick={(reference: string) => {
              const selection: { start: number; end: number } =
                editor.getSelection();

              /*
               * In JSON a reference goes inside quotes, which come with it
               * where the caret is not already in a string; on its own it
               * stands for the whole document.
               */
              editor.insertText(
                isJSON
                  ? referenceForJSON({
                      text: editor.getText(),
                      start: selection.start,
                      end: selection.end,
                      reference: reference,
                      allowJSON5: isJSON5ToleratedInputType(arg.type),
                    })
                  : reference,
              );
            }}
            onCloseFocus={() => {
              editor.focus();
            }}
          />
        );
      };
    }

    return baseField;
  };

  /*
   * If / Else is set up as the sentence its settings make, not as a form of
   * five fields (Condition/ConditionEditor). It edits the same stored
   * settings, and reports whether the step can be saved the way the form
   * below does, under "arguments".
   */
  if (component.metadata.id === ComponentID.IfElse) {
    return (
      <ValuePickerProvider
        workflowId={props.workflowId}
        component={component}
        graphComponents={props.graphComponents}
        valueSources={props.valueSources}
        sources={props.valueSuggestionSources}
        webhookUrl={props.webhookUrl}
      >
        <ConditionEditor
          arguments={component.arguments}
          onChange={(patch: JSONObject) => {
            setComponent((current: NodeDataProp) => {
              return {
                ...current,
                arguments: {
                  ...((current.arguments as JSONObject) || {}),
                  ...patch,
                },
              };
            });
          }}
          onValidationChange={(hasError: boolean) => {
            setHasFormValidationErrors((current: Dictionary<boolean>) => {
              return current["arguments"] === hasError
                ? current
                : { ...current, arguments: hasError };
            });
          }}
        />
      </ValuePickerProvider>
    );
  }

  return (
    <ValuePickerProvider
      workflowId={props.workflowId}
      component={component}
      graphComponents={props.graphComponents}
      valueSources={props.valueSources}
      sources={props.valueSuggestionSources}
      webhookUrl={props.webhookUrl}
    >
      <div>
        {component.metadata.arguments &&
          component.metadata.arguments.length === 0 && (
            <ErrorMessage message={"This step does not need any settings."} />
          )}
        {/*
          While a setting picked from a list is still fetching its records
          (RecordChoices), show a loader instead of the form. Otherwise the
          user briefly sees an empty dropdown, which is confusing.
        */}
        {isWaitingForRecordChoices && <ComponentLoader />}
        {component.metadata.arguments &&
          component.metadata.arguments.length > 0 &&
          !isWaitingForRecordChoices && (
            <BasicForm
              hideSubmitButton={true}
              ref={formRef}
              initialValues={{
                ...formInitialValues,
              }}
              onChange={(values: FormValues<JSONObject>) => {
                setComponent({
                  ...component,
                  arguments: {
                    ...((component.arguments as JSONObject) || {}),
                    ...((values as JSONObject) || {}),
                  },
                });
              }}
              onFormValidationErrorChanged={(hasError: boolean) => {
                /*
                 * Keyed "arguments", not "id": the Identifier field in the
                 * settings modal reports into the same dictionary under "id",
                 * so both forms were overwriting each other. Typing in the
                 * Identifier box cleared an outstanding argument error and
                 * re-enabled Save on a component that was still invalid.
                 */
                if (hasFormValidationErrors["arguments"] !== hasError) {
                  setHasFormValidationErrors({
                    ...hasFormValidationErrors,
                    arguments: hasError,
                  });
                }
              }}
              fields={
                component.metadata.arguments &&
                orderedArguments.map((arg: Argument, argIndex: number) => {
                  const baseField: ArgumentFormFieldType & {
                    getCustomElement?: (
                      values: FormValues<JSONObject>,
                      customProps: CustomElementProps,
                    ) => ReactElement | undefined;
                    customElementDrawsOwnLabel?: boolean | undefined;
                  } = fieldForArgument(arg, argIndex);

                  /*
                   * A setting picked from the project's records gets the
                   * records fetched above as its options.
                   */
                  if (getRecordChoiceSource(arg.type)) {
                    baseField.dropdownOptions = recordChoices[arg.type] || [];
                  }

                  const isAdvanced: boolean = isCollapsibleAdvanced(arg);

                  return {
                    title: `${arg.name}`,
                    collapsibleSection: isAdvanced
                      ? moreFieldsSection
                      : undefined,
                    description: describeArgument(
                      translator,
                      arg,
                      component.arguments,
                    ),
                    field: {
                      [arg.id]: true,
                    },
                    /*
                     * A setting another one can make unnecessary - Create One
                     * Incident's JSON Object, once an Incident Template is
                     * picked - is required only while that one does not.
                     */
                    required: arg.notRequiredWhen
                      ? (values: FormValues<JSONObject>): boolean => {
                          return isArgumentRequired(arg, values as JSONObject);
                        }
                      : arg.required,
                    placeholder: arg.placeholder,
                    /*
                     * Some argument types are read back with JSON5 rather than
                     * JSON, so the check has to be no stricter than the parser
                     * that will actually see the value.
                     */
                    allowJSON5: isJSON5ToleratedInputType(arg.type),
                    /*
                     * A URL or an address typed out in full is checked as the
                     * box used to; one built from a value is not known yet.
                     */
                    customValidation:
                      arg.type === ComponentInputType.URL ||
                      arg.type === ComponentInputType.Email
                        ? (values: FormValues<JSONObject>): string | null => {
                            return validateTypedValue(
                              arg.type,
                              (values as JSONObject)[arg.id],
                            );
                          }
                        : undefined,
                    ...baseField,
                  };
                })
              }
            />
          )}
      </div>
    </ValuePickerProvider>
  );
};

export default ArgumentsForm;
