import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "Common/Types/Cloud/CloudAddedMetrics";
import {
  CloudAddedMetricReader,
  CloudAddedMetricReaderKind,
  CloudAddedMetricReaders,
} from "Common/Types/Cloud/CloudAddedMetricReaders";
import { CloudPublishedMetric } from "Common/Types/Cloud/CloudPublishedMetrics";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Modal from "Common/UI/Components/Modal/Modal";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../../AppLink/AppLink";
import { getMetricRecordingRulesRoute } from "../../Metrics/RecordingRule/RecordingRulesRoute";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  findCloudResourceMetricReaders,
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
 * for a type's addition - and names each, a link to it, before anything is
 * removed: "Remove Anyway" or "Keep Metric". With none, it is an ordinary
 * confirmation. A lookup that fails says so and still lets the person
 * remove it, and records that could not be checked are said to be.
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
const MONITORS: string = translationKey("Monitors");
const DASHBOARDS: string = translationKey("Dashboards");
const SLOS: string = translationKey("SLOs");
const RECORDING_RULES: string = translationKey("Recording Rules");
const REMOVE_ANYWAY: string = translationKey("Remove Anyway");
const REMOVE_METRIC: string = translationKey("Remove Metric");
const KEEP_METRIC: string = translationKey("Keep Metric");

const KIND_ROUTES: Record<
  Exclude<CloudAddedMetricReaderKind, CloudAddedMetricReaderKind.RecordingRule>,
  PageMap
> = {
  [CloudAddedMetricReaderKind.Monitor]: PageMap.MONITOR_VIEW,
  [CloudAddedMetricReaderKind.Dashboard]: PageMap.DASHBOARD_VIEW,
  [CloudAddedMetricReaderKind.Slo]: PageMap.SLO_VIEW,
};

// A reader's page: a recording rule has none, so its list, filtered to the metric it writes.
export function getCloudAddedMetricReaderRoute(
  reader: Pick<CloudAddedMetricReader, "kind" | "id" | "outputMetricName">,
): Route {
  if (reader.kind === CloudAddedMetricReaderKind.RecordingRule) {
    return getMetricRecordingRulesRoute(reader.outputMetricName || undefined);
  }

  return RouteUtil.populateRouteParams(
    RouteMap[KIND_ROUTES[reader.kind]] as Route,
    { modelId: new ObjectID(reader.id) },
  );
}

// The readers of one kind, each a link; a dashboard's with its widgets that read it.
const ReadersOfKind: FunctionComponent<{
  title: string;
  readers: Array<CloudAddedMetricReader>;
  kind: CloudAddedMetricReaderKind;
}> = (props: {
  title: string;
  readers: Array<CloudAddedMetricReader>;
  kind: CloudAddedMetricReaderKind;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const readers: Array<CloudAddedMetricReader> = props.readers.filter(
    (reader: CloudAddedMetricReader): boolean => {
      return reader.kind === props.kind;
    },
  );

  if (readers.length === 0) {
    return <></>;
  }

  return (
    <div data-testid={`cloud-remove-metric-readers-${props.kind}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(props.title)}
      </div>
      <ul className="mt-1 space-y-1">
        {readers.map((reader: CloudAddedMetricReader): ReactElement => {
          return (
            <li key={reader.id}>
              <AppLink
                className="font-medium text-indigo-600 hover:underline [overflow-wrap:anywhere]"
                to={getCloudAddedMetricReaderRoute(reader)}
              >
                {reader.name || reader.id}
              </AppLink>
              {reader.widgets.length > 0 ? (
                <ul className="mt-0.5 space-y-0.5 ps-4 text-xs text-gray-500">
                  {reader.widgets.map(
                    (widget: string, index: number): ReactElement => {
                      return (
                        <li
                          key={`${index}-${widget}`}
                          className="[overflow-wrap:anywhere]"
                        >
                          {widget || translator.translateText(UNTITLED_WIDGET)}
                        </li>
                      );
                    },
                  )}
                </ul>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const CloudRemoveMetricModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [readers, setReaders] = useState<CloudAddedMetricReaders | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>("");
  const name: string = props.metric.displayName || props.metric.name;
  const key: string = props.metric.addedKey || "";

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

  const remove: () => Promise<void> = async (): Promise<void> => {
    setIsRemoving(true);
    setRemoveError("");

    try {
      props.onRemoved(
        await removeCloudResourceMetric({
          cloudResourceId: props.cloudResourceId,
          key,
        }),
      );
    } catch (err) {
      setRemoveError(API.getFriendlyMessage(err));
      setIsRemoving(false);
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
        <ReadersOfKind
          title={MONITORS}
          readers={readers.readers}
          kind={CloudAddedMetricReaderKind.Monitor}
        />
        <ReadersOfKind
          title={DASHBOARDS}
          readers={readers.readers}
          kind={CloudAddedMetricReaderKind.Dashboard}
        />
        <ReadersOfKind
          title={SLOS}
          readers={readers.readers}
          kind={CloudAddedMetricReaderKind.Slo}
        />
        <ReadersOfKind
          title={RECORDING_RULES}
          readers={readers.readers}
          kind={CloudAddedMetricReaderKind.RecordingRule}
        />
        {readers.hidden > 0 ? (
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

  return (
    <Modal
      title={translator.translateTemplate(TITLE, { metric: name })}
      isTitleTranslated={true}
      submitButtonText={isAtRisk ? REMOVE_ANYWAY : REMOVE_METRIC}
      submitButtonStyleType={ButtonStyleType.DANGER}
      closeButtonText={isAtRisk ? KEEP_METRIC : undefined}
      onSubmit={() => {
        void remove();
      }}
      onClose={props.onClose}
      isLoading={isRemoving}
      disableSubmitButton={!readers && !loadError}
      error={removeError || undefined}
      errorWhatFailed={translator.translateText("The metric was not removed.")}
    >
      <div
        className="space-y-4 text-sm text-gray-700"
        data-testid={CLOUD_REMOVE_METRIC_MODAL_TEST_ID}
      >
        {props.metric.addedScope === CloudAddedMetricScope.Type ? (
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
