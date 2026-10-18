import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  SECURITY_MATCH_RAISES_ANSWERS,
  SECURITY_MATCH_RAISES_COPY,
  SECURITY_MATCH_RAISES_FIELD_KEY,
  SECURITY_MATCH_RAISES_FIELD_TITLE,
  SecurityMatchRaises,
  TAXII_SIGN_IN_ANSWERS,
  TAXII_SIGN_IN_COPY,
  TaxiiSignIn,
  getSecurityMatchRaises,
  getValuesForSecurityMatchRaises,
  isSecurityMatchRaises,
  raisesAlert,
  raisesIncident,
} from "./SecurityMatchRaises";

/*
 * WHAT A SECURITY MATCH DOES: THE ON MATCH STEP OF A DETECTION RULE AND A
 * THREAT INTEL FEED.
 *
 * Both asked it on two steps of their own - Security Cases (one switch) and
 * On Match (three switches and two severities) - each switch with a
 * sentence on when to want it. Now one step asks it: whether a match opens
 * a case, then whether it raises an alert, an incident, both or neither
 * (SecurityMatchRaises), with the severity of what it raises; whether it
 * writes a detection finding waits under More fields.
 *
 * Every field writes the column it always wrote. Every step id is written
 * out as a string literal, so the form step guards
 * (Common/Tests/Helpers/FormStepsScan.ts) can place the fields.
 */

export type SecurityMatchSubject = DetectionRule | ThreatIntelFeed;

/*
 * What a match is, in each form's words. A severity's line says what an
 * empty pick does; that it may be left empty is the field's own
 * "(Optional)", so the line does not start by saying it again.
 */
export interface SecurityMatchWording {
  caseDescription: string;
  alertSeverityDescription: string;
  incidentSeverityDescription: string;
  severityPlaceholder: string;
  findingDescription: string;
}

export const DETECTION_RULE_MATCH_WORDING: SecurityMatchWording = {
  caseDescription: translationKey(
    "Group matches into security cases by user, host or address. Playbooks run on the cases it opens.",
  ),
  alertSeverityDescription: translationKey(
    "Left empty, the Sigma rule's level picks one of this project's alert severities.",
  ),
  incidentSeverityDescription: translationKey(
    "Left empty, the Sigma rule's level picks one of this project's incident severities.",
  ),
  severityPlaceholder: translationKey("Default from Sigma level"),
  findingDescription: translationKey(
    "Write a Detection Finding security event back into the event stream when this rule matches.",
  ),
};

export const THREAT_INTEL_MATCH_WORDING: SecurityMatchWording = {
  caseDescription: translationKey(
    "Group events that name a known indicator into security cases. Playbooks run on the cases it opens.",
  ),
  alertSeverityDescription: translationKey(
    "Left empty, the indicator's confidence picks one of this project's alert severities.",
  ),
  incidentSeverityDescription: translationKey(
    "Left empty, the indicator's confidence picks one of this project's incident severities.",
  ),
  severityPlaceholder: translationKey("Default from indicator confidence"),
  findingDescription: translationKey(
    "Write a Detection Finding security event back into the event stream when an indicator matches.",
  ),
};

// The choice's answers, the default first.
export const getSecurityMatchRaisesChoices: () => Array<RadioButton> =
  (): Array<RadioButton> => {
    return SECURITY_MATCH_RAISES_ANSWERS.map(
      (raises: SecurityMatchRaises): RadioButton => {
        return {
          value: raises,
          title: SECURITY_MATCH_RAISES_COPY[raises].title,
          description: SECURITY_MATCH_RAISES_COPY[raises].description,
        };
      },
    );
  };

/**
 * How OneUptime signs in to a TAXII server, as a new feed's Sign-in and the
 * Update Credentials dialog offer it: the same answers, in the same words.
 * The dialog says what No sign-in does there (it clears what is stored).
 */
export const getTaxiiSignInChoices: (options?: {
  anonymousDescription?: string | undefined;
}) => Array<RadioButton> = (options?: {
  anonymousDescription?: string | undefined;
}): Array<RadioButton> => {
  return TAXII_SIGN_IN_ANSWERS.map((signIn: TaxiiSignIn): RadioButton => {
    return {
      value: signIn,
      title: TAXII_SIGN_IN_COPY[signIn].title,
      description:
        signIn === TaxiiSignIn.Anonymous && options?.anonymousDescription
          ? options.anonymousDescription
          : TAXII_SIGN_IN_COPY[signIn].description,
    };
  });
};

