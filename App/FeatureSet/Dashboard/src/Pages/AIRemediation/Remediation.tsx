import AIPlanGate from "../../Components/AI/AIPlanGate";
import {
  getRemediationActionTypeElement,
  getRemediationStatusElement,
} from "../../Components/AI/RemediationActions";
import AppLink from "../../Components/AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import AIRemediationAction from "Common/Models/DatabaseModels/AIRemediationAction";
import AIRemediationActionStatus from "Common/Types/AI/AIRemediationActionStatus";
import AIRemediationActionType from "Common/Types/AI/AIRemediationActionType";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const ALL_FILTER_VALUE: string = "All";

/*
 * Proposed first — it is the attention state (waiting on a human decision)
 * and the page's default filter. "All" last as the escape hatch.
 */
const STATUS_FILTER_OPTIONS: Array<FilterButtonOption> = [
  ...Object.values(AIRemediationActionStatus).map(
    (status: AIRemediationActionStatus) => {
      return {
        label: status,
        value: status as string,
      };
    },
  ),
  { label: "All", value: ALL_FILTER_VALUE },
];

/*
 * The remediation inbox: every AI-proposed remediation action in the
 * project, defaulting to the ones waiting on a decision. Approve/reject
 * happens on the incident or alert page where the analysis and its evidence
 * live — this page is the cross-subject audit view, so each row links to
 * its subject.
 */
const AIRemediationPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [statusFilter, setStatusFilter] = useState<string>(
    AIRemediationActionStatus.Proposed,
  );

  const query: Query<AIRemediationAction> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (statusFilter !== ALL_FILTER_VALUE) {
    (query as Record<string, unknown>)["status"] = statusFilter;
  }

  return (
    <Fragment>
      <div className="space-y-4">
        <AIPlanGate />

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <p className="max-w-2xl text-sm text-gray-500">
            Remediation actions OneUptime AI proposed from completed
            investigations. Nothing here executes without the policy gate —
            approve or reject each proposal on its incident or alert page, where
            the analysis lives.
          </p>
          <FilterButtons
            className="flex-wrap"
            options={STATUS_FILTER_OPTIONS}
            selectedValue={statusFilter}
            onSelect={(value: string) => {
              setStatusFilter(value);
            }}
          />
        </div>

        <ModelTable<AIRemediationAction>
          modelType={AIRemediationAction}
          id="ai-remediation-actions-table"
          userPreferencesKey="ai-remediation-actions-table"
          name="AI Remediation Actions"
          query={query}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          showRefreshButton={true}
          sortBy="createdAt"
          sortOrder={SortOrder.Descending}
          cardProps={{
            title: "Remediation Actions",
            description:
              "AI-proposed runbook starts and drafted commands, with their approval and execution audit trail.",
          }}
          noItemsMessage={
            "No remediation actions match this filter. When AI Remediation is enabled, proposals appear here after each confident investigation."
          }
          selectMoreFields={{
            incidentId: true,
            alertId: true,
          }}
          filters={[
            {
              field: { title: true },
              title: "Title",
              type: FieldType.Text,
            },
            {
              field: { actionType: true },
              title: "Action Type",
              type: FieldType.Dropdown,
              filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
                AIRemediationActionType,
              ),
            },
            {
              field: { createdAt: true },
              title: "Proposed At",
              type: FieldType.Date,
            },
          ]}
          columns={[
            {
              field: { title: true },
              title: "Title",
              type: FieldType.Text,
            },
            {
              field: { actionType: true },
              title: "Action Type",
              type: FieldType.Element,
              getElement: (item: AIRemediationAction): ReactElement => {
                return getRemediationActionTypeElement(item.actionType);
              },
            },
            {
              field: { _id: true },
              title: "Subject",
              type: FieldType.Element,
              getElement: (item: AIRemediationAction): ReactElement => {
                if (item.incidentId) {
                  return (
                    <AppLink
                      className="font-medium text-indigo-600 hover:underline"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW] as Route,
                        {
                          modelId: new ObjectID(item.incidentId.toString()),
                        },
                      )}
                    >
                      View Incident
                    </AppLink>
                  );
                }
                if (item.alertId) {
                  return (
                    <AppLink
                      className="font-medium text-indigo-600 hover:underline"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ALERT_VIEW] as Route,
                        {
                          modelId: new ObjectID(item.alertId.toString()),
                        },
                      )}
                    >
                      View Alert
                    </AppLink>
                  );
                }
                return <span>-</span>;
              },
            },
            {
              field: { status: true },
              title: "Status",
              type: FieldType.Element,
              getElement: (item: AIRemediationAction): ReactElement => {
                return getRemediationStatusElement(item.status);
              },
            },
            {
              field: { createdAt: true },
              title: "Proposed At",
              type: FieldType.DateTime,
            },
          ]}
        />
      </div>
    </Fragment>
  );
};

export default AIRemediationPage;
