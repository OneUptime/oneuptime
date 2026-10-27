import {
  ENDS_AT_FIELD_DESCRIPTION,
  ENDS_AT_FIELD_TITLE,
  ENTITY_TYPE_FIELD_TITLE,
  EXPIRES_AT_FIELD_DESCRIPTION,
  EXPIRES_AT_FIELD_TITLE,
  FIELD_NAME_FIELD_DESCRIPTION,
  FIELD_NAME_FIELD_PLACEHOLDER,
  FIELD_NAME_FIELD_TITLE,
  KIND_ENTITY_DESCRIPTION,
  KIND_ENTITY_TITLE,
  KIND_FIELD_TITLE,
  KIND_VALUE_DESCRIPTION,
  KIND_VALUE_TITLE,
  KIND_WINDOW_DESCRIPTION,
  KIND_WINDOW_TITLE,
  REASON_FIELD_DESCRIPTION,
  REASON_FIELD_PLACEHOLDER,
  REASON_FIELD_TITLE,
  RULE_EXCEPTIONS_TEST_IDS,
  RULE_FIELD_DESCRIPTION,
  RULE_FIELD_PLACEHOLDER,
  RULE_FIELD_TITLE,
  STARTS_AT_FIELD_TITLE,
  STEP_WHAT_TO_SKIP,
  STEP_WHY,
  VALUE_FIELD_DESCRIPTION,
  VALUE_FIELD_PLACEHOLDER,
  VALUE_FIELD_TITLE,
} from "./RuleExceptionsCopy";
import { DETECTION_RULES_EMPTY_TITLE } from "../SecurityDetectionsCopy";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RULE_EXCEPTION_ENTITY_TYPES,
  DetectionRuleExceptionFormField,
  DetectionRuleExceptionKind,
  DetectionRuleExceptionShape,
  getDetectionRuleExceptionFieldProblem,
} from "Common/Types/SecurityEvent/DetectionRuleException";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE ADD EXCEPTION FORM, one definition for every door to it: Security
 * Events > Rule Exceptions' own Add and Edit, a rule's Add Exception, and a
 * case's detection's Add Exception.
 *
 *   What to Skip   the rule, then what it skips - an entity (its type and
 *                  value), a value (its field and value) or a time window
 *                  (from and until) - only the fields of the kind chosen;
 *   Why            the reason, and for an entity or a value when it expires.
 *
 * Each field shows the shared rules' problem with it, in the reader's
 * language (getDetectionRuleExceptionFieldProblem): the API checks the same
 * rules on save.
 */

export const RULE_EXCEPTION_FORM_STEPS: Array<
  FormStep<DetectionRuleException>
> = [
  { title: STEP_WHAT_TO_SKIP, id: "what-to-skip" },
  { title: STEP_WHY, id: "why" },
];

// What the rule skips, as the form offers it: the shared order.
export function getRuleExceptionKindChoices(): Array<RadioButton> {
  return [
    {
      value: DetectionRuleExceptionKind.Entity,
      title: KIND_ENTITY_TITLE,
      description: KIND_ENTITY_DESCRIPTION,
    },
    {
      value: DetectionRuleExceptionKind.Value,
      title: KIND_VALUE_TITLE,
      description: KIND_VALUE_DESCRIPTION,
    },
    {
      value: DetectionRuleExceptionKind.TimeWindow,
      title: KIND_WINDOW_TITLE,
      description: KIND_WINDOW_DESCRIPTION,
    },
  ];
}

export function getRuleExceptionEntityTypeOptions(): Array<DropdownOption> {
  return DETECTION_RULE_EXCEPTION_ENTITY_TYPES.map(
    (type: SecurityEntityType): DropdownOption => {
      return { label: type, value: type };
    },
  );
}

// The kind the form holds; an entity until another is chosen, as the form starts.
export function getFormExceptionKind(
  values: FormValues<DetectionRuleException>,
): DetectionRuleExceptionKind {
  const kind: unknown = (values as Record<string, unknown>)["kind"];

  return kind === DetectionRuleExceptionKind.Value ||
    kind === DetectionRuleExceptionKind.TimeWindow
    ? kind
    : DetectionRuleExceptionKind.Entity;
}

function isKind(
  kind: DetectionRuleExceptionKind,
): (values: FormValues<DetectionRuleException>) => boolean {
  return (values: FormValues<DetectionRuleException>): boolean => {
    return getFormExceptionKind(values) === kind;
  };
}

function isNotWindow(values: FormValues<DetectionRuleException>): boolean {
  return getFormExceptionKind(values) !== DetectionRuleExceptionKind.TimeWindow;
}

/*
 * A new window starts now and ends in two hours, rounded to the minute: a
 * planned test is usually today. An Edit form keeps the row's own times.
 */
export function getRuleExceptionWindowDefaults(now: Date): {
  startsAt: Date;
  endsAt: Date;
} {
  const startsAt: Date = new Date(Math.floor(now.getTime() / 60000) * 60000);

  return {
    startsAt,
    endsAt: OneUptimeDate.addRemoveHours(startsAt, 2),
  };
}

export interface RuleExceptionFormOptions {
  translator: Translator;
  /*
   * A new exception (its expiry must be ahead) or an edit (an expiry left
   * as it was is the row's own, even once past: the API checks a changed
   * one).
   */
  isCreate: boolean;
  // When the form is checked; the clock, unless a test hands one over.
  getNow?: (() => Date) | undefined;
}