/**
 * The On Match step's fields, less the detection finding (folded, see
 * getSecurityMatchFindingField): the case, what else a match raises, and
 * its severities.
 */
export function getSecurityMatchActionFields<T extends SecurityMatchSubject>(
  wording: SecurityMatchWording,
): Array<ModelField<T>> {
  return [
    {
      field: {
        shouldCreateCase: true,
      },
      title: "Open a Case on Match",
      stepId: "on-match",
      description: wording.caseDescription,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    } as ModelField<T>,
    /*
     * One choice where Create Alert on Match and Create Incident on Match
     * were two switches. Form-only: it starts on the answer the two columns
     * make, and a pick writes both columns, registered just below, unseen,
     * so the form loads and saves them.
     */
    {
      overrideField: {
        shouldCreateAlert: true,
      },
      overrideFieldKey: SECURITY_MATCH_RAISES_FIELD_KEY,
      formOnly: true,
      title: SECURITY_MATCH_RAISES_FIELD_TITLE,
      stepId: "on-match",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: getSecurityMatchRaisesChoices(),
      required: true,
      // Each answer says what it opens.
      hideColumnDescription: true,
      dataTestId: "security-match-raises",
      getDefaultValue: (values: FormValues<T>): string => {
        return getSecurityMatchRaises(values);
      },
      onChange: (
        value: unknown,
        currentValues: FormValues<T>,
        setNewFormValues: (values: FormValues<T>) => void,
      ): void => {
        if (!isSecurityMatchRaises(value)) {
          return;
        }

        setNewFormValues(
          getValuesForSecurityMatchRaises({
            values: currentValues,
            raises: value,
          }),
        );
      },
    } as ModelField<T>,
    {
      field: {
        shouldCreateAlert: true,
      },
      title: "Create Alert on Match",
      stepId: "on-match",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      hideColumnDescription: true,
      // Written by the choice above.
      showIf: (): boolean => {
        return false;
      },
    } as ModelField<T>,
    {
      field: {
        shouldCreateIncident: true,
      },
      title: "Create Incident on Match",
      stepId: "on-match",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      hideColumnDescription: true,
      // Written by the choice above.
      showIf: (): boolean => {
        return false;
      },
    } as ModelField<T>,
    {
      field: {
        alertSeverity: true,
      },
      title: "Alert Severity",
      stepId: "on-match",
      description: wording.alertSeverityDescription,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: {
        type: AlertSeverity,
        labelField: "name",
        valueField: "_id",
        sort: {
          order: SortOrder.Ascending,
        },
      },
      required: false,
      placeholder: wording.severityPlaceholder,
      showIf: (values: FormValues<T>): boolean => {
        return raisesAlert(values);
      },
    } as ModelField<T>,
    {
      field: {
        incidentSeverity: true,
      },
      title: "Incident Severity",
      stepId: "on-match",
      description: wording.incidentSeverityDescription,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: {
        type: IncidentSeverity,
        labelField: "name",
        valueField: "_id",
        sort: {
          order: SortOrder.Ascending,
        },
      },
      required: false,
      placeholder: wording.severityPlaceholder,
      showIf: (values: FormValues<T>): boolean => {
        return raisesIncident(values);
      },
    } as ModelField<T>,
  ];
}

/**
 * Whether a match writes a detection finding: on for almost every rule and
 * feed (a monitor on the findings needs them), so it waits under More
 * fields, in the section the page builds (advancedSection).
 */
export function getSecurityMatchFindingField<T extends SecurityMatchSubject>(
  wording: SecurityMatchWording,
  advancedSection: FormFieldCollapsibleSection<T>,
): ModelField<T> {
  return {
    field: {
      shouldWriteDetectionFinding: true,
    },
    title: "Write Detection Finding on Match",
    stepId: "on-match",
    description: wording.findingDescription,
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    collapsibleSection: advancedSection,
  } as ModelField<T>;
}
