import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import {
  IssueResolutionPill,
  SeverityPill,
  getIssueStatusOptions,
} from "../../Components/DataSecurity/DataSecurityPills";
import {
  RESOLUTION_FILTER_TITLE,
  getResolutionOptions,
} from "../../Components/DataSecurity/IssueResolutionCopy";
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
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import IssueGroupFixModal from "../../Components/DataSecurity/IssueGroupFixModal";
import IssueGroups from "../../Components/DataSecurity/IssueGroups";
import {
  GROUP_BY_CAUSE,
  GROUP_BY_CAUSE_TOOLTIP,
  NO_OTHER_ISSUES,
} from "../../Components/DataSecurity/IssueGroupsCopy";
import { VERDICT_TONES } from "../../Components/DataSecurity/IssueAiAnalysisCopy";
import UserElement from "../../Components/User/User";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiOffered from "../../Utils/UseAiOffered";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DataSecurityIssueGroupJSON,
  DataSecurityIssueGroupsJSON,
  isGroupByCauseOnByDefault,
} from "Common/Types/DataSecurity/DataSecurityIssueGroup";
import {
  DATA_SECURITY_AI_VERDICT_TITLES,
  DATA_SECURITY_AI_VERDICTS,
  DataSecurityAiVerdict,
  isDataSecurityAiVerdict,
} from "Common/Types/DataSecurity/DataSecurityIssueAnalysis";
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
import Pill from "Common/UI/Components/Pill/Pill";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

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

/*
 * OneUptime AI's verdicts (#10369), in the order people act on them: what
 * it judged likely by design or a wrong finding first, for a person to
 * decide.
 */
const verdictOptions: Array<DropdownOption> = [
  DataSecurityAiVerdict.LikelyByDesign,
  DataSecurityAiVerdict.LikelyWrongFinding,
  ...DATA_SECURITY_AI_VERDICTS.filter((verdict: DataSecurityAiVerdict) => {
    return (
      verdict !== DataSecurityAiVerdict.LikelyByDesign &&
      verdict !== DataSecurityAiVerdict.LikelyWrongFinding
    );
  }),
].map((verdict: DataSecurityAiVerdict): DropdownOption => {
  return { value: verdict, label: DATA_SECURITY_AI_VERDICT_TITLES[verdict] };
});

const checkOptions: Array<DropdownOption> = DATA_SECURITY_CHECKS.map(
  (check: DataSecurityCheckInfo): DropdownOption => {
    return { value: check.id, label: check.title };
  },
);

/*
 * Group by cause (#10370): the reader's own choice, kept in this browser -
 * unset, it starts on once one group holds GROUP_BY_CAUSE_DEFAULT_ON_SIZE
 * issues.
 */
const GROUP_BY_CAUSE_KEY: string = "data-security-issues-group-by-cause";

function readGroupByCauseChoice(): boolean | null {
  try {
    const value: unknown = LocalStorage.getItem(GROUP_BY_CAUSE_KEY);

    return value === true || value === "true"
      ? true
      : value === false || value === "false"
        ? false
        : null;
  } catch {
    return null;
  }
}

function keepGroupByCauseChoice(value: boolean): void {
  try {
    LocalStorage.setItem(GROUP_BY_CAUSE_KEY, value ? "true" : "false");
  } catch {
    // A browser that keeps nothing still switches: for this visit.
  }
}

// The most of the grouped issues the filters match read at once, the riskiest first.
const MAX_GROUP_MEMBERS_READ: number = 1000;

// What the groups fold under them: the issues the list's filters match, by group.
interface GroupMembersRead {
  membersByGroup: Map<string, Array<DataSecurityIssue>>;
  // Groups the project's list left out (fixed a while ago) that a filter brought in.
  moreGroups: Array<DataSecurityIssueGroupJSON>;
  cutAt?: number | undefined;
}

