import {
  IssueStatusPill,
  SeverityPill,
  getIssueStatusOptions,
} from "./DataSecurityPills";
import AppLink from "../AppLink/AppLink";
import IssueMoment from "./IssueMoment";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import ObjectID from "Common/Types/ObjectID";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One store's issues, the riskiest first. A store's Issues page shows two of
 * these: what is open now, which is what needs someone, and what was
 * accepted or resolved, kept for its history. Each issue opens on its own
 * page, where it is worked.
 */

const SEVERITY_OPTIONS: Array<DropdownOption> = [
  { label: "Critical", value: SecuritySeverity.Critical },
  { label: "High", value: SecuritySeverity.High },
  { label: "Medium", value: SecuritySeverity.Medium },
  { label: "Low", value: SecuritySeverity.Low },
];

// The statuses in the order the filter offers them.
const STATUSES: ReadonlyArray<DataSecurityIssueStatus> = [
  DataSecurityIssueStatus.Open,
  DataSecurityIssueStatus.Accepted,
  DataSecurityIssueStatus.Resolved,
  DataSecurityIssueStatus.NotAnIssue,
];

export function getDataSecurityIssueRoute(issueId: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_ISSUE_VIEW] as Route,
    { modelId: new ObjectID(issueId.toString()) },
  );
}

export interface ComponentProps {
  dataStoreId: ObjectID;
  statuses: Array<DataSecurityIssueStatus>;
  id: string;
  title: string;
  description: string;
  noItemsMessage: string;
  // Whether the rows say where each issue stands: not when all are open.
  showStatus: boolean;
  sortBy: "riskScore" | "lastDetectedAt";
}

const StoreIssuesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<DataSecurityIssue>
      modelType={DataSecurityIssue}
      id={props.id}
      userPreferencesKey={props.id}
      name={props.title}
      query={{
        dataStoreId: props.dataStoreId,
        status:
          props.statuses.length === 1
            ? props.statuses[0]
            : new Includes(props.statuses),
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      showRefreshButton={true}
      sortBy={props.sortBy}
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      noItemsMessage={props.noItemsMessage}
      searchableFields={["title"]}
      selectMoreFields={{ checkGroup: true }}
      onViewPage={(item: DataSecurityIssue): Promise<Route> => {
        return Promise.resolve(getDataSecurityIssueRoute(item._id!));
      }}
      filters={[
        {
          field: { severity: true },
          title: "Severity",
          type: FieldType.Dropdown,
          filterDropdownOptions: SEVERITY_OPTIONS,
        },
        ...(props.showStatus
          ? [
              {
                field: { status: true },
                title: "Status",
                type: FieldType.Dropdown,
                filterDropdownOptions: getIssueStatusOptions(
                  translator,
                  STATUSES.filter(
                    (status: DataSecurityIssueStatus): boolean => {
                      return props.statuses.includes(status);
                    },
                  ),
                ),
              },
            ]
          : []),
        {
          field: { lastDetectedAt: true },
          title: "Last Detected",
          type: FieldType.Date,
        },
      ]}
      // Severity first, then the issue, as the product's Issues list has them.
      columns={[
        {
          field: { severity: true },
          title: "Severity",
          type: FieldType.Element,
          getElement: (item: DataSecurityIssue): ReactElement => {
            return <SeverityPill severity={item.severity} />;
          },
        },
        {
          field: { title: true },
          title: "Issue",
          type: FieldType.Element,
          // A long title wraps rather than pushing the table past its card.
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-sm",
          getElement: (item: DataSecurityIssue): ReactElement => {
            return (
              <div className="min-w-0">
                <AppLink
                  to={getDataSecurityIssueRoute(item._id!)}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {translator.translateText(item.title || "") ||
                    item.title ||
                    "—"}
                </AppLink>
                {item.checkGroup ? (
                  <div className="text-xs text-gray-500">
                    {translator.translateText(item.checkGroup)}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        ...(props.showStatus
          ? [
              {
                field: { status: true },
                title: "Status",
                type: FieldType.Element,
                getElement: (item: DataSecurityIssue): ReactElement => {
                  return <IssueStatusPill status={item.status} />;
                },
              },
            ]
          : []),
        {
          field: { riskScore: true },
          title: "Risk Score",
          type: FieldType.Number,
          hideOnMobile: true,
        },
        {
          // "2 hours ago", the date under the pointer, as the Issues list writes it.
          field: { lastDetectedAt: true },
          title: "Last Detected",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityIssue): ReactElement => {
            return <IssueMoment value={item.lastDetectedAt} />;
          },
        },
      ]}
    />
  );
};

export default StoreIssuesTable;
