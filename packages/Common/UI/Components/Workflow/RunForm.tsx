import ChoiceRows, { ChoiceRowOption } from "../ChoiceRows/ChoiceRows";
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
  getRunRecordDescription,
  getRunRecordPickHint,
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
  WHAT_HAPPENED_VALUES,
  WhatHappened,
  readWhatHappened,
} from "../../../Types/Workflow/CreateOrUpdateTrigger";
import {
  RunRecordOption,
  RunRecordReferenceKind,
  RunRecordTriggerInfo,
  getRunRecordTriggerInfo,
  parseRunRecordReference,
  withRunRecordEvent,
} from "../../../Types/Workflow/RunRecord";
import React, {
  ReactElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
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
  readonly whatHappened: string;
  readonly created: string;
  readonly updated: string;
} = {
  noValues: translationKey(
    "This trigger needs no values. Click {{button}} to start the run.",
  ),
  /*
   * On Create or Update's question, beside the record: is the run for it
   * being created or updated? Its run value's own name (WHAT_HAPPENED_NAME),
   * and its value's two answers.
   */
  whatHappened: translationKey("What Happened"),
  /*
   * Not "Created" and "Updated": those keys are column titles too, and
   * read as one in some languages ("Creation time").
   */
  created: translationKey("Just created"),
  updated: translationKey("Just updated"),
};

// What the panel offers for What Happened, in order: the first is the default.
const WHAT_HAPPENED_LABELS: Record<WhatHappened, string> = {
  [WhatHappened.Created]: RunFormCopy.created,
  [WhatHappened.Updated]: RunFormCopy.updated,
};

export const RUN_WHAT_HAPPENED_TEST_ID: string = "run-what-happened";

/*
 * What the panel around the form can ask of it: to say what is missing. The
 * panel owns the Run button, the form the fields.
 */
export interface RunFormHandle {
  /*
   * Shows every field's message, as leaving each of them would, and puts
   * the focus in the first field that has one.
   */
  showErrors: () => void;
}

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

const RunForm: React.ForwardRefExoticComponent<
  ComponentProps & React.RefAttributes<RunFormHandle>
> = forwardRef<RunFormHandle, ComponentProps>(
  (
    props: ComponentProps,
    ref: React.ForwardedRef<RunFormHandle>,
  ): ReactElement => {
    const translator: Translator = useTranslator();
    const formRef: any = useRef<FormProps<FormValues<JSONObject>>>(null);
    const rootRef: React.MutableRefObject<HTMLDivElement | null> =
      useRef<HTMLDivElement | null>(null);

    /*
     * Run pressed with something missing. A dialog used to say "Please fix
     * errors" over a form that showed none: a field says what it needs once
     * it has been left, and nobody had been in it yet. Now every field says
     * it, and the focus goes to the first one - for a record trigger, into
     * the search, which lists the records to pick from.
     */
    useImperativeHandle(ref, (): RunFormHandle => {
      return {
        showErrors: (): void => {
          /*
           * What Next does on a form without steps: every field is marked as
           * left and checked, and nothing is submitted.
           */
          formRef.current?.goToNextStep?.();

          // Once the messages are drawn.
          window.setTimeout(() => {
            rootRef.current
              ?.querySelector<HTMLElement>('[aria-invalid="true"]')
              ?.focus();
          }, 0);
        },
      };
    }, []);
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
    const triggerInfo: RunRecordTriggerInfo | null = getRunRecordTriggerInfo(
      component.metadata,
    );
    const recordTrigger: RunRecordTriggerInfo | null = props.workflowId
      ? triggerInfo
      : null;

    /*
     * The same, with what the run is for: On Create or Update asks whether
     * the record was created or updated, and the record's help says which.
     */
    const runRecordTrigger: RunRecordTriggerInfo | null = recordTrigger
      ? withRunRecordEvent(recordTrigger, component.arguments)
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
      /*
       * On Create or Update's What Happened: a row for each answer, created
       * first and chosen until another is. A choice is always made, so it is
       * neither required nor optional. Asked whether or not the record can
       * be searched for here.
       */
      if (
        triggerInfo &&
        triggerInfo.whatHappenedArgument &&
        argument.id === triggerInfo.whatHappenedArgument.id
      ) {
        return {
          title: RunFormCopy.whatHappened,
          field: {
            [argument.id]: true,
          },
          required: false,
          hideOptionalLabel: true,
          fieldType: FormFieldSchemaType.CustomComponent,
          getCustomElement: (
            _values: FormValues<JSONObject>,
            customProps: CustomElementProps,
          ): ReactElement => {
            const options: Array<ChoiceRowOption<WhatHappened>> =
              WHAT_HAPPENED_VALUES.map(
                (value: WhatHappened): ChoiceRowOption<WhatHappened> => {
                  return {
                    value: value,
                    title: WHAT_HAPPENED_LABELS[value],
                    dataTestId: `${RUN_WHAT_HAPPENED_TEST_ID}-${value}`,
                  };
                },
              );

            return (
              <div
                className="overflow-hidden rounded-lg border border-gray-200 bg-white"
                data-testid={RUN_WHAT_HAPPENED_TEST_ID}
              >
                <ChoiceRows<WhatHappened>
                  value={
                    readWhatHappened(customProps.initialValue) ||
                    WhatHappened.Created
                  }
                  options={options}
                  onPick={(value: WhatHappened) => {
                    void customProps.onChange?.(value);
                  }}
                  ariaLabel={RunFormCopy.whatHappened}
                />
              </div>
            );
          },
        };
      }

      if (
        recordTrigger &&
        runRecordTrigger &&
        props.workflowId &&
        argument.id === recordTrigger.argument.id
      ) {
        const info: RunRecordTriggerInfo = runRecordTrigger;
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
              ? translator.translateText(getRunRecordPickHint(info)) || ""
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
                // The one thing the panel asks: where the typing starts.
                autoFocus={true}
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
      <div className="mt-3" ref={rootRef} data-testid="run-form">
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
                            {translator.translateText(
                              RUN_WORKFLOW_SUBMIT_TITLE,
                            )}
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
  },
);

RunForm.displayName = "RunForm";

export default RunForm;
