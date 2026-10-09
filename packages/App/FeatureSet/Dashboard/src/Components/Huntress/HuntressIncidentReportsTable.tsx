import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  HUNTRESS_OUTCOME_COLORS,
  HUNTRESS_OUTCOME_LABELS,
  HUNTRESS_SEVERITY_COLORS,
  HUNTRESS_SEVERITY_LABELS,
  HUNTRESS_STATUS_LABELS,
  getHuntressReportByline,
  getHuntressReportHeadline,
  getHuntressReportPortalLink,
} from "./HuntressConnectionDisplay";
import HuntressIncidentReport from "Common/Models/DatabaseModels/HuntressIncidentReport";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import HuntressIncidentReportOutcome, {
  didHuntressOutcomeOpenIncident,
} from "Common/Types/Huntress/HuntressIncidentReportOutcome";
import { isHuntressSeverity } from "Common/Types/Huntress/HuntressSeverity";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  connectionId: ObjectID;
}

/*
 * Every incident report Huntress sent to a connection, newest first, with
 * what was done with it: the incident it opened (and whether that paged),
 * or why it opened none. So "why did nobody get paged?" is answered here,
 * not in a log.
 */
const HuntressIncidentReportsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<HuntressIncidentReport>
      modelType={HuntressIncidentReport}
      id="huntress-incident-reports-table"
      name="Huntress > Incident Reports"
      userPreferencesKey="huntress-incident-reports-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      query={{
        huntressConnectionId: props.connectionId,
      }}
      sortBy="createdAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: "Incident Reports",
        description: "What Huntress sent, and what was done with each report.",
      }}
      emptyState={{
        title: "No incident reports yet",
        description:
          "Each incident report Huntress sends shows here, with the incident it opened or why it opened none.",
      }}
      showRefreshButton={true}
      selectMoreFields={{
        organizationId: true,
        organizationName: true,
        affectedName: true,
        huntressIncidentReportId: true,
        incidentId: true,
        pagedOnCall: true,
        lastEventReceivedAt: true,
      }}
      filters={[]}
      columns={[
        {
          field: {
            subject: true,
          },
          title: "Report",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          getExportValue: (item: HuntressIncidentReport): string => {
            return [
              getHuntressReportHeadline(item),
              getHuntressReportByline(item),
            ]
              .filter((part: string): boolean => {
                return Boolean(part);
              })
              .join(" - ");
          },
          getElement: (item: HuntressIncidentReport): ReactElement => {
            const portalLink: string | null = getHuntressReportPortalLink({
              organizationId: item.organizationId,
              reportId: item.huntressIncidentReportId,
            });

            const headline: string = getHuntressReportHeadline(item);
            const byline: string = getHuntressReportByline(item);

            return (
              <div className="min-w-0">
                {portalLink ? (
                  <Link
                    to={URL.fromString(portalLink)}
                    openInNewTab={true}
                    className="text-sm font-medium text-gray-900 hover:underline"
                  >
                    <span data-testid="huntress-report-headline">
                      {headline}
                    </span>
                  </Link>
                ) : (
                  <span
                    className="text-sm font-medium text-gray-900"
                    data-testid="huntress-report-headline"
                  >
                    {headline}
                  </span>
                )}
                {byline ? (
                  <p className="text-xs text-gray-500">{byline}</p>
                ) : null}
              </div>
            );
          },
        },
        {
          field: {
            severity: true,
          },
          title: "Severity",
          type: FieldType.Element,
          getExportValue: (item: HuntressIncidentReport): string => {
            return item.severity || "";
          },
          getElement: (item: HuntressIncidentReport): ReactElement => {
            if (!item.severity || !isHuntressSeverity(item.severity)) {
              return (
                <span className="text-sm text-gray-500">
                  {item.severity || "-"}
                </span>
              );
            }

            return (
              <Pill
                text={HUNTRESS_SEVERITY_LABELS[item.severity]}
                color={HUNTRESS_SEVERITY_COLORS[item.severity]}
              />
            );
          },
        },
        {
          field: {
            status: true,
          },
          title: "In Huntress",
          type: FieldType.Element,
          hideOnMobile: true,
          getExportValue: (item: HuntressIncidentReport): string => {
            return item.status || "";
          },
          getElement: (item: HuntressIncidentReport): ReactElement => {
            const label: string | undefined = item.status
              ? HUNTRESS_STATUS_LABELS[item.status]
              : undefined;

            return (
              <span className="text-sm text-gray-700">
                {label ? translator.translateText(label) : item.status || "-"}
              </span>
            );
          },
        },
        {
          field: {
            outcome: true,
          },
          title: "Outcome",
          type: FieldType.Element,
          getExportValue: (item: HuntressIncidentReport): string => {
            return item.outcome
              ? HUNTRESS_OUTCOME_LABELS[item.outcome] || item.outcome
              : "";
          },
          getElement: (item: HuntressIncidentReport): ReactElement => {
            const outcome: HuntressIncidentReportOutcome | undefined =
              item.outcome;

            if (!outcome || !HUNTRESS_OUTCOME_LABELS[outcome]) {
              return <span className="text-sm text-gray-500">-</span>;
            }

            const opened: boolean = didHuntressOutcomeOpenIncident(outcome);

            return (
              <div className="flex flex-wrap items-center gap-2">
                <Pill
                  text={HUNTRESS_OUTCOME_LABELS[outcome]}
                  color={HUNTRESS_OUTCOME_COLORS[outcome]}
                />
                {opened && item.incidentId ? (
                  <Link
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.INCIDENT_VIEW] as Route,
                      { modelId: item.incidentId },
                    )}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    <span data-testid="huntress-report-incident-link">
                      {translator.translateText("View incident")}
                    </span>
                  </Link>
                ) : null}
                {opened && !item.incidentId ? (
                  <span className="text-xs text-gray-500">
                    {translator.translateText("Incident deleted")}
                  </span>
                ) : null}
                {opened && item.pagedOnCall ? (
                  <span className="text-xs text-gray-500">
                    {translator.translateText("Paged on-call")}
                  </span>
                ) : null}
              </div>
            );
          },
        },
        {
          field: {
            createdAt: true,
          },
          title: "Received",
          type: FieldType.DateTime,
          hideOnMobile: true,
        },
      ]}
    />
  );
};

export default HuntressIncidentReportsTable;
