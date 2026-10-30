import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import {
  IssueStatusPill,
  SeverityPill,
  getIssueStatusOptions,
} from "../../Components/DataSecurity/DataSecurityPills";
import {
  ISSUE_DELETE_WARNING,
  getIssueName,
} from "../../Components/DataSecurity/IssueChanges";
import {
  DataTypeNamer,
  IssueDataTypeChips,
  readDataTypeIds,
  useDataTypeNamer,
} from "../../Components/DataSecurity/IssueDataTypes";
import useIssueListActions, {
  IssueListActions,
} from "../../Components/DataSecurity/IssueListActions";
import {
  DATA_SECURITY_ISSUES_TABLE_ID,
  getIssueViewRoute,
  getStoreViewRoute,
} from "../../Components/DataSecurity/IssueListRoute";
import IssueMoment from "../../Components/DataSecurity/IssueMoment";
import UserElement from "../../Components/User/User";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import {
  ALL_DATA_SECURITY_CHECK_GROUPS,
  DATA_SECURITY_CHECKS,
  DataSecurityCheckGroup,
  DataSecurityCheckInfo,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus, {
  ALL_DATA_SECURITY_ISSUE_STATUSES,
} from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import { SEVERITIES_MOST_SEVERE_FIRST } from "Common/Types/DataSecurity/DataSecurityRisk";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

// The line under an issue's title: its check's group, and when it was found.
const FIRST_DETECTED: string = translationKey("First detected {{time}}");

const UNASSIGNED: string = translationKey("Unassigned");

const severityOptions: Array<DropdownOption> = SEVERITIES_MOST_SEVERE_FIRST.map(
  (severity: SecuritySeverity): DropdownOption => {
    return { value: severity, label: severity };
  },
);

const groupOptions: Array<DropdownOption> = ALL_DATA_SECURITY_CHECK_GROUPS.map(
  (group: DataSecurityCheckGroup): DropdownOption => {
    return { value: group, label: group };
  },
);

const checkOptions: Array<DropdownOption> = DATA_SECURITY_CHECKS.map(
  (check: DataSecurityCheckInfo): DropdownOption => {
    return { value: check.id, label: check.title };
  },
);

/*
 * Everything wrong with the project's data stores, riskiest first: how bad
 * it is, what is wrong, on which store, and its risk score - what fits a
 * laptop's card beside the side menu. The data that makes it matter, who is
 * on it and where it stands are a click away in Columns. It opens on the
 * open issues; the Status filter shows the accepted, resolved and dismissed
 * ones, each saying so beside its title.
 *
 * Each row's ⋯ menu and Bulk Actions work the issues - Mark Resolved,
 * Accept Risk, Not an Issue (IssueListActions) - and the list shows the
 * change at once, the side menu's open count with it.
 */
const DataSecurityIssuesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const namer: DataTypeNamer = useDataTypeNamer();
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const listActions: IssueListActions = useIssueListActions({
    onChanged: (): void => {
      setRefreshCount((count: number): number => {
        return count + 1;
      });
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
    },
  });

  const bulkActions: Array<
    BulkActionButtonSchema<DataSecurityIssue> | ModalTableBulkDefaultActions
  > = [...listActions.bulkActions, ModalTableBulkDefaultActions.Delete];

  return (
    <>
      <ModelTable<DataSecurityIssue>
        modelType={DataSecurityIssue}
        id="data-security-issues-table"
        name="Data Security > Issues"
        userPreferencesKey={DATA_SECURITY_ISSUES_TABLE_ID}
        query={projectId ? { projectId: projectId } : {}}
        // The open issues first; the Status filter shows the rest.
        initialFilterData={
          {
            status: [DataSecurityIssueStatus.Open],
          } as unknown as FilterData<DataSecurityIssue>
        }
        refreshToggle={refreshCount > 0 ? String(refreshCount) : ""}
        isDeleteable={true}
        deleteConfirmationWarning={ISSUE_DELETE_WARNING}
        getItemName={(issue: DataSecurityIssue): string => {
          return getIssueName(issue, translator);
        }}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        viewButtonText="View"
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DATA_SECURITY_ISSUES] as Route,
        )}
        sortBy="riskScore"
        sortOrder={SortOrder.Descending}
        bulkActions={{ buttons: bulkActions }}
        // Before the table's own Delete, which stays last.
        actionButtons={listActions.rowActions}
        cardProps={{
          title: "Issues",
          description:
            "What is wrong with your data stores, riskiest first. Open one to see why it matters and how to fix it.",
        }}
        noItemsMessage="No issues. Every check passes on the stores Data Security reads."
        showRefreshButton={true}
        searchableFields={["title"]}
        // What a row's moves read: where it stands, and its acceptance.
        selectMoreFields={{
          status: true,
          checkId: true,
          dataStoreId: true,
          acceptedReason: true,
          acceptedUntil: true,
          firstDetectedAt: true,
        }}
        filters={[
          {
            field: { severity: true },
            title: "Severity",
            type: FieldType.Dropdown,
            filterDropdownOptions: severityOptions,
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Dropdown,
            filterDropdownOptions: getIssueStatusOptions(
              translator,
              ALL_DATA_SECURITY_ISSUE_STATUSES,
            ),
          },
          {
            field: { checkGroup: true },
            title: "Group",
            type: FieldType.Dropdown,
            filterDropdownOptions: groupOptions,
          },
          {
            field: { dataStoreId: true },
            title: "Data Store",
            type: FieldType.Entity,
            filterEntityType: DataStore,
            filterQuery: projectId ? { projectId: projectId } : {},
            filterDropdownField: { label: "name", value: "_id" },
          },
          {
            field: { checkId: true },
            title: "Check",
            type: FieldType.Dropdown,
            filterDropdownOptions: checkOptions,
            isAdvancedFilter: true,
          },
        ]}
        columns={[
          {
            field: { severity: true },
            title: "Severity",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: DataSecurityIssue): ReactElement => {
              return <SeverityPill severity={item.severity} />;
            },
          },
          {
            field: { title: true },
            title: "Issue",
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-md",
            getElement: (item: DataSecurityIssue): ReactElement => {
              const id: string = item._id?.toString() || "";

              return (
                <div className="grid min-w-[13rem] grid-cols-1">
                  <AppLink
                    className="group block min-w-0"
                    to={getIssueViewRoute(id)}
                  >
                    <span className="line-clamp-2 break-words font-medium text-gray-900 group-hover:underline">
                      <IsolatedText
                        text={translator.translateText(item.title) || ""}
                      />
                    </span>
                  </AppLink>
                  <div className="mt-0.5 text-xs leading-5 text-gray-500">
                    {/*
                     * Where it stands, when that is not Open: the list
                     * opens on the open issues, so its Status column is
                     * left out until someone adds it, and an accepted or
                     * resolved one a filter brings in still says so.
                     */}
                    {item.status &&
                    item.status !== DataSecurityIssueStatus.Open ? (
                      <span className="me-1.5 inline-flex align-middle">
                        <IssueStatusPill status={item.status} />
                      </span>
                    ) : (
                      <></>
                    )}
                    {item.checkGroup ? (
                      <span className="me-1.5 inline-flex items-center gap-1.5">
                        <span>
                          {translator.translateText(item.checkGroup) ||
                            item.checkGroup}
                        </span>
                        {item.firstDetectedAt ? (
                          <span aria-hidden="true">·</span>
                        ) : (
                          <></>
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                    {item.firstDetectedAt ? (
                      <span
                        title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          item.firstDetectedAt,
                        )}
                      >
                        {translator.translateTemplate(FIRST_DETECTED, {
                          time: OneUptimeDate.fromNow(item.firstDetectedAt),
                        })}
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            field: { dataStore: { name: true, kind: true } },
            title: "Data Store",
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getExportValue: (item: DataSecurityIssue): string => {
              return item.dataStore?.name || "";
            },
            getElement: (item: DataSecurityIssue): ReactElement => {
              const storeId: string =
                item.dataStoreId?.toString() ||
                item.dataStore?._id?.toString() ||
                "";

              if (!storeId) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              return (
                <div className="min-w-0">
                  <AppLink
                    className="block min-w-0 text-sm font-medium text-gray-900 hover:underline [overflow-wrap:anywhere]"
                    to={getStoreViewRoute(storeId)}
                  >
                    <IsolatedText text={item.dataStore?.name || storeId} />
                  </AppLink>
                  {item.dataStore?.kind ? (
                    <div className="text-xs text-gray-500">
                      {translator.translateText(item.dataStore.kind) ||
                        item.dataStore.kind}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { dataTypeIds: true },
            title: "Data Types",
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            isHiddenByDefault: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getExportValue: (item: DataSecurityIssue): string => {
              return readDataTypeIds(item.dataTypeIds)
                .map((dataTypeId: string): string => {
                  return namer(dataTypeId);
                })
                .join("; ");
            },
            getElement: (item: DataSecurityIssue): ReactElement => {
              return (
                <IssueDataTypeChips
                  dataTypeIds={readDataTypeIds(item.dataTypeIds)}
                  namer={namer}
                  limit={2}
                />
              );
            },
          },
          {
            field: {
              assignedToUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
              assignedToTeam: { name: true },
            },
            title: "Assignee",
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getExportValue: (item: DataSecurityIssue): string => {
              return (
                item.assignedToUser?.name?.toString() ||
                item.assignedToUser?.email?.toString() ||
                item.assignedToTeam?.name ||
                ""
              );
            },
            getElement: (item: DataSecurityIssue): ReactElement => {
              if (item.assignedToUser) {
                return (
                  <UserElement user={item.assignedToUser} hideEmail={true} />
                );
              }

              if (item.assignedToTeam?.name) {
                return (
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-gray-700">
                    <Icon
                      icon={IconProp.UserGroup}
                      className="h-4 w-4 shrink-0 text-gray-400"
                    />
                    <IsolatedText
                      text={item.assignedToTeam.name}
                      className="min-w-0 truncate"
                    />
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-400">
                  {translator.translateText(UNASSIGNED)}
                </span>
              );
            },
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Element,
            disableSort: true,
            isHiddenByDefault: true,
            getElement: (item: DataSecurityIssue): ReactElement => {
              return <IssueStatusPill status={item.status} />;
            },
          },
          {
            field: { firstDetectedAt: true },
            title: "First Detected",
            type: FieldType.Element,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getElement: (item: DataSecurityIssue): ReactElement => {
              return <IssueMoment value={item.firstDetectedAt} />;
            },
          },
          {
            field: { riskScore: true },
            title: "Risk Score",
            type: FieldType.Element,
            headerTooltip: translationKey(
              "From 0 to 100: severity, exposure, records held, recent activity and production.",
            ),
            getElement: (item: DataSecurityIssue): ReactElement => {
              return (
                <span className="text-sm font-semibold tabular-nums text-gray-900">
                  {translator.formatNumber(item.riskScore || 0)}
                </span>
              );
            },
          },
        ]}
      />

      {/* Accept Risk's dialog, for a row or the issues selected. */}
      {listActions.modals}
    </>
  );
};

export default DataSecurityIssuesPage;
