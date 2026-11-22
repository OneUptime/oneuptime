import AppLink from "../AppLink/AppLink";
import TelemetryFieldReadersList from "../Telemetry/FieldReaders/TelemetryFieldReadersList";
import {
  LOG_SCRUB_RULE_FORM_OPTIONS,
  LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  SCRUB_ACTION_CHOICES,
  SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_FORM_OPTIONS,
} from "../Telemetry/ScrubRuleForm";
import DataSecurityApi from "./DataSecurityApi";
import { getRulesRoute, SCRUB_IT } from "./TelemetryScrubIt";
import {
  DataSecurityScrubImpact,
  DataSecurityScrubResult,
  DataSecurityScrubRulePlan,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE } from "Common/Types/Telemetry/ScrubRule";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import {
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * SCRUB IT: WHAT THE RULE DOES, AND WHAT IT BREAKS, BEFORE IT IS MADE
 * (#10433).
 *
 * Scrub It used to confirm with "a scrub rule that masks this kind of data
 * at this place": the rule redacted it, in every service of the project,
 * and nothing asked what read the data. Two of its four buttons made the
 * rule with no question at all. Every Scrub It now opens this dialog, which
 * says, from what the server worked out (scrubImpact):
 *
 *  - whose records the rule changes: the logs or spans of the service the
 *    finding was seen in - and that other services' stay as they are - or,
 *    for a RUM application's replays, every service and app of the project;
 *  - what it does with what it finds (Redact, Mask, Hash, as the rule form
 *    words them) and the parts of the records it looks in;
 *  - that what is stored already stays;
 *  - what reads the values it would hide - monitors, dashboards, saved
 *    views, recording rules, SLOs - and what Security Events would lose
 *    (TelemetryFieldReadersList); nothing more when nothing reads them;
 *  - or the rule that already hides the data, or why no rule can.
 *
 * It never blocks a rule something reads: it says so, and the person
 * decides. A metric attribute's rule, which no log or span reads, keeps the
 * words it always had.
 */

export const SCRUB_IT_MODAL_TEST_ID: string = "data-security-scrub-it";

const TITLE: string = translationKey("Scrub This Data at Ingest");

// Whose records the rule changes, by the records' signal and the rule's scope.
export const SCRUB_IT_SCOPE_SENTENCES: {
  log: { service: string; everyService: string };
  trace: { service: string; everyService: string };
} = {
  log: {
    service: translationKey(
      "OneUptime adds a scrub rule to the logs {{service}} sends, before they are stored. Other services' logs stay as they are.",
    ),
    everyService: translationKey(
      "OneUptime adds a scrub rule to the logs of every service and app in this project, before they are stored.",
    ),
  },
  trace: {
    service: translationKey(
      "OneUptime adds a scrub rule to the spans {{service}} sends, before they are stored. Other services' spans stay as they are.",
    ),
    everyService: translationKey(
      "OneUptime adds a scrub rule to the spans of every service and app in this project, before they are stored.",
    ),
  },
};

// A metric's attribute: its service's metric pipeline rule, as it always said.
export const SCRUB_IT_METRIC_DESCRIPTION: string = translationKey(
  "OneUptime adds a metric pipeline rule that redacts this kind of data in this attribute of the service's new metrics. Stored data does not change.",
);

const SCRUB_ACTION: string = translationKey("Scrub Action");
const FIELDS_TO_SCRUB: string = translationKey("Fields to Scrub");

const STORED_STAYS: string = translationKey(
  "What is stored already is not deleted. It stays until its retention ends.",
);

export const ALREADY_SCRUBBED: string = translationKey(
  "The scrub rule {{name}} already hides this data.",
);

/*
 * An IP address Security Events reads is hashed, not redacted (#10396):
 * what that keeps, in one line, where the action's own words would be.
 */
export const SCRUB_IT_HASHES_FOR_SECURITY_EVENTS: string = translationKey(
  "People will see a token instead of the address. Security Events still sees the address, so it can tell you which one to block.",
);

// What the dialog says under the rule's action: why it hashes, or what the action leaves.
export function getScrubItActionNote(
  plan: Pick<
    DataSecurityScrubRulePlan,
    "signal" | "patternType" | "hashesForSecurityEvents"
  >,
  action: RadioButton | undefined,
): string | undefined {
  if (plan.hashesForSecurityEvents) {
    return SCRUB_IT_HASHES_FOR_SECURITY_EVENTS;
  }

  if (plan.patternType === SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE) {
    return plan.signal === "log"
      ? LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY
      : SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY;
  }

  return action?.description;
}

export interface ComponentProps {
  findingId: ObjectID;
  onClose: () => void;
  onScrubbed: (result: DataSecurityScrubResult) => void;
}

const FactLine: FunctionComponent<{
  icon: IconProp;
  children: ReactElement;
  dataTestId: string;
}> = (props: {
  icon: IconProp;
  children: ReactElement;
  dataTestId: string;
}): ReactElement => {
  return (
    <li className="flex items-start gap-2" data-testid={props.dataTestId}>
      <Icon
        icon={props.icon}
        className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
      />
      <div className="min-w-0 flex-1">{props.children}</div>
    </li>
  );
};

// A label before its value, its colon the reader's language's.
const Labelled: FunctionComponent<{
  label: string;
  value: string;
  note?: string | undefined;
  dataTestId: string;
}> = (props: {
  label: string;
  value: string;
  note?: string | undefined;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid={props.dataTestId}>
      <span className="text-gray-600">
        {translator.translateTemplate(LABEL_WITH_COLON, {
          label: translatableTerm(props.label),
        })}
      </span>{" "}
      <span className="font-medium text-gray-900">
        {translator.translateText(props.value) || props.value}
      </span>
      {props.note ? (
        <span className="block text-xs text-gray-500">
          {translator.translateText(props.note) || props.note}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

// The words the rule form says each action with: its title and what it leaves.
export function getScrubActionWords(
  scrubAction: string,
): RadioButton | undefined {
  return SCRUB_ACTION_CHOICES.find((choice: RadioButton): boolean => {
    return choice.value === scrubAction;
  });
}

// The rule form's label for the parts of the records a rule scrubs.
export function getFieldsToScrubLabel(
  plan: Pick<DataSecurityScrubRulePlan, "signal" | "fieldsToScrub">,
): string {
  const options: Array<DropdownOption> = (
    plan.signal === "trace"
      ? TRACE_SCRUB_RULE_FORM_OPTIONS
      : LOG_SCRUB_RULE_FORM_OPTIONS
  ).fieldsToScrubOptions;

  return (
    options.find((option: DropdownOption): boolean => {
      return option.value === plan.fieldsToScrub;
    })?.label || ""
  );
}

// The dialog's sentence of whose records the rule changes.
export function getScrubItScopeSentence(
  plan: Pick<DataSecurityScrubRulePlan, "signal" | "serviceId">,
): string {
  if (plan.signal === "metric") {
    return SCRUB_IT_METRIC_DESCRIPTION;
  }

  const sentences: { service: string; everyService: string } =
    SCRUB_IT_SCOPE_SENTENCES[plan.signal];

  return plan.serviceId ? sentences.service : sentences.everyService;
}

const ScrubItModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [impact, setImpact] = useState<DataSecurityScrubImpact | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubError, setScrubError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setLoadError("");
    DataSecurityApi.getScrubImpact(props.findingId)
      .then((answer: DataSecurityScrubImpact) => {
        if (isCurrent) {
          setImpact(answer);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLoadError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.findingId.toString(), readCount]);

  // What the rule does is said before it is made: never pressed blind.
  const canScrub: boolean = Boolean(
    impact?.isAvailable && (impact.rule || impact.existingRule) && !isScrubbing,
  );

  const scrub: () => Promise<void> = async (): Promise<void> => {
    if (!canScrub) {
      return;
    }

    setIsScrubbing(true);
    setScrubError("");

    try {
      props.onScrubbed(await DataSecurityApi.scrubFinding(props.findingId));
    } catch (err) {
      setScrubError(API.getFriendlyMessage(err));
    }

    setIsScrubbing(false);
  };

  let description: ReactElement | undefined = undefined;
  let body: ReactElement;

  if (loadError) {
    body = (
      <ErrorMessage
        message={loadError}
        onRefreshClick={() => {
          setImpact(null);
          setReadCount((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  } else if (!impact) {
    body = <DetailListSkeleton fields={4} />;
  } else if (!impact.isAvailable) {
    body = (
      <Alert
        type={AlertType.WARNING}
        dataTestId="data-security-scrub-it-unavailable"
        title={impact.unavailableReason || ""}
      />
    );
  } else if (impact.existingRule) {
    body = (
      <p
        className="text-sm text-gray-700"
        data-testid="data-security-scrub-it-existing"
      >
        <TranslatedSentence
          template={ALREADY_SCRUBBED}
          slots={{
            name: (
              <AppLink
                className="font-medium underline [overflow-wrap:anywhere]"
                to={getRulesRoute(impact.existingRule.signal)}
              >
                {impact.existingRule.name}
              </AppLink>
            ),
          }}
        />
      </p>
    );
  } else {
    const plan: DataSecurityScrubRulePlan = impact.rule!;
    const isSensitiveKeys: boolean =
      plan.patternType === SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE;
    const action: RadioButton | undefined = getScrubActionWords(
      plan.scrubAction,
    );
    const fieldsLabel: string = getFieldsToScrubLabel(plan);

    description = (
      <span data-testid="data-security-scrub-it-scope">
        <TranslatedSentence
          template={getScrubItScopeSentence(plan)}
          slots={{
            service: (
              <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">
                {plan.serviceName || ""}
              </span>
            ),
          }}
        />
      </span>
    );

    // A metric's rule says it all in its one sentence, as it always did.
    body =
      plan.signal === "metric" ? (
        <></>
      ) : (
        <>
          <ul className="space-y-3 text-sm text-gray-700">
            {action ? (
              <FactLine
                icon={IconProp.EyeSlash}
                dataTestId="data-security-scrub-it-action"
              >
                <Labelled
                  label={SCRUB_ACTION}
                  value={action.title}
                  note={getScrubItActionNote(plan, action)}
                  dataTestId="data-security-scrub-it-action-words"
                />
              </FactLine>
            ) : (
              <></>
            )}
            {!isSensitiveKeys && fieldsLabel ? (
              <FactLine
                icon={IconProp.Filter}
                dataTestId="data-security-scrub-it-fields"
              >
                <Labelled
                  label={FIELDS_TO_SCRUB}
                  value={fieldsLabel}
                  dataTestId="data-security-scrub-it-fields-words"
                />
              </FactLine>
            ) : (
              <></>
            )}
            <FactLine
              icon={IconProp.Database}
              dataTestId="data-security-scrub-it-stored"
            >
              <span>{translator.translateText(STORED_STAYS)}</span>
            </FactLine>
          </ul>
          {impact.readers ? (
            <div className="text-sm text-gray-700">
              <TelemetryFieldReadersList readers={impact.readers} />
            </div>
          ) : (
            <></>
          )}
        </>
      );
  }

  return (
    <ConfirmModal
      title={TITLE}
      description={description || <></>}
      submitButtonText={SCRUB_IT}
      disableSubmitButton={!canScrub}
      isLoading={isScrubbing}
      error={scrubError || undefined}
      onClose={props.onClose}
      onSubmit={() => {
        void scrub();
      }}
    >
      <div className="space-y-4" data-testid={SCRUB_IT_MODAL_TEST_ID}>
        {body}
      </div>
    </ConfirmModal>
  );
};

export default ScrubItModal;
