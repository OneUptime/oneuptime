import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  CloudMetricCollectionState,
  CloudMetricNotRead,
  CloudMetricNotReadKind,
  CloudResourceMetricCollection,
} from "Common/Types/Cloud/CloudResourceMetricCollection";
import {
  CLOUD_UNREPORTED_REASON_SENTENCES,
  CloudUnreportedReason,
} from "Common/Types/Cloud/CloudUnreportedKeyMetrics";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getCloudResourceMetricCollection } from "./CloudResourceMetricsApi";

/*
 * HOW A CLOUD RESOURCE'S METRICS WERE COLLECTED (#10291).
 *
 * One line above the resource's metrics, on its Metrics tab and in its
 * Overview's Metrics card: when its connection last read them, with a dot
 * that says how that went. While all is well that is all it says. When the
 * read could not read some of them, or any, it says so, and "Show why"
 * opens what: each metric by its cloud's own name, why in OneUptime's words
 * - its cloud does not serve it (asked again a day later), was too busy to
 * answer (asked again at the next read), or failed - and since when, then
 * what its cloud answered, in its own words. The server works it out
 * (CloudResourceMetrics.collectionOf) from what the reads kept; a resource
 * whose reads keep nothing (another cloud's) draws nothing.
 */

export const CLOUD_METRIC_COLLECTION_TEST_ID: string =
  "cloud-metric-collection";
export const CLOUD_METRIC_NOT_READ_TEST_ID: string = "cloud-metric-not-read";

export const CLOUD_METRICS_READ_AT: string = translationKey(
  "Its metrics were read {{time}}.",
);
export const CLOUD_METRICS_NOT_READ_SINCE: string = translationKey(
  "Its metrics have not been read since {{time}}.",
);
export const CLOUD_METRICS_NOT_READ: string = translationKey(
  "Its metrics could not be read at its connection's last read.",
);
export const CLOUD_METRICS_FIRST_READ: string = translationKey(
  "Its metrics are read for the first time at its connection's next read.",
);
export const CLOUD_METRIC_NOT_READ_SINCE: string = translationKey(
  "Not read since {{time}}.",
);

// Why a metric was not read, in the words a resource's unreported key metrics use.
const KIND_SENTENCES: Readonly<Record<CloudMetricNotReadKind, string>> = {
  [CloudMetricNotReadKind.Unsupported]:
    CLOUD_UNREPORTED_REASON_SENTENCES[CloudUnreportedReason.NotServed],
  [CloudMetricNotReadKind.Throttled]:
    CLOUD_UNREPORTED_REASON_SENTENCES[CloudUnreportedReason.CloudBusy],
  [CloudMetricNotReadKind.Failed]:
    CLOUD_UNREPORTED_REASON_SENTENCES[CloudUnreportedReason.ReadFailed],
};

const DOT_CLASS_NAMES: Readonly<Record<CloudMetricCollectionState, string>> = {
  [CloudMetricCollectionState.Collected]: "bg-green-500",
  [CloudMetricCollectionState.Partial]: "bg-amber-500",
  [CloudMetricCollectionState.Failed]: "bg-red-500",
  [CloudMetricCollectionState.Waiting]: "bg-gray-400",
  [CloudMetricCollectionState.Off]: "bg-gray-400",
};

// A moment something has been so since, in the reader's own format.
export function getCloudMetricMoment(iso: string): string {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(new Date(iso));
}

