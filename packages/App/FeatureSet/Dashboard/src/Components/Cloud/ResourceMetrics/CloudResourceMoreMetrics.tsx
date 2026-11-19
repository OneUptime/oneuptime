import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  CLOUD_MAX_ADDED_METRICS_PER_RESOURCE,
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "Common/Types/Cloud/CloudAddedMetrics";
import {
  CLOUD_PUBLISHED_METRIC_BLOCK_REASONS,
  CloudPublishedMetric,
  CloudPublishedMetricStatus,
  CloudPublishedMetricsListing,
} from "Common/Types/Cloud/CloudPublishedMetrics";
import { getCloudResourceTypeDisplayName } from "Common/Types/Cloud/CloudResourceCatalog";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import Input from "Common/UI/Components/Input/Input";
import { readAsWritten } from "Common/UI/Components/IsolatedText/ReadAsWritten";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import CloudAddMetricModal from "./CloudAddMetricModal";
import {
  listCloudResourcePublishedMetrics,
  removeCloudResourceMetric,
} from "./CloudResourceMetricsApi";

/*
 * THE OTHER METRICS A CLOUD RESOURCE PUBLISHES (#9563), on its Metrics tab.
 *
 * A connection reads a curated set of key metrics per resource type; a
 * resource publishes more. Listed on demand - "List Metrics" asks the
 * resource's cloud now, through its connection, and never before
 * (CloudResourceMetrics.listPublished: free in each cloud) - each with
 * whether the connection reads it: what someone added first, with Remove;
 * then what can be added, each with Add, which says what it costs before
 * it is added (CloudAddMetricModal); then what cannot, and why; then the
 * key metrics read already. A long list can be searched. Adding and
 * removing are for whoever may edit connections, as they change what the
 * account is billed; everyone else sees the list, and who can.
 */
export interface ComponentProps {
  cloudResourceId: ObjectID;
  provider: string;
  resourceType: string;
  // Told when the connection's additions change, so the page re-sections its list.
  onAddedMetricsChange?:
    | ((addedMetrics: Array<CloudAddedMetric>) => void)
    | undefined;
}

// A search box once the list holds more than this many metrics.
export const CLOUD_MORE_METRICS_SEARCH_FROM: number = 8;

export const CLOUD_MORE_METRICS_ROW_TEST_ID: string = "cloud-more-metrics-row";

const CloudResourceMoreMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [listing, setListing] = useState<CloudPublishedMetricsListing | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [adding, setAdding] = useState<CloudPublishedMetric | null>(null);
  const [removingKey, setRemovingKey] = useState<string>("");
  const typeLabel: string = getCloudResourceTypeDisplayName(
    props.provider,
    props.resourceType,
  );

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      setListing(
        await listCloudResourcePublishedMetrics(props.cloudResourceId),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const remove: (metric: CloudPublishedMetric) => Promise<void> = async (
    metric: CloudPublishedMetric,
  ): Promise<void> => {
    if (!metric.addedKey) {
      return;
    }

    setRemovingKey(metric.addedKey);

    try {
      const added: Array<CloudAddedMetric> = await removeCloudResourceMetric({
        cloudResourceId: props.cloudResourceId,
        key: metric.addedKey,
      });

      props.onAddedMetricsChange?.(added);
      Toast.success(
        translator.translateTemplate("{{metric}} is no longer read.", {
          metric: metric.displayName || metric.name,
        }),
      );
      await load();
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    } finally {
      setRemovingKey("");
    }
  };

  const shown: Array<CloudPublishedMetric> = useMemo(() => {
    const wanted: string = search.trim().toLowerCase();

    return (listing?.metrics || []).filter(
      (metric: CloudPublishedMetric): boolean => {
        return (
          !wanted ||
          metric.name.toLowerCase().includes(wanted) ||
          (metric.displayName || "").toLowerCase().includes(wanted) ||
          (metric.description || "").toLowerCase().includes(wanted)
        );
      },
    );
  }, [listing, search]);

  const statusOf: (metric: CloudPublishedMetric) => ReactElement = (
    metric: CloudPublishedMetric,
  ): ReactElement => {
    if (metric.status === CloudPublishedMetricStatus.Key) {
      return (
        <Pill text="Key metric" tone={PillTone.Neutral} isDotHidden={true} />
      );
    }

    if (metric.status === CloudPublishedMetricStatus.Added) {
      return (
        <>
          <Pill
            text={
              metric.addedScope === CloudAddedMetricScope.Type
                ? "Added for its type"
                : "Added"
            }
            tone={PillTone.Success}
          />
          {listing?.canEdit ? (
            <Button
              title="Remove"
              buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
              buttonSize={ButtonSize.Small}
              isLoading={removingKey === metric.addedKey}
              onClick={() => {
                void remove(metric);
              }}
            />
          ) : (
            <></>
          )}
        </>
      );
    }

    if (metric.block || !listing?.canEdit) {
      return <></>;
    }

    return (
      <Button
        title="Add"
        icon={IconProp.Add}
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        onClick={() => {
          setAdding(metric);
        }}
      />
    );
  };

  return (
    <Card
      title="More Metrics"
      description="Metrics this resource's cloud publishes that OneUptime does not read yet. Add one to chart it and alert on it."
      buttons={[
        {
          title: listing ? "List Again" : "List Metrics",
          icon: listing ? IconProp.Refresh : IconProp.List,
          buttonStyle: listing
            ? ButtonStyleType.OUTLINE
            : ButtonStyleType.NORMAL,
          isLoading,
          onClick: () => {
            void load();
          },
        },
      ]}
    >
      <div data-testid="cloud-more-metrics">
        {error ? (
          <ErrorLine
            message={error}
            whatFailed={translator.translateText(
              "Couldn't list what this resource publishes.",
            )}
          />
        ) : isLoading && !listing ? (
          <TableSkeleton rows={5} hasHeader={false} />
        ) : !listing ? (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "OneUptime asks the resource's cloud only when you list them, and listing costs nothing.",
            )}
          </p>
        ) : listing.metrics.length === 0 ? (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Its cloud lists no other metrics for this resource.",
            )}
          </p>
        ) : (
          <div>
            {listing.metrics.length > CLOUD_MORE_METRICS_SEARCH_FROM ? (
              <div className="mb-3 max-w-md">
                <Input
                  value={search}
                  onChange={setSearch}
                  placeholder="Search metrics"
                  dataTestId="cloud-more-metrics-search"
                />
              </div>
            ) : (
              <></>
            )}
            {shown.length === 0 ? (
              <p className="text-sm text-gray-500">
                {translator.translateText("No metrics match this search.")}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {shown.map((metric: CloudPublishedMetric) => {
                  const block: string | undefined = metric.block
                    ? CLOUD_PUBLISHED_METRIC_BLOCK_REASONS[metric.block]
                    : undefined;

                  return (
                    <li
                      key={`${metric.namespace || ""}|${metric.name}`}
                      data-testid={CLOUD_MORE_METRICS_ROW_TEST_ID}
                      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-medium text-gray-900">
                          {readAsWritten(
                            metric.displayName || metric.name,
                            translator.language,
                          )}
                        </div>
                        {metric.displayName ? (
                          <div
                            className="break-all font-mono text-xs text-gray-500"
                            dir="ltr"
                          >
                            {metric.name}
                          </div>
                        ) : (
                          <></>
                        )}
                        {metric.description ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                            {readAsWritten(
                              metric.description,
                              translator.language,
                            )}
                          </p>
                        ) : (
                          <></>
                        )}
                        {block ? (
                          <p className="mt-0.5 text-xs text-gray-500">
                            {translator.translateText(block) || block}
                          </p>
                        ) : (
                          <></>
                        )}
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        {metric.unit ? (
                          <span
                            className="font-mono text-xs text-gray-500"
                            dir="ltr"
                          >
                            {metric.unit}
                          </span>
                        ) : (
                          <></>
                        )}
                        {statusOf(metric)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500">
              {listing.canEdit
                ? translator.translatePlural(
                    {
                      one: "{{count}} of {{max}} added metrics is read for this resource.",
                      other:
                        "{{count}} of {{max}} added metrics are read for this resource.",
                    },
                    listing.addedForResource,
                    {
                      max: translator.formatNumber(
                        CLOUD_MAX_ADDED_METRICS_PER_RESOURCE,
                      ),
                    },
                  )
                : translator.translateText(
                    "Project Owners and Project Admins can add and remove metrics.",
                  )}
            </p>
          </div>
        )}
      </div>
      {adding && listing ? (
        <CloudAddMetricModal
          cloudResourceId={props.cloudResourceId}
          metric={adding}
          listing={listing}
          typeLabel={typeLabel}
          onClose={() => {
            setAdding(null);
          }}
          onAdded={(added: Array<CloudAddedMetric>) => {
            const name: string = adding.displayName || adding.name;

            setAdding(null);
            props.onAddedMetricsChange?.(added);
            Toast.success(
              translator.translateTemplate(
                "{{metric}} is read from the next read.",
                { metric: name },
              ),
            );
            void load();
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default CloudResourceMoreMetrics;