function hasNarrowingFilter(query: Query<DataSecurityIssue>): boolean {
  return Object.keys(query).some((key: string): boolean => {
    return key !== "projectId" && key !== "dataSecurityIssueGroupId";
  });
}

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
 *
 * While the project's AI is on, the list filters by OneUptime AI's verdict
 * (#10369), and shows it in Columns: what it judged likely by design or a
 * wrong finding is a filter away, for a person to decide.
 *
 * Group by cause (#10370) puts the issues one mistake made together above
 * the rows - "40 issues, one cause: the static-site module" - each with its
 * stores folded under it, how many are fixed and Fix the Cause; the rows
 * are then the issues in no group. It starts on once a group holds five
 * issues, and the reader's choice is kept in their browser. The filters
 * narrow both alike (onQueryChange). A reader whose read of issues is held
 * to labels gets no groups, and the list they had.
 */
const DataSecurityIssuesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const namer: DataTypeNamer = useDataTypeNamer();
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const isAiOffered: boolean = useAiOffered();

  const listActions: IssueListActions = useIssueListActions({
    onChanged: (): void => {
      setRefreshCount((count: number): number => {
        return count + 1;
      });
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
    },
  });

  /*
   * Group by cause (#10370): the project's groups of issues one mistake
   * made, for a reader of its issues across the whole project - none for
   * anyone else, whose list stays as it was.
   */
  const [groups, setGroups] = useState<DataSecurityIssueGroupsJSON | null>(
    null,
  );
  const [groupByCauseChoice, setGroupByCauseChoice] = useState<boolean | null>(
    readGroupByCauseChoice,
  );
  const [listQuery, setListQuery] = useState<Query<DataSecurityIssue> | null>(
    null,
  );
  const [members, setMembers] = useState<GroupMembersRead | null>(null);
  const [fixingGroup, setFixingGroup] =
    useState<DataSecurityIssueGroupJSON | null>(null);
  // A group a link asked for: an issue's analysis points at its group's fix.
  const linkedGroupId: string =
    Navigation.getQueryStringByName("fixGroup") ||
    Navigation.getQueryStringByName("group") ||
    "";
  const hasOpenedLinkedFix: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    DataSecurityApi.getIssueGroups()
      .then((answer: DataSecurityIssueGroupsJSON) => {
        if (isCurrent) {
          setGroups(answer);
        }
      })
      .catch(() => {
        // Groups are a way to read the list: without them it is listed flat.
        if (isCurrent) {
          setGroups({ groups: [], largestGroupSize: 0 });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [refreshCount]);

  const hasGroups: boolean = Boolean(groups && groups.groups.length > 0);
  const isGroupedByCause: boolean =
    hasGroups &&
    (Boolean(linkedGroupId) ||
      (groupByCauseChoice ??
        isGroupByCauseOnByDefault(groups?.largestGroupSize || 0)));

  // The grouped issues the list's filters match, read as the list reads its rows.
  useEffect(() => {
    if (!isGroupedByCause || !listQuery || !groups) {
      setMembers(null);
      return;
    }

    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const query: Query<DataSecurityIssue> = {
        ...listQuery,
        dataSecurityIssueGroupId: new NotNull(),
      } as Query<DataSecurityIssue>;
      const result: ListResult<DataSecurityIssue> =
        await ModelAPI.getList<DataSecurityIssue>({
          modelType: DataSecurityIssue,
          query,
          limit: MAX_GROUP_MEMBERS_READ,
          skip: 0,
          select: {
            _id: true,
            title: true,
            status: true,
            severity: true,
            riskScore: true,
            dataStoreId: true,
            dataSecurityIssueGroupId: true,
            dataStore: { name: true, kind: true },
          },
          sort: { riskScore: SortOrder.Descending },
        });
      const membersByGroup: Map<string, Array<DataSecurityIssue>> = new Map();

      for (const issue of result.data) {
        const groupId: string =
          issue.dataSecurityIssueGroupId?.toString().toLowerCase() || "";

        if (groupId) {
          membersByGroup.set(groupId, [
            ...(membersByGroup.get(groupId) || []),
            issue,
          ]);
        }
      }

      const listed: Set<string> = new Set(
        groups.groups.map((group: DataSecurityIssueGroupJSON): string => {
          return group.groupId;
        }),
      );
      const missing: Array<string> = Array.from(membersByGroup.keys()).filter(
        (groupId: string): boolean => {
          return !listed.has(groupId);
        },
      );
      const moreGroups: Array<DataSecurityIssueGroupJSON> =
        missing.length > 0
          ? (await DataSecurityApi.getIssueGroups({ groupIds: missing })).groups
          : [];

      if (isCurrent) {
        setMembers({
          membersByGroup,
          moreGroups,
          cutAt:
            result.count > result.data.length ? result.data.length : undefined,
        });
      }
    };

    read().catch(() => {
      if (isCurrent) {
        setMembers({ membersByGroup: new Map(), moreGroups: [] });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [isGroupedByCause, JSON.stringify(listQuery), groups, refreshCount]);

  // The groups drawn: each with an issue the filters match, the most open first.
  const groupsDrawn: Array<DataSecurityIssueGroupJSON> =
    isGroupedByCause && groups && members
      ? [...groups.groups, ...members.moreGroups].filter(
          (group: DataSecurityIssueGroupJSON): boolean => {
            return (members.membersByGroup.get(group.groupId) || []).length > 0;
          },
        )
      : [];

  // A link to a group's fix opens it once the group is read.
  useEffect(() => {
    const asked: string = Navigation.getQueryStringByName("fixGroup") || "";

    if (!asked || hasOpenedLinkedFix.current || !groups) {
      return;
    }

    const group: DataSecurityIssueGroupJSON | undefined = groups.groups.find(
      (candidate: DataSecurityIssueGroupJSON): boolean => {
        return candidate.groupId === asked.toLowerCase();
      },
    );

    if (group && group.openIssueCount > 0) {
      hasOpenedLinkedFix.current = true;
      setFixingGroup(group);
    }
  }, [groups]);

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
        query={
          projectId
            ? {
                projectId: projectId,
                // Grouped by cause, the rows are the issues in no group (#10370).
                ...(isGroupedByCause
                  ? { dataSecurityIssueGroupId: new IsNull() }
                  : {}),
              }
            : {}
        }
        onQueryChange={(query: Query<DataSecurityIssue>) => {
          const withoutGroup: Query<DataSecurityIssue> = { ...query };

          delete (withoutGroup as Record<string, unknown>)[
            "dataSecurityIssueGroupId"
          ];
          setListQuery(withoutGroup);
        }}
        topContent={
          groupsDrawn.length > 0 ? (
            <IssueGroups
              groups={groupsDrawn}
              membersByGroup={members?.membersByGroup || new Map()}
              isFiltered={listQuery ? hasNarrowingFilter(listQuery) : false}
              cutAt={members?.cutAt}
              focusedGroupId={linkedGroupId.toLowerCase() || undefined}
              onFix={(group: DataSecurityIssueGroupJSON) => {
                setFixingGroup(group);
              }}
            />
          ) : undefined
        }
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
          rightElement: hasGroups ? (
            <Toggle
              title={GROUP_BY_CAUSE}
              tooltip={GROUP_BY_CAUSE_TOOLTIP}
              value={isGroupedByCause}
              dataTestId="data-security-issues-group-by-cause"
              onChange={(value: boolean) => {
                keepGroupByCauseChoice(value);
                setGroupByCauseChoice(value);

                if (!value && linkedGroupId) {
                  Navigation.setQueryString({ group: null, fixGroup: null });
                }
              }}
            />
          ) : undefined,
        }}
        noItemsMessage={
          groupsDrawn.length > 0
            ? NO_OTHER_ISSUES
            : "No issues. Every check passes on the stores Data Security reads."
        }
        showRefreshButton={true}
        searchableFields={["title"]}
        // What a row's moves read: where it stands, and its acceptance.
        selectMoreFields={{
          status: true,
          // How a resolved one was resolved: fixed, or only contained (#10368).
          resolution: true,
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
              ALL_DATA_SECURITY_ISSUE_STATUSES,
            ),
          },
          {
            field: { checkGroup: true },
            title: "Group",
            type: FieldType.Dropdown,
            filterDropdownOptions: groupOptions,
          },
          /*
           * How a resolved issue was resolved (#10368): the leaks fixed at
           * the source apart from those only contained at ingest.
           */
          {
            field: { resolution: true },
            title: RESOLUTION_FILTER_TITLE,
            type: FieldType.Dropdown,
            filterDropdownOptions: getResolutionOptions(),
            isAdvancedFilter: true,
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
          ...(isAiOffered
            ? [
                {
                  field: { aiVerdict: true },
                  title: "OneUptime AI Verdict",
                  type: FieldType.Dropdown,
                  filterDropdownOptions: verdictOptions,
                },
              ]
            : []),
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
            // Each of its lines already reads its own way.
            getLineText: drawsItsOwnLines,
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
                        <IssueResolutionPill
                          status={item.status}
                          resolution={item.resolution}
                        />
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
                          <span aria-hidden="true">
                            <InlineSeparator markOnly />
                          </span>
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
                return <TableEmptyValue />;
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
                <span className="text-sm text-gray-500">
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
              return (
                <IssueResolutionPill
                  status={item.status}
                  resolution={item.resolution}
                />
              );
            },
          },
          ...(isAiOffered
            ? [
                {
                  field: { aiVerdict: true },
                  title: "OneUptime AI Verdict",
                  type: FieldType.Element,
                  disableSort: true,
                  isHiddenByDefault: true,
                  getElement: (item: DataSecurityIssue): ReactElement => {
                    return isDataSecurityAiVerdict(item.aiVerdict) ? (
                      <Pill
                        text={DATA_SECURITY_AI_VERDICT_TITLES[item.aiVerdict]}
                        tone={VERDICT_TONES[item.aiVerdict]}
                        isDotHidden={true}
                      />
                    ) : (
                      <TableEmptyValue />
                    );
                  },
                },
              ]
            : []),
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

      {/* One fix for a group of issues one mistake made (#10370). */}
      {fixingGroup ? (
        <IssueGroupFixModal
          group={fixingGroup}
          onClose={() => {
            setFixingGroup(null);
          }}
          onFixed={() => {
            setRefreshCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DataSecurityIssuesPage;
