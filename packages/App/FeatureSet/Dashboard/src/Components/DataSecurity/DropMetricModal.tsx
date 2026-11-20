import AppLink from "../AppLink/AppLink";
import MetricReadersList, {
  MAX_METRIC_READERS_SHOWN,
  MAX_READER_WIDGETS_SHOWN,
  MetricReaderListGroup,
  MetricReaderListKind,
  MetricReaderListKindWords,
  isMetricReaderGroupShown,
} from "../Metrics/Readers/MetricReadersList";
import DataSecurityApi from "./DataSecurityApi";
import { getRulesRoute } from "./TelemetryScrubIt";
import {
  DataSecurityDropMetricImpact,
  DataSecurityDropMetricResult,
  DataSecurityDropMetricUnavailableReason,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import {
  PluralTemplate,
  Translator,
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
 * DROP THIS METRIC: WHAT IT DROPS, BEFORE IT DOES (issue #9757).
 *
 * A finding in a metric's name cannot be scrubbed - no rule takes the data
 * out of a name - but the service's metrics named with it can be kept from
 * being stored, until the code that names them is fixed: a metric pipeline
 * Drop rule. Their new data points are lost for good, so this dialog says,
 * from what the server worked out (dropMetricImpact):
 *
 *  - that the points are lost for good, first, in the danger colour;
 *  - how many of the service's metrics of the last day it drops - never
 *    their names, which hold the data;
 *  - what reads those metrics and so gets no new data (#9946): monitors,
 *    dashboards with the widgets on them that read them, SLOs and recording
 *    rules, each kind saying plainly what happens to it and each record a
 *    link - a recording rule's to its list, filtered to it, and a widget's
 *    to its dashboard opened at it (#10084). Under a recording rule, what
 *    reads its output metric, which no longer includes them either, on
 *    down the chain (#10085). Records the reader may not see are counted
 *    ("2 more you can't see"), never named. Or that none does, or that a
 *    kind could not be checked. Listed as More Metrics' Remove lists what
 *    reads a cloud metric, by the one list of what reads a metric
 *    (MetricReadersList, #10107);
 *  - that what is stored already is not deleted;
 *  - and how to undo it: delete the rule.
 *
 * The drop is asked for deliberately: its button stays locked until the
 * reader ticks that they understand. It is made as them, with their
 * permission to create metric pipeline rules, and audited as theirs.
 */

export const DROP_METRIC_MODAL_TEST_ID: string = "data-security-drop-metric";

// How many records of each kind the dialog names; the rest are counted.
export const MAX_METRIC_USERS_SHOWN: number = MAX_METRIC_READERS_SHOWN;

const TITLE: string = translationKey("Drop This Metric");
const DESCRIPTION: string = translationKey(
  "OneUptime adds a metric pipeline rule that drops new data points of the metrics of {{service}} whose names hold {{dataType}}.",
);
const SUBMIT: string = translationKey("Drop These Metrics");
const LOST_FOR_GOOD: string = translationKey(
  "From now on, their new data points are lost for good: they are never stored, and deleting the rule later does not bring them back.",
);
const METRICS_MATCHED: PluralTemplate = {
  one: "{{count}} metric written in the last day has such a name.",
  other: "{{count}} metrics written in the last day have such a name.",
};
// Of the service's first 10,000 metric names: there were more.
const METRICS_MATCHED_CAPPED: PluralTemplate = {
  one: "At least {{count}} metric written in the last day has such a name.",
  other: "At least {{count}} metrics written in the last day have such a name.",
};
const NO_METRIC_MATCHED: string = translationKey(
  "No metric written in the last day has such a name yet. The rule drops the ones that come.",
);
const METRICS_UNCOUNTED: string = translationKey(
  "How many metrics have such a name could not be counted.",
);
const USERS_GO_QUIET: string = translationKey(
  "What reads those metrics gets no new data from them:",
);
const NO_USERS: string = translationKey(
  "No monitor, dashboard, SLO or recording rule reads those metrics.",
);

// What the drop does to each kind of record that reads those metrics, said plainly.
export const READER_KIND_WORDS: Readonly<{
  monitors: MetricReaderListKindWords;
  dashboards: MetricReaderListKindWords;
  slos: MetricReaderListKindWords;
  recordingRules: MetricReaderListKindWords;
}> = {
  monitors: {
    consequence: translationKey(
      "They get no new data from those metrics, so they can no longer alert on their values.",
    ),
    unchecked: translationKey(
      "Whether a monitor reads those metrics could not be checked.",
    ),
  },
  dashboards: {
    consequence: translationKey(
      "The widgets named under each show no new data from those metrics.",
    ),
    unchecked: translationKey(
      "Whether a dashboard reads those metrics could not be checked.",
    ),
  },
  slos: {
    consequence: translationKey(
      "They count no new events from those metrics, so their error budgets no longer include them.",
    ),
    unchecked: translationKey(
      "Whether an SLO reads those metrics could not be checked.",
    ),
  },
  recordingRules: {
    consequence: translationKey(
      "They get no new points from those metrics, so their output metrics no longer include them.",
    ),
    unchecked: translationKey(
      "Whether a recording rule reads those metrics could not be checked.",
    ),
  },
};

// How many of a dashboard's widgets are named under it; the rest are counted.
export const MAX_WIDGETS_SHOWN: number = MAX_READER_WIDGETS_SHOWN;

const STORED_STAYS: string = translationKey(
  "What is stored already is not deleted. It stays until its retention ends.",
);
const HOW_TO_UNDO: string = translationKey(
  "To store them again, delete the rule from the {{rules}}.",
);
const PIPELINE_RULES: string = translationKey("metric pipeline rules");
const UNDERSTOOD: string = translationKey(
  "I understand that these data points are lost for good",
);
const ALREADY_DROPPED: string = translationKey(
  "The metric pipeline rule {{name}} already drops these metrics.",
);

// Why no rule can drop them, in the reader's words (the server's own say the same).
export const DROP_UNAVAILABLE_SENTENCES: Readonly<
  Record<DataSecurityDropMetricUnavailableReason, string>
> = {
  [DataSecurityDropMetricUnavailableReason.NotAMetricName]: translationKey(
    "Drop This Metric is for findings in a metric's name. Scrub It hides the other findings in metrics.",
  ),
  [DataSecurityDropMetricUnavailableReason.NoPattern]: translationKey(
    "No pattern can find this data type in a metric's name, so no rule could tell those metrics apart. Rename the metrics in your code, and send what varies in their names as an attribute instead.",
  ),
  [DataSecurityDropMetricUnavailableReason.NoService]: translationKey(
    "The service these metrics were sent under no longer exists, so no new metrics of it are left to drop.",
  ),
};

export interface ComponentProps {
  findingId: ObjectID;
  // The data type, as the page names it: "Email address".
  dataTypeName: string;
  // The service whose metrics they are, as the page names it.
  serviceName: string;
  onClose: () => void;
  onDropped: (result: DataSecurityDropMetricResult) => void;
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

/*
 * How many of the service's metrics it drops: a count, at least a count
 * when there were more names than are read, none yet - or not known, when
 * they could not be read or none of the names read had one.
 */
export function countSentence(
  impact: DataSecurityDropMetricImpact,
  translator: Translator,
): string {
  if (!impact.metricsCounted) {
    return translator.translateText(METRICS_UNCOUNTED) || METRICS_UNCOUNTED;
  }

  if (impact.metricsMatched > 0) {
    return translator.translatePlural(
      impact.isMetricsMatchedCapped ? METRICS_MATCHED_CAPPED : METRICS_MATCHED,
      impact.metricsMatched,
    );
  }

  const sentence: string = impact.isMetricsMatchedCapped
    ? METRICS_UNCOUNTED
    : NO_METRIC_MATCHED;

  return translator.translateText(sentence) || sentence;
}

const DropMetricModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [impact, setImpact] = useState<DataSecurityDropMetricImpact | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [isUnderstood, setIsUnderstood] = useState<boolean>(false);
  const [isDropping, setIsDropping] = useState<boolean>(false);
  const [dropError, setDropError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setLoadError("");
    DataSecurityApi.getDropMetricImpact(props.findingId)
      .then((answer: DataSecurityDropMetricImpact) => {
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

  const canDrop: boolean = Boolean(
    impact?.isAvailable && !impact.existingRule && isUnderstood && !isDropping,
  );

  const drop: () => Promise<void> = async (): Promise<void> => {
    if (!canDrop) {
      return;
    }

    setIsDropping(true);
    setDropError("");

    try {
      props.onDropped(await DataSecurityApi.dropMetric(props.findingId));
    } catch (err) {
      setDropError(API.getFriendlyMessage(err));
    }

    setIsDropping(false);
  };

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
        dataTestId="data-security-drop-metric-unavailable"
        title={
          DROP_UNAVAILABLE_SENTENCES[
            impact.unavailableReason ||
              DataSecurityDropMetricUnavailableReason.NotAMetricName
          ]
        }
      />
    );
  } else if (impact.existingRule) {
    body = (
      <p
        className="text-sm text-gray-700"
        data-testid="data-security-drop-metric-existing"
      >
        <TranslatedSentence
          template={ALREADY_DROPPED}
          slots={{
            name: (
              <AppLink
                className="font-medium underline [overflow-wrap:anywhere]"
                to={getRulesRoute("metric")}
              >
                {impact.existingRule.name}
              </AppLink>
            ),
          }}
        />
      </p>
    );
  } else {
    const kinds: Array<MetricReaderListGroup> = [
      {
        kind: MetricReaderListKind.Monitor,
        readers: impact.monitors,
        hidden: impact.monitorsHidden,
        isChecked: impact.monitorsChecked,
        words: READER_KIND_WORDS.monitors,
        dataTestId: "data-security-drop-metric-monitors",
      },
      {
        kind: MetricReaderListKind.Dashboard,
        readers: impact.dashboards,
        hidden: impact.dashboardsHidden,
        isChecked: impact.dashboardsChecked,
        words: READER_KIND_WORDS.dashboards,
        dataTestId: "data-security-drop-metric-dashboards",
      },
      {
        kind: MetricReaderListKind.Slo,
        readers: impact.slos,
        hidden: impact.slosHidden,
        isChecked: impact.slosChecked,
        words: READER_KIND_WORDS.slos,
        dataTestId: "data-security-drop-metric-slos",
      },
      {
        kind: MetricReaderListKind.RecordingRule,
        readers: impact.recordingRules,
        hidden: impact.recordingRulesHidden,
        isChecked: impact.recordingRulesChecked,
        words: READER_KIND_WORDS.recordingRules,
        dataTestId: "data-security-drop-metric-recording-rules",
        hiddenOutputReaders: impact.recordingRulesHiddenOutputReaders,
      },
    ];
    const isAnyRead: boolean = kinds.some(isMetricReaderGroupShown);
    const isEveryKindChecked: boolean = kinds.every(
      (kind: MetricReaderListGroup): boolean => {
        return kind.isChecked;
      },
    );

    body = (
      <>
        <Alert
          type={AlertType.DANGER}
          dataTestId="data-security-drop-metric-lost"
          title={LOST_FOR_GOOD}
        />
        <ul className="space-y-3 text-sm text-gray-700">
          <FactLine
            icon={IconProp.ChartBar}
            dataTestId="data-security-drop-metric-count"
          >
            <span>{countSentence(impact, translator)}</span>
          </FactLine>
          <FactLine
            icon={IconProp.Alert}
            dataTestId="data-security-drop-metric-users"
          >
            <div className="space-y-3">
              {isAnyRead ? (
                <p>{translator.translateText(USERS_GO_QUIET)}</p>
              ) : isEveryKindChecked ? (
                <p>{translator.translateText(NO_USERS)}</p>
              ) : (
                <></>
              )}
              <MetricReadersList
                groups={kinds}
                widgetsDataTestId="data-security-drop-metric-widgets"
              />
            </div>
          </FactLine>
          <FactLine
            icon={IconProp.Database}
            dataTestId="data-security-drop-metric-stored"
          >
            <span>{translator.translateText(STORED_STAYS)}</span>
          </FactLine>
          <FactLine
            icon={IconProp.ArrowUturnLeft}
            dataTestId="data-security-drop-metric-undo"
          >
            <span>
              <TranslatedSentence
                template={HOW_TO_UNDO}
                slots={{
                  rules: (
                    <AppLink
                      className="font-medium text-indigo-600 hover:underline"
                      to={getRulesRoute("metric")}
                    >
                      {translator.translateText(PIPELINE_RULES) ||
                        PIPELINE_RULES}
                    </AppLink>
                  ),
                }}
              />
            </span>
          </FactLine>
        </ul>
        <Checkbox
          title={UNDERSTOOD}
          value={isUnderstood}
          onChange={(value: boolean) => {
            setIsUnderstood(value);
          }}
          dataTestId="data-security-drop-metric-understood"
        />
      </>
    );
  }

  return (
    <ConfirmModal
      title={TITLE}
      description={
        <span>
          <TranslatedSentence
            template={DESCRIPTION}
            slots={{
              service: (
                <span className="font-medium text-gray-900">
                  {props.serviceName}
                </span>
              ),
              dataType: (
                <span className="font-medium text-gray-900">
                  {props.dataTypeName}
                </span>
              ),
            }}
          />
        </span>
      }
      submitButtonText={SUBMIT}
      submitButtonType={ButtonStyleType.DANGER}
      disableSubmitButton={!canDrop}
      isLoading={isDropping}
      error={dropError || undefined}
      onClose={props.onClose}
      onSubmit={() => {
        void drop();
      }}
    >
      <div className="space-y-4" data-testid={DROP_METRIC_MODAL_TEST_ID}>
        {body}
      </div>
    </ConfirmModal>
  );
};

export default DropMetricModal;
