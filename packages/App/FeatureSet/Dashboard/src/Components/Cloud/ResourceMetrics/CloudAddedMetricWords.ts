import { getNumberLocale } from "Common/Types/DateLanguage";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudAddedMetricCostEstimate,
  estimateCloudAddedMetricCost,
} from "Common/Types/CloudConnection/CloudConnectionCost";
import {
  TemplateValue,
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { CloudTemplate } from "../Connect/CloudConnectionWords";

/*
 * WHAT ADDING A METRIC COSTS, IN WORDS (#9563): said in the dialog before
 * a metric is added, for each choice - this resource, or every resource of
 * its type - from CloudConnectionCost.estimateCloudAddedMetricCost. Each
 * cloud bills its own way, so each says its own unit: AWS's metrics read,
 * Azure's calls, Google Cloud's time series.
 */

// A number written the way the sentence's language writes it.
function numberIn(value: number, fractionDigits?: number): TemplateValue {
  return composedValue((translator: Translator): string => {
    const options: Intl.NumberFormatOptions | undefined =
      fractionDigits === undefined
        ? undefined
        : {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
          };

    try {
      return value.toLocaleString(
        getNumberLocale(translator.language),
        options,
      );
    } catch {
      return value.toLocaleString("en-US", options);
    }
  });
}

// A cost in dollars to the cent; under a cent, a cent.
function costIn(costUsd: number): TemplateValue {
  return numberIn(Math.max(0.01, Math.round(costUsd * 100) / 100), 2);
}

export const ADDED_METRIC_RIDES_ALONG: string = translationKey(
  "No extra cost: it is read in the call that already reads the key metrics.",
);

export function getCloudAddedMetricCostWords(data: {
  provider: CloudProvider | string;
  resources: number;
  readIntervalInMinutes: number;
  azureGrain?: string | undefined;
  azureMetricsInCall?: number | undefined;
  azureHasFiveMinuteCall?: boolean | undefined;
  // Split by a dimension (#9808): each resource's series, one a value.
  isSplit?: boolean | undefined;
  seriesPerResource?: number | undefined;
}): CloudTemplate {
  const provider: CloudProvider = String(
    data.provider,
  ).toLowerCase() as CloudProvider;
  const estimate: CloudAddedMetricCostEstimate = estimateCloudAddedMetricCost({
    provider,
    resources: data.resources,
    readIntervalInMinutes: data.readIntervalInMinutes,
    azureGrain: data.azureGrain,
    azureMetricsInCall: data.azureMetricsInCall,
    azureHasFiveMinuteCall: data.azureHasFiveMinuteCall,
    isSplit: data.isSplit,
    seriesPerResource: data.seriesPerResource,
  });

  if (estimate.ridesInExistingCall) {
    return { template: ADDED_METRIC_RIDES_ALONG, values: {} };
  }

  const values: Record<string, TemplateValue> = {
    count: numberIn(estimate.monthlyUnits),
    cost: costIn(estimate.monthlyCostUsd),
  };

  if (provider === CloudProvider.AWS) {
    return {
      template: translationKey(
        "{{count}} more metrics read from CloudWatch a month: about ${{cost}}, at $0.01 per 1,000.",
      ),
      values,
    };
  }

  if (provider === CloudProvider.Azure) {
    return {
      template: translationKey(
        "{{count}} more Azure Monitor calls a month: free within each subscription's first 1,000,000 a month, then about ${{cost}}.",
      ),
      values,
    };
  }

  return {
    template: translationKey(
      "{{count}} more time series read a month: free within the first 1,000,000 a month, then about ${{cost}}.",
    ),
    values,
  };
}