export function getRuleExceptionFormFields(
  options: RuleExceptionFormOptions,
): Array<ModelField<DetectionRuleException>> {
  const getNow: () => Date =
    options.getNow ||
    ((): Date => {
      return OneUptimeDate.getCurrentDate();
    });

  // The shared rules' problem with one field, in the reader's language.
  const problemWith: (
    field: DetectionRuleExceptionFormField,
  ) => (values: FormValues<DetectionRuleException>) => string | null = (
    field: DetectionRuleExceptionFormField,
  ) => {
    return (values: FormValues<DetectionRuleException>): string | null => {
      const exception: DetectionRuleExceptionShape = {
        ...(values as DetectionRuleExceptionShape),
        kind: getFormExceptionKind(values),
      };

      const problem: string | null = getDetectionRuleExceptionFieldProblem(
        exception,
        field,
        { now: getNow(), isExpiryNew: options.isCreate },
      );

      return problem
        ? options.translator.translateText(problem) || problem
        : null;
    };
  };

  const stepWhat: string = RULE_EXCEPTION_FORM_STEPS[0]!.id;
  const stepWhy: string = RULE_EXCEPTION_FORM_STEPS[1]!.id;

  return [
    {
      field: { detectionRule: true },
      title: RULE_FIELD_TITLE,
      description: RULE_FIELD_DESCRIPTION,
      stepId: stepWhat,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: {
        type: DetectionRule,
        labelField: "name",
        valueField: "_id",
        sort: { name: SortOrder.Ascending },
        emptyListText: DETECTION_RULES_EMPTY_TITLE,
      },
      required: true,
      placeholder: RULE_FIELD_PLACEHOLDER,
      dataTestId: "rule-exception-rule",
    },
    {
      field: { kind: true },
      title: KIND_FIELD_TITLE,
      stepId: stepWhat,
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: getRuleExceptionKindChoices(),
      // Each choice says what it is; the API reader's column help would repeat them.
      hideColumnDescription: true,
      required: true,
      defaultValue: DetectionRuleExceptionKind.Entity,
      dataTestId: RULE_EXCEPTIONS_TEST_IDS.kindChoice,
    },
    {
      field: { entityType: true },
      title: ENTITY_TYPE_FIELD_TITLE,
      stepId: stepWhat,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getRuleExceptionEntityTypeOptions(),
      hideColumnDescription: true,
      showIf: isKind(DetectionRuleExceptionKind.Entity),
      required: isKind(DetectionRuleExceptionKind.Entity),
      customValidation: problemWith("entityType"),
      dataTestId: "rule-exception-entity-type",
    },
    {
      field: { fieldName: true },
      title: FIELD_NAME_FIELD_TITLE,
      description: FIELD_NAME_FIELD_DESCRIPTION,
      stepId: stepWhat,
      fieldType: FormFieldSchemaType.Text,
      placeholder: FIELD_NAME_FIELD_PLACEHOLDER,
      showIf: isKind(DetectionRuleExceptionKind.Value),
      required: isKind(DetectionRuleExceptionKind.Value),
      customValidation: problemWith("fieldName"),
      disableSpellCheck: true,
      dataTestId: "rule-exception-field-name",
    },
    {
      field: { value: true },
      title: VALUE_FIELD_TITLE,
      description: VALUE_FIELD_DESCRIPTION,
      stepId: stepWhat,
      fieldType: FormFieldSchemaType.Text,
      placeholder: VALUE_FIELD_PLACEHOLDER,
      showIf: isNotWindow,
      required: isNotWindow,
      customValidation: problemWith("value"),
      disableSpellCheck: true,
      dataTestId: "rule-exception-value",
    },
    {
      field: { startsAt: true },
      title: STARTS_AT_FIELD_TITLE,
      stepId: stepWhat,
      fieldType: FormFieldSchemaType.DateTime,
      hideColumnDescription: true,
      showIf: isKind(DetectionRuleExceptionKind.TimeWindow),
      required: isKind(DetectionRuleExceptionKind.TimeWindow),
      customValidation: problemWith("startsAt"),
      dataTestId: "rule-exception-starts-at",
    },
    {
      field: { endsAt: true },
      title: ENDS_AT_FIELD_TITLE,
      description: ENDS_AT_FIELD_DESCRIPTION,
      stepId: stepWhat,
      fieldType: FormFieldSchemaType.DateTime,
      showIf: isKind(DetectionRuleExceptionKind.TimeWindow),
      required: isKind(DetectionRuleExceptionKind.TimeWindow),
      customValidation: problemWith("endsAt"),
      dataTestId: "rule-exception-ends-at",
    },
    {
      field: { reason: true },
      title: REASON_FIELD_TITLE,
      description: REASON_FIELD_DESCRIPTION,
      stepId: stepWhy,
      fieldType: FormFieldSchemaType.LongText,
      placeholder: REASON_FIELD_PLACEHOLDER,
      required: true,
      customValidation: problemWith("reason"),
      dataTestId: "rule-exception-reason",
    },
    {
      field: { expiresAt: true },
      title: EXPIRES_AT_FIELD_TITLE,
      description: EXPIRES_AT_FIELD_DESCRIPTION,
      stepId: stepWhy,
      fieldType: FormFieldSchemaType.DateTime,
      showIf: isNotWindow,
      required: false,
      customValidation: problemWith("expiresAt"),
      dataTestId: "rule-exception-expires-at",
    },
  ];
}
