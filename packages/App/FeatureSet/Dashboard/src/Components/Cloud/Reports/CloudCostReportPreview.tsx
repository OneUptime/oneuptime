import { CloudCostReportContent } from "Common/Types/Cloud/CloudCostReport";
import {
  CloudCostReportStat,
  CloudCostReportText,
  CloudCostReportTextRow,
  CloudCostReportTextSection,
  writeCloudCostReport,
} from "Common/Types/Cloud/CloudCostReportWords";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * A COST REPORT AS ITS READER GETS IT (#11009): the email's own layout -
 * what it covers and when, the total and its change, the budget, savings
 * and commitments strip, then each list - written in the person's language
 * by the code the email is written with (CloudCostReportWords), so the
 * preview is the email.
 */

export interface ComponentProps {
  content: CloudCostReportContent;
}

function toneClass(row: CloudCostReportTextRow): string {
  if (row.tone === "up") {
    return "text-amber-700";
  }

  if (row.tone === "down") {
    return "text-emerald-700";
  }

  return "text-gray-500";
}

const CloudCostReportPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const text: CloudCostReportText = useMemo((): CloudCostReportText => {
    return writeCloudCostReport({ content: props.content, translator });
  }, [props.content, translator]);

  return (
    <div className="space-y-5" data-testid="cloud-cost-report-preview">
      <div>
        <bdi className="block break-words text-lg font-semibold text-gray-900">
          {text.title}
        </bdi>
        <p
          className="mt-1 text-sm text-gray-600"
          data-testid="cloud-cost-report-preview-lead"
        >
          {text.lead}
        </p>
      </div>
      <div
        className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-5 text-center"
        data-testid="cloud-cost-report-preview-total"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {text.totalLabel}
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-gray-900">
          {text.total}
        </p>
        {text.change ? (
          <p
            className={`mt-2 text-sm font-medium ${
              text.changeTone === "up"
                ? "text-amber-700"
                : text.changeTone === "down"
                  ? "text-emerald-700"
                  : "text-gray-600"
            }`}
          >
            {text.change}
          </p>
        ) : (
          <></>
        )}
        <p className="mt-1 text-xs text-gray-500">{text.previous}</p>
      </div>
      {text.stats.length > 0 ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          data-testid="cloud-cost-report-preview-stats"
        >
          {text.stats.map(
            (stat: CloudCostReportStat, index: number): ReactElement => {
              return (
                <div
                  key={index}
                  className="rounded-lg border border-gray-200 px-3 py-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
                    {stat.value}
                  </p>
                  {stat.hint ? (
                    <p className="mt-0.5 text-xs text-gray-500">{stat.hint}</p>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          )}
        </div>
      ) : (
        <></>
      )}
      {text.sections.map(
        (section: CloudCostReportTextSection, index: number): ReactElement => {
          return (
            <div key={index} data-testid="cloud-cost-report-preview-section">
              <h3 className="text-sm font-semibold text-gray-900">
                {section.title}
              </h3>
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {section.rows.map(
                  (row: CloudCostReportTextRow, rowIndex: number) => {
                    return (
                      <li
                        key={rowIndex}
                        className="flex items-start justify-between gap-3 px-3 py-2"
                      >
                        <bdi className="min-w-0 break-words text-sm text-gray-900">
                          {row.name}
                        </bdi>
                        <div className="shrink-0 text-end">
                          <div className="text-sm font-medium tabular-nums text-gray-900">
                            {row.value}
                          </div>
                          {row.hint ? (
                            <bdi
                              className={`block text-xs tabular-nums ${toneClass(row)}`}
                            >
                              {row.hint}
                            </bdi>
                          ) : (
                            <></>
                          )}
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          );
        },
      )}
      <div className="space-y-1">
        {text.notes.map((note: string, index: number): ReactElement => {
          return (
            <p key={index} className="text-xs text-gray-500">
              {note}
            </p>
          );
        })}
      </div>
    </div>
  );
};

export default CloudCostReportPreview;