// The line's sentence for a collection, in the reader's language.
export function getCloudMetricCollectionLine(data: {
  collection: CloudResourceMetricCollection;
  translator: Translator;
}): string {
  const collection: CloudResourceMetricCollection = data.collection;
  const translator: Translator = data.translator;
  // When it was read, as a while ago; since when it was not, as a moment (getCloudMetricMoment).
  const fromNow: (iso: string) => string = (iso: string): string => {
    return OneUptimeDate.fromNow(new Date(iso));
  };

  switch (collection.state) {
    case CloudMetricCollectionState.Collected:
      return translator.translateTemplate(CLOUD_METRICS_READ_AT, {
        time: collection.lastReadAt ? fromNow(collection.lastReadAt) : "",
      });
    case CloudMetricCollectionState.Partial:
      return translator.translatePlural(
        {
          one: "Its metrics were read {{time}}, but one of them could not be.",
          other:
            "Its metrics were read {{time}}, but {{count}} of them could not be.",
        },
        collection.metrics.length,
        {
          time: collection.lastReadAt ? fromNow(collection.lastReadAt) : "",
        },
      );
    case CloudMetricCollectionState.Failed:
      return collection.failedSince
        ? translator.translateTemplate(CLOUD_METRICS_NOT_READ_SINCE, {
            time: getCloudMetricMoment(collection.failedSince),
          })
        : translator.translateText(CLOUD_METRICS_NOT_READ) ||
            CLOUD_METRICS_NOT_READ;
    case CloudMetricCollectionState.Waiting:
      return (
        translator.translateText(CLOUD_METRICS_FIRST_READ) ||
        CLOUD_METRICS_FIRST_READ
      );
    case CloudMetricCollectionState.Off:
    default:
      return (
        translator.translateText(
          CLOUD_UNREPORTED_REASON_SENTENCES[
            CloudUnreportedReason.ConnectionOff
          ],
        ) ||
        CLOUD_UNREPORTED_REASON_SENTENCES[CloudUnreportedReason.ConnectionOff]
      );
  }
}

export interface ComponentProps {
  cloudResourceId: ObjectID;
}

const CloudResourceMetricCollectionLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Undefined while it loads; null where there is nothing to say.
  const [collection, setCollection] = useState<
    CloudResourceMetricCollection | null | undefined
  >(undefined);
  const [error, setError] = useState<string>("");
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    setCollection(undefined);
    setError("");

    getCloudResourceMetricCollection(props.cloudResourceId)
      .then((answer: CloudResourceMetricCollection | null) => {
        if (isCurrent) {
          setCollection(answer);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.cloudResourceId.toString()]);

  if (error) {
    return (
      <ErrorLine
        message={error}
        whatFailed={translator.translateText(
          "Couldn't load how this resource's metrics were collected.",
        )}
        className="mb-4 text-sm"
      />
    );
  }

  if (collection === undefined) {
    return <InlineValueSkeleton widthClassName="w-72" className="mb-4" />;
  }

  if (!collection) {
    return <></>;
  }

  const hasDetails: boolean =
    collection.metrics.length > 0 || Boolean(collection.error);

  return (
    <div className="mb-4 text-sm" data-testid={CLOUD_METRIC_COLLECTION_TEST_ID}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_CLASS_NAMES[collection.state]}`}
        />
        <span className="text-gray-600">
          {getCloudMetricCollectionLine({ collection, translator })}
        </span>
        {hasDetails ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => {
              setIsOpen(!isOpen);
            }}
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            {isOpen
              ? translator.translateText("Hide") || "Hide"
              : translator.translateText("Show why") || "Show why"}
          </button>
        ) : (
          <></>
        )}
      </div>
      {hasDetails && isOpen ? (
        <div className="mt-2 space-y-2 border-l-2 border-gray-200 pl-3">
          {collection.error ? (
            <p
              className="break-words font-mono text-xs text-gray-500"
              dir="ltr"
            >
              {collection.error}
            </p>
          ) : (
            <></>
          )}
          {collection.metrics.length > 0 ? (
            <ul className="space-y-2">
              {collection.metrics.map((metric: CloudMetricNotRead) => {
                return (
                  <li
                    key={`${metric.kind}-${metric.name}`}
                    data-testid={CLOUD_METRIC_NOT_READ_TEST_ID}
                    className="text-sm"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span
                        className="break-all font-mono text-xs text-gray-700"
                        dir="ltr"
                      >
                        {metric.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {translator.translateTemplate(
                          CLOUD_METRIC_NOT_READ_SINCE,
                          { time: getCloudMetricMoment(metric.since) },
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {translator.translateText(KIND_SENTENCES[metric.kind]) ||
                        KIND_SENTENCES[metric.kind]}
                    </p>
                    {metric.error ? (
                      <p
                        className="mt-0.5 break-words font-mono text-xs text-gray-500"
                        dir="ltr"
                      >
                        {metric.error}
                      </p>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudResourceMetricCollectionLine;
