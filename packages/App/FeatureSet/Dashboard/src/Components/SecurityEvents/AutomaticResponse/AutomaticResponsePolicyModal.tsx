import {
  DetectionRuleChoice,
  OwnPolicyValues,
  createOwnPolicy,
  readDetectionRuleChoices,
  updateOwnPolicy,
} from "./AutomaticResponseApi";
import {
  ACTION_FIELD_DESCRIPTION,
  CREATE_POLICY,
  EDIT_POLICY,
  FIRST_BLOCK_FIELD_DESCRIPTION,
  FIRST_BLOCK_FIELD_TITLE,
  NAME_FIELD_PLACEHOLDER,
  POLICY_FORM_DESCRIPTION,
  POLICY_SAVED_TOAST,
  RULES_FIELD_DESCRIPTION,
  TECHNIQUES_FIELD_DESCRIPTION,
  TECHNIQUES_FIELD_PLACEHOLDER,
  TECHNIQUES_FIELD_TITLE,
  THREAT_INTEL_FIELD_TITLE,
  TURNED_AWAY_FIELD_DESCRIPTION,
  TURNED_AWAY_FIELD_TITLE,
} from "./AutomaticResponseCopy";
import {
  readTypedTechniques,
  say,
  writeTypedTechniquesProblem,
} from "./AutomaticResponseModel";
import {
  ACTION_BLOCK_OPTION,
  ACTION_CHALLENGE_OPTION,
  DURATION_COUNTS,
} from "../Blocklist/BlocklistCopy";
import { readFormIdList } from "../../SecurityPlaybook/SecurityPlaybookStepForm";
import { JSONObject } from "Common/Types/JSON";
import { SecurityAutomaticResponseOverviewPolicy } from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SECURITY_AUTOMATIC_RESPONSE_DURATIONS,
  SECURITY_AUTOMATIC_RESPONSE_MESSAGES,
  SecurityAutomaticResponseMatch,
  doesSecurityAutomaticResponseMatchNameAnything,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A PROJECT'S OWN AUTOMATIC RESPONSE POLICY (#10350), made from the blank
 * one or changed: its name, the ATT&CK techniques a detection must carry,
 * and whether it blocks or challenges - with what most people never change
 * folded under More fields: how long its first block lasts (1 hour unless
 * someone says), the detection rules it also acts on, and whether it acts
 * only on addresses the project's threat intel lists, or only while every
 * request was turned away. It must act on something: a technique, a rule
 * or threat intel. A new policy starts Off.
 */

const NAME_FIELD: string = "name";
const TECHNIQUES_FIELD: string = "mitreTechniques";
const ACTION_FIELD: string = "blockAction";
const DURATION_FIELD: string = "duration";
const RULES_FIELD: string = "detectionRuleIds";
const THREAT_INTEL_FIELD: string = "requiresThreatIntel";
const TURNED_AWAY_FIELD: string = "requiresEveryRequestTurnedAway";
const DESCRIPTION_FIELD: string = "description";

const MORE_FIELDS: FormFieldCollapsibleSection<JSONObject> =
  getAdvancedFormSection<JSONObject>();

// What the form holds, as the policy would be written.
export function readOwnPolicyForm(values: JSONObject): OwnPolicyValues {
  const match: SecurityAutomaticResponseMatch = {
    mitreTechniques: readTypedTechniques(values[TECHNIQUES_FIELD]).techniques,
    detectionRuleIds: readFormIdList(values[RULES_FIELD]),
    requiresThreatIntel: values[THREAT_INTEL_FIELD] === true,
    requiresEveryRequestTurnedAway: values[TURNED_AWAY_FIELD] === true,
  };
  const duration: unknown = values[DURATION_FIELD];

  return {
    name: String(values[NAME_FIELD] || "").trim(),
    description: String(values[DESCRIPTION_FIELD] || "").trim(),
    blockAction:
      values[ACTION_FIELD] === SecurityBlockAction.Challenge
        ? SecurityBlockAction.Challenge
        : SecurityBlockAction.Block,
    duration: (
      SECURITY_AUTOMATIC_RESPONSE_DURATIONS as ReadonlyArray<unknown>
    ).includes(duration)
      ? (duration as SecurityBlockDuration)
      : SecurityBlockDuration.OneHour,
    match,
  };
}

// The form's first values: the policy's own, or the blank policy's.
export function getOwnPolicyFormValues(
  policy: SecurityAutomaticResponseOverviewPolicy | null,
): JSONObject {
  if (!policy) {
    return {
      [ACTION_FIELD]: SecurityBlockAction.Block,
      [DURATION_FIELD]: SecurityBlockDuration.OneHour,
      [THREAT_INTEL_FIELD]: false,
      [TURNED_AWAY_FIELD]: false,
    };
  }

  return {
    [NAME_FIELD]: policy.name,
    [DESCRIPTION_FIELD]: policy.description,
    [TECHNIQUES_FIELD]: policy.match.mitreTechniques.join(", "),
    [ACTION_FIELD]: policy.blockAction,
    [DURATION_FIELD]: policy.duration,
    [RULES_FIELD]: policy.match.detectionRuleIds,
    [THREAT_INTEL_FIELD]: policy.match.requiresThreatIntel,
    [TURNED_AWAY_FIELD]: policy.match.requiresEveryRequestTurnedAway,
  };
}

// The lengths a first block may be, in the reader's words.
export function getFirstBlockOptions(
  translator: Translator,
): Array<DropdownOption> {
  return SECURITY_AUTOMATIC_RESPONSE_DURATIONS.map(
    (duration: SecurityBlockDuration): DropdownOption => {
      const counted: { count: number; plural: { one: string; other: string } } =
        DURATION_COUNTS[
          duration as Exclude<
            SecurityBlockDuration,
            SecurityBlockDuration.UntilLifted
          >
        ];

      return {
        value: duration,
        label: translator.translatePlural(counted.plural, counted.count),
        isUserContent: true,
      };
    },
  );
}

export interface ComponentProps {
  // The policy changed; none for a new one.
  policy: SecurityAutomaticResponseOverviewPolicy | null;
  onClose: () => void;
  onSaved: () => void;
}

const AutomaticResponsePolicyModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [rules, setRules] = useState<Array<DetectionRuleChoice>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // What was typed, kept for the form when the server refuses it.
  const [typed, setTyped] = useState<JSONObject | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    readDetectionRuleChoices()
      .then((choices: Array<DetectionRuleChoice>) => {
        if (isCurrent) {
          setRules(choices);
        }
      })
      .catch(() => {
        // The rules field offers none: techniques and threat intel still work.
        if (isCurrent) {
          setRules([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const submit: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    setError(null);
    setTyped(values);

    const read: OwnPolicyValues = readOwnPolicyForm(values);

    if (!doesSecurityAutomaticResponseMatchNameAnything(read.match)) {
      setError(
        say(translator, SECURITY_AUTOMATIC_RESPONSE_MESSAGES.matchNamesNothing),
      );
      return;
    }

    setIsSubmitting(true);

    try {
      if (props.policy) {
        await updateOwnPolicy({ policyId: props.policy.id, values: read });
      } else {
        await createOwnPolicy(read);
      }

      Toast.success(
        translator.translateTemplate(POLICY_SAVED_TOAST, { name: read.name }),
      );
      props.onSaved();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const title: string = props.policy ? EDIT_POLICY : CREATE_POLICY;

  return (
    <BasicFormModal<JSONObject>
      title={title}
      description={POLICY_FORM_DESCRIPTION}
      name="Security Events > Automatic Response > Policy"
      submitButtonText={props.policy ? "Save Changes" : CREATE_POLICY}
      isSubmitting={isSubmitting}
      onClose={props.onClose}
      onSubmit={submit}
      error={error || undefined}
      formProps={{
        name: "Automatic Response Policy",
        initialValues: typed || getOwnPolicyFormValues(props.policy),
        fields: [
          {
            field: { [NAME_FIELD]: true },
            title: "Name",
            placeholder: NAME_FIELD_PLACEHOLDER,
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
          {
            field: { [TECHNIQUES_FIELD]: true },
            title: TECHNIQUES_FIELD_TITLE,
            description: TECHNIQUES_FIELD_DESCRIPTION,
            placeholder: TECHNIQUES_FIELD_PLACEHOLDER,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            disableSpellCheck: true,
            customValidation: (
              values: FormValues<JSONObject>,
            ): string | null => {
              return writeTypedTechniquesProblem(
                (values as JSONObject)[TECHNIQUES_FIELD],
                translator,
              );
            },
          },
          {
            field: { [ACTION_FIELD]: true },
            title: "Action",
            description: ACTION_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
              { value: SecurityBlockAction.Block, label: ACTION_BLOCK_OPTION },
              {
                value: SecurityBlockAction.Challenge,
                label: ACTION_CHALLENGE_OPTION,
              },
            ],
            required: true,
            // Block, unless a person chooses Challenge: three rows in sight (Docs/ux/README.md#steps).
            collapsibleSection: MORE_FIELDS,
          },
          {
            field: { [DURATION_FIELD]: true },
            title: FIRST_BLOCK_FIELD_TITLE,
            description: FIRST_BLOCK_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getFirstBlockOptions(translator),
            required: true,
            collapsibleSection: MORE_FIELDS,
          },
          {
            field: { [RULES_FIELD]: true },
            title: "Detection Rules",
            description: RULES_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: rules.map(
              (rule: DetectionRuleChoice): DropdownOption => {
                return {
                  value: rule.id,
                  label: rule.name,
                  isUserContent: true,
                };
              },
            ),
            required: false,
            collapsibleSection: MORE_FIELDS,
          },
          {
            field: { [THREAT_INTEL_FIELD]: true },
            title: THREAT_INTEL_FIELD_TITLE,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: MORE_FIELDS,
          },
          {
            field: { [TURNED_AWAY_FIELD]: true },
            title: TURNED_AWAY_FIELD_TITLE,
            description: TURNED_AWAY_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: MORE_FIELDS,
          },
          {
            field: { [DESCRIPTION_FIELD]: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            collapsibleSection: MORE_FIELDS,
          },
        ],
      }}
    />
  );
};

export default AutomaticResponsePolicyModal;
