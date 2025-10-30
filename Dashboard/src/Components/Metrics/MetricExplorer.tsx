import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricView from "./MetricView";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import Dictionary from "Common/Types/Dictionary";
import JSONFunctions from "Common/Types/JSONFunctions";
import Text from "Common/Types/Text";

const MetricExplorer: FunctionComponent = (): ReactElement => {
  const metricQueriesFromUrl: Array<MetricQueryFromUrl> =
    getMetricQueriesFromQuery();

  const defaultEndDate: Date = OneUptimeDate.getCurrentDate();
  const defaultStartDate: Date = OneUptimeDate.addRemoveHours(
    defaultEndDate,
    -1,
  );
  const defaultStartAndEndDate: InBetween<Date> = new InBetween(
    defaultStartDate,
    defaultEndDate,
  );

  const initialTimeRange: InBetween<Date> =
    getTimeRangeFromQuery() ?? defaultStartAndEndDate;

  const initialQueryConfigs = metricQueriesFromUrl.map(
    (metricQuery: MetricQueryFromUrl, index: number) => {
      return {
        metricAliasData: {
          metricVariable: Text.getLetterFromAByNumber(index),
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: metricQuery.metricName,
            attributes: metricQuery.attributes,
            aggegationType:
              metricQuery.aggregationType || MetricsAggregationType.Avg,
          },
        },
      };
    },
  );

  const [metricViewData, setMetricViewData] = React.useState<MetricViewData>({
    startAndEndDate: initialTimeRange,
    queryConfigs:
      initialQueryConfigs.length > 0
        ? initialQueryConfigs
        : [
            {
              metricAliasData: {
                metricVariable: "a",
                title: "",
                description: "",
                legend: "",
                legendUnit: "",
              },
              metricQueryData: {
                filterData: {
                  metricName: "",
                  attributes: {},
                  aggegationType: MetricsAggregationType.Avg,
                },
              },
            },
          ],
    formulaConfigs: [],
  });

  const lastSerializedStateRef = useRef<string>("");

  useEffect(() => {
    const metricQueriesFromState: Array<MetricQueryFromUrl> =
      buildMetricQueriesFromState(metricViewData);

    const metricQueriesForUrl: Array<MetricQueryFromUrl> =
      metricQueriesFromState.filter(isMeaningfulMetricQuery);

    const startTimeValue: Date | undefined =
      metricViewData.startAndEndDate?.startValue;
    const endTimeValue: Date | undefined =
      metricViewData.startAndEndDate?.endValue;

    const serializedState: string = JSON.stringify({
      metricQueries: metricQueriesForUrl,
      startTime: startTimeValue ? OneUptimeDate.toString(startTimeValue) : null,
      endTime: endTimeValue ? OneUptimeDate.toString(endTimeValue) : null,
    });

    if (serializedState === lastSerializedStateRef.current) {
      return;
    }

    const params: URLSearchParams = new URLSearchParams(window.location.search);

    if (metricQueriesForUrl.length > 0) {
      params.set("metricQueries", JSON.stringify(metricQueriesForUrl));
    } else {
      params.delete("metricQueries");
    }

    if (startTimeValue && endTimeValue) {
      params.set("startTime", OneUptimeDate.toString(startTimeValue));
      params.set("endTime", OneUptimeDate.toString(endTimeValue));
    } else {
      params.delete("startTime");
      params.delete("endTime");
    }

    params.delete("metricName");
    params.delete("attributes");
    params.delete("serviceName");

    const newQueryString: string = params.toString();
    const newUrl: string =
      newQueryString.length > 0
        ? `${window.location.pathname}?${newQueryString}`
        : window.location.pathname;

    window.history.replaceState({}, "", newUrl);

    lastSerializedStateRef.current = serializedState;
  }, [metricViewData]);

  return (
    <MetricView
      data={metricViewData}
      onChange={(data: MetricViewData) => {
        setMetricViewData(data);
      }}
    />
  );
};

export default MetricExplorer;

type MetricQueryFromUrl = {
  metricName: string;
  attributes: Dictionary<string | number | boolean>;
  aggregationType?: MetricsAggregationType;
};

