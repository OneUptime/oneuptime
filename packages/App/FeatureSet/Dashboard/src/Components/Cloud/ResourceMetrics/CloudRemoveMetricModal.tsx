import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  CLOUD_MAX_ADDED_METRICS_PER_CONNECTION,
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "Common/Types/Cloud/CloudAddedMetrics";
import {
  CloudAddedMetricKeepBlock,
  CloudAddedMetricKeepFor,
  CloudAddedMetricReader,
  CloudAddedMetricReaderKind,
  CloudAddedMetricReaders,
} from "Common/Types/Cloud/CloudAddedMetricReaders";
import { CloudPublishedMetric } from "Common/Types/Cloud/CloudPublishedMetrics";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IsolatedTextList from "Common/UI/Components/IsolatedText/IsolatedTextList";
import Modal from "Common/UI/Components/Modal/Modal";
import BasicRadioButtons from "Common/UI/Components/RadioButtons/BasicRadioButtons";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MetricReadersList, {
  MAX_METRIC_READERS_SHOWN,
  MetricReaderListGroup,
  MetricReaderListKind,
  MetricReaderListKindWords,
  getMetricReaderRoute,
} from "../../Metrics/Readers/MetricReadersList";
import {
  findCloudResourceMetricReaders,
  keepCloudResourceMetricFor,
  removeCloudResourceMetric,
} from "./CloudResourceMetricsApi";

/*
 * REMOVING A METRIC SOMEONE ADDED TO WHAT A CLOUD CONNECTION READS, SAYING
 * FIRST WHAT IT LEAVES WITHOUT DATA (#9807).
 *
 * A monitor, a dashboard's widget, an SLO or a recording rule reads an
 * added metric as it reads a key metric. Removed, the connection stops
 * reading it at once, and they get no new data of it - a monitor has
 * nothing to judge, a chart goes flat. So Remove asks the server first
 * which of them read it (CloudResourceMetrics.readersOf, the lookup Drop
 * This Metric asks too) - of this resource, or of any resource of its type
 * for a type's addition - and lists them as Drop This Metric does
 * (MetricReadersList, #10107): kind by kind, each with what removing it
 * does to them, each record a link, the first few and then a count, and
 * the ones the person cannot open counted, never named. Then "Remove
 * Anyway" or "Keep Metric". With none, it is an ordinary confirmation. A
 * lookup that fails says so and still lets the person remove it, and
 * records that could not be checked are said to be.
 *
 * A metric added for every resource of its type is often read of a few of
 * them alone, while every one of them costs a read (#10078). Then the
 * dialog offers a clear choice: keep it for the resources its readers read
 * - named, each read by an addition of its own from then on, the rest
 * costing nothing - or remove it for every one. It is not offered while a
 * reader reads it of every resource (the dialog marks which, and says why),
 * while some records could not be checked, when the connection would read
 * too many added metrics (it says so), or when its readers read it of every
 * resource there is.
 */
export interface ComponentProps {
  cloudResourceId: ObjectID;
  metric: CloudPublishedMetric;
  // The resource's type, as the catalog names it: "App Service".
  typeLabel: string;
  // The resources of its type the connection reads.
  resourcesOfType: number;
  onClose: () => void;
  onRemoved: (addedMetrics: Array<CloudAddedMetric>) => void;
  // A type's addition kept for the resources its readers read alone (#10078).
  onKept?: ((addedMetrics: Array<CloudAddedMetric>) => void) | undefined;
}

export const CLOUD_REMOVE_METRIC_MODAL_TEST_ID: string =
  "cloud-remove-metric-modal";

const TITLE: string = translationKey("Remove {{metric}}?");
const READ_FOR_TYPE: PluralTemplate = {
  one: "It is read for every {{type}} this connection reads ({{count}}), so removing it stops it for that one too.",
  other:
    "It is read for every {{type}} this connection reads ({{count}}), so removing it stops it for all of them.",
};
const READERS_GO_QUIET: PluralTemplate = {
  one: "{{count}} monitor, dashboard, SLO or recording rule reads it. Once it is removed, it gets no new data.",
  other:
    "{{count}} monitors, dashboards, SLOs and recording rules read it. Once it is removed, they get no new data.",
};
// An answer that counts the hidden readers together, not kind by kind.
const HIDDEN_READERS: PluralTemplate = {
  one: "{{count}} more reads it that your role cannot open.",
  other: "{{count}} more read it that your role cannot open.",
};
const UNCHECKED: string = translationKey(
  "Some monitors, dashboards, SLOs or recording rules could not be checked just now and may read it.",
);
const NO_READERS: string = translationKey(
  "No monitor, dashboard, SLO or recording rule reads it.",
);
const STORED_STAYS: string = translationKey(
  "What it stored stays until its retention ends, and you can add it again from this list.",
);
const UNTITLED_WIDGET: string = translationKey("Untitled widget");
const NOT_REMOVED_FAILED: string = translationKey(
  "The metric was not removed.",
);
const NOT_KEPT_FAILED: string = translationKey(
  "The metric was not kept for those resources.",
);
const REMOVE_ANYWAY: string = translationKey("Remove Anyway");
const REMOVE_METRIC: string = translationKey("Remove Metric");
const KEEP_METRIC: string = translationKey("Keep Metric");

