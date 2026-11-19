import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import ObjectID from "Common/Types/ObjectID";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  AWS_ADDED_METRIC_STATISTICS,
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "Common/Types/Cloud/CloudAddedMetrics";
import {
  CloudPublishedMetric,
  CloudPublishedMetricsListing,
} from "Common/Types/Cloud/CloudPublishedMetrics";
import Modal from "Common/UI/Components/Modal/Modal";
import BasicRadioButtons from "Common/UI/Components/RadioButtons/BasicRadioButtons";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { drawCloudTemplate } from "../Connect/CloudConnectionWords";
import { getCloudAddedMetricCostWords } from "./CloudAddedMetricWords";
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
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const isAws: boolean =
    props.listing.provider.toLowerCase() === CloudProvider.AWS;
  const name: string = props.metric.displayName || props.metric.name;

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
      }),
    );
  };

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