function buildMetricQueriesFromState(
  data: MetricViewData,
): Array<MetricQueryFromUrl> {
  return data.queryConfigs.map((queryConfig) => {
    const filterData = queryConfig.metricQueryData?.filterData || {};

    const metricNameValue: unknown = (filterData as Record<string, unknown>)[
      "metricName"
    ];

    const metricName: string =
      typeof metricNameValue === "string" ? metricNameValue : "";

    const aggregationValue: unknown = (filterData as Record<string, unknown>)[
      "aggegationType"
    ];

    const aggregationType: MetricsAggregationType | undefined =
      getAggregationTypeFromValue(aggregationValue);

    const attributes: Dictionary<string | number | boolean> =
      sanitizeAttributes((filterData as Record<string, unknown>)["attributes"]);

    return {
      metricName,
      attributes,
      ...(aggregationType ? { aggregationType } : {}),
    };
  });
}

function getMetricQueriesFromQuery(): Array<MetricQueryFromUrl> {
  const metricQueriesParam: string | null =
    Navigation.getQueryStringByName("metricQueries");

  if (!metricQueriesParam) {
    return [];
  }

  try {
    const parsedValue: unknown = JSONFunctions.parse(metricQueriesParam);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    const sanitizedQueries: Array<MetricQueryFromUrl> = [];

    for (const entry of parsedValue) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const entryRecord: Record<string, unknown> = entry as Record<
        string,
        unknown
      >;

      const metricName: string =
        typeof entryRecord["metricName"] === "string"
          ? (entryRecord["metricName"] as string)
          : "";

      const attributes: Dictionary<string | number | boolean> =
        sanitizeAttributes(entryRecord["attributes"]);

      const aggregationType: MetricsAggregationType | undefined =
        getAggregationTypeFromValue(entryRecord["aggregationType"]);

      sanitizedQueries.push({
        metricName,
        attributes,
        ...(aggregationType ? { aggregationType } : {}),
      });
    }

    return sanitizedQueries;
  } catch (err) {
    return [];
  }
}

function getTimeRangeFromQuery(): InBetween<Date> | null {
  const startTimeParam: string | null =
    Navigation.getQueryStringByName("startTime");
  const endTimeParam: string | null =
    Navigation.getQueryStringByName("endTime");

  if (!startTimeParam || !endTimeParam) {
    return null;
  }

  if (
    !OneUptimeDate.isValidDateString(startTimeParam) ||
    !OneUptimeDate.isValidDateString(endTimeParam)
  ) {
    return null;
  }

  try {
    const startDate: Date = OneUptimeDate.fromString(startTimeParam);
    const endDate: Date = OneUptimeDate.fromString(endTimeParam);

    if (!OneUptimeDate.isOnOrBefore(startDate, endDate)) {
      return null;
    }

    return new InBetween(startDate, endDate);
  } catch (err) {
    return null;
  }
}

function sanitizeAttributes(
  value: unknown,
): Dictionary<string | number | boolean> {
  if (value === null || value === undefined) {
    return {};
  }

  let candidate: unknown = value;

  if (typeof value === "string") {
    try {
      candidate = JSONFunctions.parse(value);
    } catch (err) {
      return {};
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }

  const attributes: Dictionary<string | number | boolean> = {};

  for (const key in candidate as Record<string, unknown>) {
    const attributeValue: unknown = (candidate as Record<string, unknown>)[key];

    if (
      typeof attributeValue === "string" ||
      typeof attributeValue === "number" ||
      typeof attributeValue === "boolean"
    ) {
      attributes[key] = attributeValue;
    }
  }

  return attributes;
}

function getAggregationTypeFromValue(
  value: unknown,
): MetricsAggregationType | undefined {
  if (typeof value === "string") {
    const aggregationTypeValues: Array<string> = Object.values(
      MetricsAggregationType,
    ) as Array<string>;

    if (aggregationTypeValues.includes(value)) {
      return value as MetricsAggregationType;
    }
  }

  return undefined;
}

function isMeaningfulMetricQuery(query: MetricQueryFromUrl): boolean {
  if (query.metricName) {
    return true;
  }

  if (Object.keys(query.attributes).length > 0) {
    return true;
  }

  if (
    query.aggregationType &&
    query.aggregationType !== MetricsAggregationType.Avg
  ) {
    return true;
  }

  return false;
}
