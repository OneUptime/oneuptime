import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { GCP_OPS_AGENT_INSTALL_URL } from "Common/Types/Cloud/CloudKeyMetrics";
import {
  CLOUD_UNREPORTED_FIX_LABELS,
  CLOUD_UNREPORTED_LOOK_BACK_DAYS,
  CloudUnreportedKeyMetricReport,
  CloudUnreportedReasonEntry,
  getCloudUnreportedReasonText,
} from "Common/Types/Cloud/CloudUnreportedKeyMetrics";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { explainCloudResourceUnreportedKeyMetrics } from "./CloudResourceMetricsApi";

/*
 * WHAT A SECTION OF A CLOUD RESOURCE'S METRICS DID NOT REPORT, AND WHY (#9569).
 *
 * Opened from a section's "2 not reported" (MetricRowGroupHeading): each
 * key metric of the section the resource did not report in the list's
 * range, by its cloud's own name, with since when it did not - "Last
 * reported 3 hours ago", "Never reported" (the look-back holds the
 * resource's whole life), or "Not reported in the last 30 days" - and its
 * likely reasons, most likely first, each with what fixes it where
 * something does: Cloud > Connect, or the Ops Agent's install guide - and,
 * where its connection's read kept it, what its cloud answered, in its
 * own words (#10291). The server works the reasons out
 * (CloudResourceMetrics.explainUnreported), asked when the section is
 * opened, never before.
 */
export interface ComponentProps {
  cloudResourceId: ObjectID;
  // The section's key metrics the resource did not report, by key, in order.
  keys: Array<string>;
}

export const CLOUD_UNREPORTED_ROW_TEST_ID: string =
  "cloud-unreported-key-metric";
// What the cloud answered, under a reason that kept it.
export const CLOUD_UNREPORTED_ERROR_TEST_ID: string =
  "cloud-unreported-key-metric-error";

const CloudUnreportedKeyMetricsList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [reports, setReports] =
    useState<Array<CloudUnreportedKeyMetricReport> | null>(null);
  const [error, setError] = useState<string>("");
  const keysKey: string = props.keys.join("\n");

  useEffect(() => {
    let isCurrent: boolean = true;

    setReports(null);
    setError("");

    explainCloudResourceUnreportedKeyMetrics({
      cloudResourceId: props.cloudResourceId,
      keys: props.keys,
    })
      .then((answer: Array<CloudUnreportedKeyMetricReport>) => {
        if (isCurrent) {
          setReports(answer);
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
  }, [props.cloudResourceId.toString(), keysKey]);

  if (error) {
    return (
      <ErrorLine
        message={error}
        whatFailed={translator.translateText(
          "Couldn't say why these key metrics were not reported.",
        )}
        className="text-sm"
      />
    );
  }

  if (!reports) {
    return <TableSkeleton rows={props.keys.length} hasHeader={false} />;
  }

  // In the section's order, whatever order the server answered in.
  const ordered: Array<CloudUnreportedKeyMetricReport> = props.keys
    .map((key: string): CloudUnreportedKeyMetricReport | undefined => {
      return reports.find((report: CloudUnreportedKeyMetricReport) => {
        return report.key === key;
      });
    })
    .filter(
      (
        report: CloudUnreportedKeyMetricReport | undefined,
      ): report is CloudUnreportedKeyMetricReport => {
        return Boolean(report);
      },
    );

  const sinceWhen: (report: CloudUnreportedKeyMetricReport) => string = (
    report: CloudUnreportedKeyMetricReport,
  ): string => {
    if (report.lastReportedAt) {
      return translator.translateTemplate("Last reported {{time}}", {
        time: OneUptimeDate.fromNow(new Date(report.lastReportedAt)),
      });
    }

    if (report.isNeverReported) {
      return translator.translateText("Never reported") || "Never reported";
    }

    return translator.translatePlural(
      {
        one: "Not reported in the last {{count}} day",
        other: "Not reported in the last {{count}} days",
      },
      CLOUD_UNREPORTED_LOOK_BACK_DAYS,
    );
  };

  const fixOf: (entry: CloudUnreportedReasonEntry) => ReactElement | null = (
    entry: CloudUnreportedReasonEntry,
  ): ReactElement | null => {
    if (!entry.fix) {
      return null;
    }

    const label: string =
      translator.translateText(CLOUD_UNREPORTED_FIX_LABELS[entry.fix]) ||
      CLOUD_UNREPORTED_FIX_LABELS[entry.fix];

    if (entry.fix === "ops-agent") {
      return (
        <a
          href={GCP_OPS_AGENT_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-indigo-600 hover:text-indigo-700"
        >
          {label}
        </a>
      );
    }

    return (
      <AppLink
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_CONNECT] as Route,
        )}
        className="font-medium text-indigo-600 hover:text-indigo-700"
      >
        <span>{label}</span>
      </AppLink>
    );
  };

  return (
    <ul className="space-y-2">
      {ordered.map((report: CloudUnreportedKeyMetricReport) => {
        return (
          <li
            key={report.key}
            data-testid={CLOUD_UNREPORTED_ROW_TEST_ID}
            className="text-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span
                className="break-all font-mono text-xs text-gray-700"
                dir="ltr"
              >
                {report.name}
              </span>
              <span className="text-xs text-gray-500">{sinceWhen(report)}</span>
            </div>
            {report.reasons.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5">
                {report.reasons.map(
                  (entry: CloudUnreportedReasonEntry, index: number) => {
                    const text: string = getCloudUnreportedReasonText(entry);
                    const fix: ReactElement | null = fixOf(entry);

                    /*
                     * The reason, then what fixes it: two things, side by
                     * side where they fit, not one sentence - and under
                     * them what the cloud answered, in its own words, where
                     * a read kept it (#10291).
                     */
                    return (
                      <li
                        key={`${entry.reason}-${index}`}
                        className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-gray-600"
                      >
                        <span>{translator.translateText(text) || text}</span>
                        {fix}
                        {entry.error ? (
                          <p
                            data-testid={CLOUD_UNREPORTED_ERROR_TEST_ID}
                            className="mt-0.5 basis-full break-words font-mono text-gray-500"
                            dir="ltr"
                          >
                            {entry.error}
                          </p>
                        ) : (
                          <></>
                        )}
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
  );
};

export default CloudUnreportedKeyMetricsList;
