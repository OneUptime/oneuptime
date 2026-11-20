import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import ObjectID from "Common/Types/ObjectID";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  AWS_ADDED_METRIC_STATISTICS,
  CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "Common/Types/Cloud/CloudAddedMetrics";
import {
  CloudPublishedMetric,
  CloudPublishedMetricSplit,
  CloudPublishedMetricsListing,
} from "Common/Types/Cloud/CloudPublishedMetrics";
import Modal from "Common/UI/Components/Modal/Modal";
import BasicRadioButtons from "Common/UI/Components/RadioButtons/BasicRadioButtons";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { drawCloudTemplate } from "../Connect/CloudConnectionWords";
import {
  GCP_SPLIT_LEARNED_FROM_EVERY_VALUE,
  getCloudAddedMetricCostWords,
} from "./CloudAddedMetricWords";
import { addCloudResourceMetric } from "./CloudResourceMetricsApi";

/*
 * ADDING ONE OF THE METRICS A CLOUD RESOURCE PUBLISHES TO WHAT ITS
 * CONNECTION READS (#9563).
 *
 * A short job, so a dialog: for whom it is read - this resource (the
 * default, the cheapest), or every resource of its type the connection
 * reads - each with what it costs a month in the customer's own cloud bill
 * before anything is added (CloudAddedMetricWords). An AWS metric says no
 * statistic of its own, so the dialog offers CloudWatch's, the name's
 * likely one first chosen. Added, the connection reads it from its next
 * read; the page's list shows it under "Added metrics".
 *
 * A metric with dimensions can be split by one (#9808): a series per value,
 * at most CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES a resource, each charted and
 * judged on its own - and each choice's cost counts every series. A metric
 * its cloud reads only split offers no "Don't split". On Google Cloud, which
 * bills every series a call returns, the busiest values alone are asked
 * for, and the dialog says so, with what that costs at most (#10076).
 */
export interface ComponentProps {
  cloudResourceId: ObjectID;
  metric: CloudPublishedMetric;
  listing: CloudPublishedMetricsListing;
  // The resource's type, as the catalog names it: "App Service".
  typeLabel: string;
  onClose: () => void;
  onAdded: (addedMetrics: Array<CloudAddedMetric>) => void;
}

export const CLOUD_ADD_METRIC_MODAL_TEST_ID: string = "cloud-add-metric-modal";

const DONT_SPLIT: string = translationKey("Don't split");
const SPLIT_HELP: string = translationKey(
  "A series for each value, up to {{max}} for each resource, to chart and alert on.",
);
const SPLIT_REQUIRED_HELP: string = translationKey(
  "Its cloud reads it only split. A series for each value, up to {{max}} for each resource, to chart and alert on.",
);
/*
 * Google Cloud bills every series a call returns: a split is asked for each
 * resource's busiest values alone, learned again every hour (#10076).
 */
const GCP_SPLIT_HELP: string = translationKey(
  "A series for each of the {{max}} busiest values on each resource, checked every hour, so Google Cloud bills those alone.",
);

const CloudAddMetricModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const statisticId: string = useId();
  const [scope, setScope] = useState<CloudAddedMetricScope>(
    CloudAddedMetricScope.Resource,
  );
  const [statistic, setStatistic] = useState<string>(
    props.metric.aggregation || "Average",
  );
  const splitId: string = useId();
  const splits: Array<CloudPublishedMetricSplit> = props.metric.splits || [];
  const [splitBy, setSplitBy] = useState<string>(
    props.metric.isSplitRequired ? splits[0]?.name || "" : "",
  );
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const isAws: boolean =
    props.listing.provider.toLowerCase() === CloudProvider.AWS;
  const isGcp: boolean =
    props.listing.provider.toLowerCase() === CloudProvider.GCP;
  const name: string = props.metric.displayName || props.metric.name;

  const split: CloudPublishedMetricSplit | undefined = splits.find(
    (candidate: CloudPublishedMetricSplit): boolean => {
      return candidate.name === splitBy;
    },
  );
  /*
   * Its connection's reads found PromQL cannot rank its values (#10164):
   * the hourly learning reads every value, which its cost counts.
   */
  const learnsEveryValue: boolean =
    isGcp && Boolean(split?.isLearnedFromEveryValue);

  const costOf: (resources: number) => string = (resources: number): string => {
    return drawCloudTemplate(
      translator,
      getCloudAddedMetricCostWords({
        provider: props.listing.provider,
        resources,
        readIntervalInMinutes: props.listing.readIntervalInMinutes,
        azureGrain: props.metric.grain,
        azureMetricsInCall: props.listing.azureMetricsInCall,
        azureHasFiveMinuteCall: props.listing.azureHasFiveMinuteCall,
        ...(split
          ? {
              isSplit: true,
              // Its values now where the listing saw them, else the most read.
              seriesPerResource: Math.min(
                CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
                split.values || CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
              ),
              ...(learnsEveryValue && split.learnedValuesPerResource
                ? {
                    gcpLearnedValuesPerResource: split.learnedValuesPerResource,
                  }
                : {}),
            }
          : {}),
      }),
    );
  };

  const splitOptions: Array<DropdownOption> = [
    ...(props.metric.isSplitRequired ? [] : [{ value: "", label: DONT_SPLIT }]),
    ...splits.map((candidate: CloudPublishedMetricSplit): DropdownOption => {
      return {
        value: candidate.name,
        // As its cloud names it: a dimension's name is never looked up.
        label:
          candidate.displayName && candidate.displayName !== candidate.name
            ? `${candidate.displayName} (${candidate.name})`
            : candidate.name,
        isUserContent: true,
      };
    }),
  ];

  const statisticOptions: Array<DropdownOption> =
    AWS_ADDED_METRIC_STATISTICS.map((value: string): DropdownOption => {
      return { value, label: value };
    });

  const add: () => Promise<void> = async (): Promise<void> => {
    setIsAdding(true);
    setError("");

    try {
      const added: Array<CloudAddedMetric> = await addCloudResourceMetric({
        cloudResourceId: props.cloudResourceId,
        name: props.metric.name,
        namespace: props.metric.namespace,
        scope,
        aggregation: isAws ? statistic : undefined,
        splitBy: splitBy || undefined,
      });

      props.onAdded(added);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsAdding(false);
    }
  };

  return (
    <Modal
      title={translator.translateTemplate("Add {{metric}}", { metric: name })}
      isTitleTranslated={true}
      description="OneUptime reads it with the key metrics from the next read, so you can chart it and alert on it."
      submitButtonText="Add Metric"
      onSubmit={() => {
        void add();
      }}
      onClose={props.onClose}
      isLoading={isAdding}
      error={error || undefined}
      errorWhatFailed={translator.translateText("The metric was not added.")}
    >
      <div data-testid={CLOUD_ADD_METRIC_MODAL_TEST_ID}>
        <p className="text-sm font-medium text-gray-900">
          {translator.translateText("Read it for")}
        </p>
        <BasicRadioButtons
          initialValue={CloudAddedMetricScope.Resource}
          onChange={(value: string) => {
            if (value) {
              setScope(value as CloudAddedMetricScope);
            }
          }}
          options={[
            {
              value: CloudAddedMetricScope.Resource,
              title:
                translator.translateText("This resource") || "This resource",
              description: costOf(1),
            },
            {
              value: CloudAddedMetricScope.Type,
              title: translator.translateTemplate(
                "Every {{type}} this connection reads ({{count}})",
                {
                  type: props.typeLabel,
                  count: translator.formatNumber(
                    Math.max(1, props.listing.resourcesOfType),
                  ),
                },
              ),
              description: costOf(Math.max(1, props.listing.resourcesOfType)),
            },
          ]}
        />
        {splits.length > 0 ? (
          <div className="mt-5">
            <label
              htmlFor={splitId}
              className="block text-sm font-medium text-gray-900"
            >
              {translator.translateText("Split by")}
            </label>
            <p
              className="mt-0.5 text-xs text-gray-500"
              data-testid="cloud-add-metric-split-help"
            >
              {translator.translateTemplate(
                props.metric.isSplitRequired
                  ? SPLIT_REQUIRED_HELP
                  : isGcp
                    ? GCP_SPLIT_HELP
                    : SPLIT_HELP,
                {
                  max: translator.formatNumber(
                    CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
                  ),
                },
              )}
            </p>
            <div className="mt-2 max-w-xs">
              <Dropdown
                inputId={splitId}
                options={splitOptions}
                value={splitOptions.find((option: DropdownOption) => {
                  return option.value === splitBy;
                })}
                isClearable={false}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (typeof value === "string") {
                    setSplitBy(value);
                  }
                }}
                dataTestId="cloud-add-metric-split"
              />
            </div>
            {learnsEveryValue ? (
              <p
                className="mt-1.5 text-xs text-amber-700"
                data-testid="cloud-add-metric-split-every-value"
              >
                {translator.translateText(GCP_SPLIT_LEARNED_FROM_EVERY_VALUE)}
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
        {isAws ? (
          <div className="mt-5">
            <label
              htmlFor={statisticId}
              className="block text-sm font-medium text-gray-900"
            >
              {translator.translateText("Statistic")}
            </label>
            <p className="mt-0.5 text-xs text-gray-500">
              {translator.translateText(
                "CloudWatch does not say how this metric is best read. Sum adds up a count, Average reads a level or a rate.",
              )}
            </p>
            <div className="mt-2 max-w-xs">
              <Dropdown
                inputId={statisticId}
                options={statisticOptions}
                value={statisticOptions.find((option: DropdownOption) => {
                  return option.value === statistic;
                })}
                isClearable={false}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (typeof value === "string") {
                    setStatistic(value);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CloudAddMetricModal;