// What removing it does to each kind of record that reads it, said plainly.
export const CLOUD_READER_KIND_WORDS: Readonly<
  Record<CloudAddedMetricReaderKind, MetricReaderListKindWords>
> = {
  [CloudAddedMetricReaderKind.Monitor]: {
    consequence: translationKey(
      "They get no new data from it, so they can no longer alert on its values.",
    ),
  },
  [CloudAddedMetricReaderKind.Dashboard]: {
    consequence: translationKey(
      "The widgets named under each show no new data from it.",
    ),
  },
  [CloudAddedMetricReaderKind.Slo]: {
    consequence: translationKey(
      "They count no new events from it, so their error budgets no longer include it.",
    ),
  },
  [CloudAddedMetricReaderKind.RecordingRule]: {
    consequence: translationKey(
      "They get no new points from it, so their output metrics no longer include it.",
    ),
  },
};

const LIST_KINDS: ReadonlyArray<{
  kind: CloudAddedMetricReaderKind;
  listKind: MetricReaderListKind;
}> = [
  {
    kind: CloudAddedMetricReaderKind.Monitor,
    listKind: MetricReaderListKind.Monitor,
  },
  {
    kind: CloudAddedMetricReaderKind.Dashboard,
    listKind: MetricReaderListKind.Dashboard,
  },
  {
    kind: CloudAddedMetricReaderKind.Slo,
    listKind: MetricReaderListKind.Slo,
  },
  {
    kind: CloudAddedMetricReaderKind.RecordingRule,
    listKind: MetricReaderListKind.RecordingRule,
  },
];

// #10078: keeping a type's addition for the resources its readers read.
const KEEP_FOR_THEM: PluralTemplate = {
  one: "Keep it for the resource its readers read",
  other: "Keep it for the {{count}} resources its readers read",
};
const STOPS_FOR_OTHERS: PluralTemplate = {
  one: "It stops being read, and billed, for the other one.",
  other: "It stops being read, and billed, for the other {{count}}.",
};
const REMOVE_FOR_EVERY: string = translationKey("Remove it for every {{type}}");
const REMOVED_FOR_EVERY: string = translationKey(
  "Its readers get no new data from it.",
);
const KEEP_FOR_THESE: string = translationKey("Keep for These Resources");
const READS_EVERY: string = translationKey("Reads it of every {{type}}");
const NOT_KEPT_EVERY_SHOWN: string = translationKey(
  "It can't be kept for only the resources its readers read: one of them reads it of every {{type}}.",
);
const NOT_KEPT_EVERY_HIDDEN: string = translationKey(
  "It can't be kept for only the resources its readers read: a record you can't see reads it of every {{type}}.",
);
const NOT_KEPT_FULL: PluralTemplate = {
  one: "It can't be kept for only the resource its readers read: this connection would read more than {{max}} added metrics. Remove another added metric first.",
  other:
    "It can't be kept for only the {{count}} resources its readers read: this connection would read more than {{max}} added metrics. Remove another added metric first.",
};
const MORE_RESOURCES: PluralTemplate = {
  one: "and {{count}} more",
  other: "and {{count}} more",
};

enum Choice {
  Keep = "keep",
  Remove = "remove",
}

// A reader's page: a recording rule has none, so its list, filtered to the metric it writes.
export function getCloudAddedMetricReaderRoute(
  reader: Pick<CloudAddedMetricReader, "kind" | "id" | "outputMetricName">,
): Route {
  return getMetricReaderRoute(
    LIST_KINDS.find((entry: { kind: CloudAddedMetricReaderKind }) => {
      return entry.kind === reader.kind;
    })!.listKind,
    reader,
  );
}

/*
 * The answer's readers as the shared list lists them, kind by kind: each
 * kind's ones the person cannot open counted with it where the answer
 * counts them kind by kind, and a reader of every resource of a type's
 * addition saying so under its link.
 */
export function getCloudReaderGroups(data: {
  readers: CloudAddedMetricReaders;
  everyResourceNote: string;
}): Array<MetricReaderListGroup> {
  return LIST_KINDS.map(
    (entry: {
      kind: CloudAddedMetricReaderKind;
      listKind: MetricReaderListKind;
    }): MetricReaderListGroup => {
      return {
        kind: entry.listKind,
        readers: data.readers.readers
          .filter((reader: CloudAddedMetricReader): boolean => {
            return reader.kind === entry.kind;
          })
          .map((reader: CloudAddedMetricReader) => {
            return {
              id: reader.id,
              name: reader.name,
              widgets: reader.widgets,
              ...(reader.outputMetricName
                ? { outputMetricName: reader.outputMetricName }
                : {}),
              ...(reader.readsEveryResource
                ? { note: data.everyResourceNote }
                : {}),
            };
          }),
        hidden: data.readers.hiddenByKind?.[entry.kind] || 0,
        isChecked: !data.readers.uncheckedKinds.includes(entry.kind),
        words: CLOUD_READER_KIND_WORDS[entry.kind],
        dataTestId: `cloud-remove-metric-readers-${entry.kind}`,
      };
    },
  );
}

/*
 * Whether a type's addition can be kept for the resources its readers read
 * alone: something reads it, nothing blocks it, and some resource of its
 * type is not among them - else keeping it for them saves nothing.
 */
export function canKeepCloudAddedMetricFor(data: {
  keepFor: CloudAddedMetricKeepFor | undefined;
  resourcesOfType: number;
}): boolean {
  return Boolean(
    data.keepFor &&
      !data.keepFor.blockedBy &&
      data.keepFor.resources.length > 0 &&
      data.keepFor.resources.length < data.resourcesOfType,
  );
}

const CloudRemoveMetricModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [readers, setReaders] = useState<CloudAddedMetricReaders | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [choice, setChoice] = useState<Choice>(Choice.Keep);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const name: string = props.metric.displayName || props.metric.name;
  const key: string = props.metric.addedKey || "";
  const isTypeWide: boolean =
    props.metric.addedScope === CloudAddedMetricScope.Type;

  useEffect(() => {
    let isCurrent: boolean = true;

    setLoadError("");
    findCloudResourceMetricReaders({
      cloudResourceId: props.cloudResourceId,
      key,
    })
      .then((answer: CloudAddedMetricReaders) => {
        if (isCurrent) {
          setReaders(answer);
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
  }, [props.cloudResourceId.toString(), key, readCount]);

  const count: number = readers ? readers.readers.length + readers.hidden : 0;
  const isUnchecked: boolean = Boolean(readers?.uncheckedKinds.length);
  // Something reads it, or may: removing it is then a choice to confirm.
  const isAtRisk: boolean = count > 0 || isUnchecked;
  const keepFor: CloudAddedMetricKeepFor | undefined = isTypeWide
    ? readers?.keepFor
    : undefined;
  const canKeep: boolean = canKeepCloudAddedMetricFor({
    keepFor,
    resourcesOfType: props.resourcesOfType,
  });
  const isKeeping: boolean = canKeep && choice === Choice.Keep;

  const save: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setSaveError("");

    try {
      if (isKeeping && keepFor) {
        const kept: Array<CloudAddedMetric> = await keepCloudResourceMetricFor({
          cloudResourceId: props.cloudResourceId,
          key,
          cloudResourceIds: keepFor.resources.map(
            (resource: { id: string }): string => {
              return resource.id;
            },
          ),
        });

        (props.onKept || props.onRemoved)(kept);
        return;
      }

      props.onRemoved(
        await removeCloudResourceMetric({
          cloudResourceId: props.cloudResourceId,
          key,
        }),
      );
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
      setIsSaving(false);
    }
  };

  let body: ReactElement;

  if (loadError) {
    body = (
      <ErrorMessage
        message={loadError}
        onRefreshClick={() => {
          setReaders(null);
          setReadCount((current: number): number => {
            return current + 1;
          });
        }}
      />
    );
  } else if (!readers) {
    body = <DetailListSkeleton fields={3} />;
  } else if (count > 0) {
    // Counted together by an answer that does not count them kind by kind.
    const isHiddenTogether: boolean =
      readers.hidden > 0 && !readers.hiddenByKind;

    body = (
      <div className="space-y-4">
        <Alert
          type={AlertType.WARNING}
          dataTestId="cloud-remove-metric-readers"
          title={
            // Worded here, in the reader's plural: an element, so it is not looked up again.
            <span>{translator.translatePlural(READERS_GO_QUIET, count)}</span>
          }
        />
        <MetricReadersList
          groups={getCloudReaderGroups({
            readers,
            everyResourceNote: translator.translateTemplate(READS_EVERY, {
              type: props.typeLabel,
            }),
          })}
          widgetsDataTestId="cloud-remove-metric-widgets"
          untitledWidget={UNTITLED_WIDGET}
        />
        {isHiddenTogether ? (
          <p className="text-sm text-gray-600">
            {translator.translatePlural(HIDDEN_READERS, readers.hidden)}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  } else if (isUnchecked) {
    // Said below: whether anything reads it is not known.
    body = <></>;
  } else {
    body = (
      <p
        className="text-sm text-gray-700"
        data-testid="cloud-remove-metric-no-readers"
      >
        {translator.translateText(NO_READERS)}
      </p>
    );
  }

  // Why it cannot be kept for its readers' resources alone, where that is worth saying.
  let notKept: string = "";

  if (keepFor?.blockedBy === CloudAddedMetricKeepBlock.EveryResource) {
    notKept = translator.translateTemplate(
      readers?.readers.some((reader: CloudAddedMetricReader): boolean => {
        return Boolean(reader.readsEveryResource);
      })
        ? NOT_KEPT_EVERY_SHOWN
        : NOT_KEPT_EVERY_HIDDEN,
      { type: props.typeLabel },
    );
  } else if (keepFor?.blockedBy === CloudAddedMetricKeepBlock.ConnectionFull) {
    notKept = translator.translatePlural(
      NOT_KEPT_FULL,
      keepFor.resources.length,
      {
        max: translator.formatNumber(CLOUD_MAX_ADDED_METRICS_PER_CONNECTION),
      },
    );
  }

  const keptNames: Array<string | ReactElement> = (keepFor?.resources || [])
    .slice(0, MAX_METRIC_READERS_SHOWN)
    .map((resource: { id: string; name: string }): string => {
      return resource.name || resource.id;
    });
  const moreKept: number =
    (keepFor?.resources.length || 0) - MAX_METRIC_READERS_SHOWN;

  if (moreKept > 0) {
    keptNames.push(
      <span key="more">
        {translator.translatePlural(MORE_RESOURCES, moreKept)}
      </span>,
    );
  }

  return (
    <Modal
      title={translator.translateTemplate(TITLE, { metric: name })}
      isTitleTranslated={true}
      submitButtonText={
        isKeeping ? KEEP_FOR_THESE : isAtRisk ? REMOVE_ANYWAY : REMOVE_METRIC
      }
      submitButtonStyleType={
        isKeeping ? ButtonStyleType.PRIMARY : ButtonStyleType.DANGER
      }
      closeButtonText={canKeep ? undefined : isAtRisk ? KEEP_METRIC : undefined}
      onSubmit={() => {
        void save();
      }}
      onClose={props.onClose}
      isLoading={isSaving}
      disableSubmitButton={!readers && !loadError}
      error={saveError || undefined}
      errorWhatFailed={translator.translateText(
        isKeeping ? NOT_KEPT_FAILED : NOT_REMOVED_FAILED,
      )}
    >
      <div
        className="space-y-4 text-sm text-gray-700"
        data-testid={CLOUD_REMOVE_METRIC_MODAL_TEST_ID}
      >
        {isTypeWide ? (
          <p data-testid="cloud-remove-metric-type-wide">
            {translator.translatePlural(
              READ_FOR_TYPE,
              Math.max(1, props.resourcesOfType),
              { type: props.typeLabel },
            )}
          </p>
        ) : (
          <></>
        )}
        {body}
        {isUnchecked ? (
          <p
            className="text-sm text-gray-600"
            data-testid="cloud-remove-metric-unchecked"
          >
            {translator.translateText(UNCHECKED)}
          </p>
        ) : (
          <></>
        )}
        {canKeep && keepFor ? (
          <div data-testid="cloud-remove-metric-keep-for">
            <BasicRadioButtons
              initialValue={Choice.Keep}
              onChange={(value: string) => {
                if (value) {
                  setChoice(value as Choice);
                }
              }}
              options={[
                {
                  value: Choice.Keep,
                  title: translator.translatePlural(
                    KEEP_FOR_THEM,
                    keepFor.resources.length,
                  ),
                  description: translator.translatePlural(
                    STOPS_FOR_OTHERS,
                    Math.max(
                      1,
                      props.resourcesOfType - keepFor.resources.length,
                    ),
                  ),
                  children: (
                    <div className="mt-1 ps-7">
                      <IsolatedTextList
                        className="block text-xs text-gray-500 [overflow-wrap:anywhere]"
                        dataTestId="cloud-remove-metric-kept-resources"
                        texts={keptNames}
                      />
                    </div>
                  ),
                },
                {
                  value: Choice.Remove,
                  title: translator.translateTemplate(REMOVE_FOR_EVERY, {
                    type: props.typeLabel,
                  }),
                  description: translator.translateText(REMOVED_FOR_EVERY),
                },
              ]}
            />
          </div>
        ) : (
          <></>
        )}
        {notKept ? (
          <p
            className="text-sm text-gray-600"
            data-testid="cloud-remove-metric-not-kept"
          >
            {notKept}
          </p>
        ) : (
          <></>
        )}
        {readers || loadError ? (
          <p className="text-xs text-gray-500">
            {translator.translateText(STORED_STAYS)}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CloudRemoveMetricModal;
