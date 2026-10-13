import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, { FormProps } from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "../Forms/Types/Field";
import FormValues from "../Forms/Types/FormValues";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import {
  OPTIONAL_ARGUMENT_HELP,
  REQUIRED_ARGUMENT_HELP,
} from "./ArgumentsForm";
import RunRecordField, {
  RunRecordFieldCopy,
  getRunRecordDescription,
} from "./RunRecordField";
import { LoadRunRecordsFunction } from "./RunRecordSource";
import {
  componentInputTypeToFormFieldType,
  parseStringDictionaryValue,
} from "./Utils";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  Argument,
  ComponentInputType,
  NodeDataProp,
} from "../../../Types/Workflow/Component";
import {
  RunRecordOption,
  RunRecordReferenceKind,
  RunRecordTriggerInfo,
  getRunRecordTriggerInfo,
  parseRunRecordReference,
} from "../../../Types/Workflow/RunRecord";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  translatableTerm,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

// The panel's own button, named in the sentence for a trigger with no values.
export const RUN_WORKFLOW_SUBMIT_TITLE: string = translationKey(
  "Run Workflow Manually",
);

export const RunFormCopy: {
  readonly noValues: string;
} = {
  noValues: translationKey(
    "This trigger needs no values. Click {{button}} to start the run.",
  ),
};

export interface ComponentProps {
  component: NodeDataProp;
  /*
   * The workflow being run. A record trigger's record is looked up in its
   * project (RunRecordField); without it, the record is typed as an ID.
   */
  workflowId?: ObjectID | undefined;
  onHasFormValidationErrors: (values: boolean) => void;
  onFormChange: (value: NodeDataProp) => void;
  // The record picked for a record trigger, so the confirmation can name it.
  onRunRecordChange?: ((record: RunRecordOption | null) => void) | undefined;
  // Where the records come from; the server unless a test says otherwise.
  loadRunRecords?: LoadRunRecordsFunction | undefined;
}

const RunForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const formRef: any = useRef<FormProps<FormValues<JSONObject>>>(null);
  const [component, setComponent] = useState<NodeDataProp>(props.component);
  const [hasFormValidationErrors, setHasFormValidationErrors] =
    useState<boolean>(false);

  useEffect(() => {
    props.onHasFormValidationErrors(hasFormValidationErrors);
  }, [hasFormValidationErrors]);

  useEffect(() => {
    props.onFormChange(component);
  }, [component]);

  /*
   * A trigger that acts on a record - On Create Incident and the like - runs
   * with one, picked by its number or name rather than typed as an ID.
   */
  const recordTrigger: RunRecordTriggerInfo | null = props.workflowId
    ? getRunRecordTriggerInfo(component.metadata)
    : null;

  /*
   * Same hydration ArgumentsForm does: a StringDictionary renders as key/value
   * rows, and those need a real object rather than the JSON string older
   * workflows stored. The field type is chosen from the same value, so the two
   * cannot disagree about which editor is on screen.
   */
  const formInitialValues: JSONObject = { ...(component.arguments || {}) };

  for (const argument of component.metadata.runWorkflowManuallyArguments ||
    []) {
    if (argument.type !== ComponentInputType.StringDictionary) {
      continue;
    }

    const parsed: JSONObject | null = parseStringDictionaryValue(
      formInitialValues[argument.id],
    );

    if (parsed !== null) {
      formInitialValues[argument.id] = parsed;
    }
  }

  type FieldForArgumentFunction = (argument: Argument) => any;

  const fieldForArgument: FieldForArgumentFunction = (argument: Argument) => {
    if (
      recordTrigger &&
      props.workflowId &&
      argument.id === recordTrigger.argument.id
    ) {
      const info: RunRecordTriggerInfo = recordTrigger;
      const workflowId: ObjectID = props.workflowId;

      return {
        // "Incident": the record, named as everywhere else.
        title: info.singularName,
        description: getRunRecordDescription(translator, info),
        field: {
          [argument.id]: true,
        },
        required: true,
        /*
         * A record picked from the list, its ID, or its number typed out
         * (looked up when the run starts). Part of a name is not enough to
         * run with.
         */
        customValidation: (values: FormValues<JSONObject>): string | null => {
          const value: unknown = (values as JSONObject)[argument.id];

          return parseRunRecordReference(value).kind ===
            RunRecordReferenceKind.Text
            ? translator.translateText(RunRecordFieldCopy.pickFromList) || ""
            : null;
        },
        fieldType: FormFieldSchemaType.CustomComponent,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customProps: CustomElementProps,
        ): ReactElement => {
          return (
            <RunRecordField
              workflowId={workflowId}
              info={info}
              value={
                typeof customProps.initialValue === "string"
                  ? customProps.initialValue
                  : ""
              }
              onChange={(value: string) => {
                void customProps.onChange?.(value);
              }}
              onRecordChange={props.onRunRecordChange}
              onBlur={customProps.onBlur}
              error={customProps.error}
              ariaLabelledby={customProps.ariaLabelledby}
              tabIndex={customProps.tabIndex}
              load={props.loadRunRecords}
            />
          );
        },
      };
    }

    return {
      title: `${argument.name}`,
      description: translator.translateTemplate(
        argument.required ? REQUIRED_ARGUMENT_HELP : OPTIONAL_ARGUMENT_HELP,
        { description: translatableTerm(argument.description) },
      ),
      field: {
        [argument.id]: true,
      },
      required: argument.required,
      placeholder: argument.placeholder,
      /*
       * Decided from the value the form actually renders.
       * This used to read component.returnValues, which is not
       * where RunForm writes — so for a field holding a value
       * the row editor cannot represent, the editor on screen
       * and the value behind it could disagree.
       */
      ...componentInputTypeToFormFieldType(
        argument.type,
        formInitialValues[argument.id] ?? null,
      ),
    };
  };

  /*
   * Top margins only: RunModal's SideOver leaves room under its content at
   * every width, so a bottom margin here as well would end the panel on more
   * than the others.
   */
  return (
    <div className="mt-3">
      <div className="mt-5">
        <h2 className="mb-4 text-base font-medium text-gray-500">
          {translator.translateTemplate("Run {{step}}", {
            step: translatableTerm(component.metadata.title),
          })}
        </h2>
        {component.metadata.runWorkflowManuallyArguments &&
          component.metadata.runWorkflowManuallyArguments.length === 0 && (
            <ErrorMessage
              message={
                <span data-testid="run-form-no-values">
                  <TranslatedSentence
                    template={RunFormCopy.noValues}
                    slots={{
                      button: (
                        <strong className="font-semibold text-gray-700">
                          {translator.translateText(RUN_WORKFLOW_SUBMIT_TITLE)}
                        </strong>
                      ),
                    }}
                  />
                </span>
              }
            />
          )}
        {component.metadata.runWorkflowManuallyArguments &&
          component.metadata.runWorkflowManuallyArguments.length > 0 && (
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
                setHasFormValidationErrors(hasError);
              }}
              fields={component.metadata.runWorkflowManuallyArguments.map(
                (argument: Argument) => {
                  return fieldForArgument(argument);
                },
              )}
            />
          )}
      </div>
    </div>
  );
};

export default RunForm;
