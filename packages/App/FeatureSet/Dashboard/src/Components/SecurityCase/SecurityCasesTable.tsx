import AppLink from "../AppLink/AppLink";
import UserElement from "../User/User";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SecurityCaseAiVerdictPill,
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
  SecurityCaseVerdictPill,
  getSecurityDetectionSourceIcon,
} from "./SecurityCasePills";
import useAiOffered from "../../Utils/UseAiOffered";
import SecurityEntityChips, {
  readSecurityEntities,
} from "./SecurityEntityChips";
import {
  getSecurityCaseAssigneePickerConfig,
  getSecurityCaseTeamPickerConfig,
} from "./SecurityCaseAssigneePicker";
import {
  SecurityCaseQueueColumn,
  SecurityCaseQueueFilter,
  SecurityCaseQueueView,
  SecurityCaseQueueViewKey,
  getSecurityCaseQueueFilters,
  getSecurityCaseQueueQuery,
  getSecurityCaseQueueStatusOptions,
  getSecurityCaseQueueView,
} from "./SecurityCaseQueueViews";
import { SecurityCaseValueLists } from "./SecurityCaseValues";
import {
  getSecurityCasePriorityOptions,
  getSecurityCaseStatusOptions,
} from "./SecurityCaseValueOptions";
import useSecurityCaseValues from "./useSecurityCaseValues";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import Label from "Common/Models/DatabaseModels/Label";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseAiVerdict from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "Common/Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import Column from "Common/UI/Components/ModelTable/Column";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  // Which of the queue's pages this list is; the open cases when not given.
  view?: SecurityCaseQueueViewKey | undefined;
}

type BulkCaseChange = "status" | "priority";

/*
 * Said after a Delete's question, in a row's dialog and a bulk one: closing
 * a case keeps it, as the case page's own Delete says.
 */
export const CLOSE_CASE_INSTEAD_OF_DELETE: string = translationKey(
  "To keep the record, close the case with a verdict instead.",
);

// What the AI read in a row is, on hover.
export const SECURITY_CASE_AI_READ_TOOLTIP: string = translationKey(
  "OneUptime AI's read of this case",
);

/*
 * Assigned to Me's way forward when it is empty: the cases nobody has
 * picked up, where its sentence says to look.
 */
export const VIEW_UNASSIGNED_CASES: string = translationKey(
  "View Unassigned Cases",
);
export const VIEW_UNASSIGNED_CASES_TEST_ID: string =
  "security-cases-view-unassigned";

// A case as its page names it: its number, then its title.
export const getSecurityCaseName: (securityCase: SecurityCase) => string = (
  securityCase: SecurityCase,
): string => {
  return `${securityCase.caseNumberWithPrefix || ""} ${
    securityCase.title || ""
  }`.trim();
};

// Where a list keeps its columns and page size: each page its own.
export function getSecurityCasesTablePreferencesKey(
  view: SecurityCaseQueueViewKey,
): string {
  // The open cases keep the key the one queue had, and the columns chosen there.
  return view === "open"
    ? "security-cases-table"
    : `security-cases-${view}-table`;
}

// A moment in the list: "9 minutes ago", the date and time on hover.
const CaseMoment: FunctionComponent<{ value: Date | undefined }> = (props: {
  value: Date | undefined;
}): ReactElement => {
  if (!props.value) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  return (
    <span
      className="text-sm text-gray-700"
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        props.value,
      )}
    >
      {OneUptimeDate.fromNow(props.value)}
    </span>
  );
};

/*
 * One page of the case queue: Open Cases, Assigned to Me, Unassigned,
 * Closed Cases or All Cases (SecurityCaseQueueViews.ts). A case is opened
 * by a detection - a rule, threat intelligence or a connected product - or
 * by a person, and is worked from these lists: each page is a question an
 * analyst asks of the queue, with the columns and filters that answer it,
 * and the bulk actions are what they do to several cases at once.
 *
 * Which cases are open, and the priorities and statuses the lists filter
 * by and set, are the project's own (Security Events > Settings): the list
 * waits for them, and says so if they cannot be read.
 */
const SecurityCasesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const view: SecurityCaseQueueView = getSecurityCaseQueueView(props.view);
  const { values, error, retry } = useSecurityCaseValues();

  if (error) {
    return (
      <Card title={view.title} description={view.description}>
        <ErrorMessage message={error} onRefreshClick={retry} />
      </Card>
    );
  }

  if (!values) {
    return (
      <Card title={view.title} description={view.description}>
        <ComponentLoader />
      </Card>
    );
  }

  return <SecurityCasesList view={view} values={values} />;
};

const SecurityCasesList: FunctionComponent<{
  view: SecurityCaseQueueView;
  values: SecurityCaseValueLists;
}> = (props: {
  view: SecurityCaseQueueView;
  values: SecurityCaseValueLists;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const view: SecurityCaseQueueView = props.view;
  const { priorities, statuses } = props.values;
  // Where a case opened here starts, and what Change Status starts on.
  const defaultPriority: SecurityCasePriority | null =
    SecurityCasePriorities.getDefaultPriority(priorities);
  const acknowledgedStatus: SecurityCaseStatus | null =
    SecurityCaseStatuses.getStatusOfStage(
      statuses,
      SecurityCaseStage.Acknowledged,
    );
  const highPriority: SecurityCasePriority | null =
    SecurityCasePriorities.getPriorityOfLevel(
      priorities,
      SecurityCasePriorityLevel.High,
    );
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [bulkChange, setBulkChange] = useState<BulkCaseChange | null>(null);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<SecurityCase> | null>(null);

  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  // Write one change to every case selected, reporting each as it goes.
  const applyToSelected: (
    actionProps: BulkActionOnClickProps<SecurityCase>,
    data: JSONObject,
  ) => Promise<void> = async (
    actionProps: BulkActionOnClickProps<SecurityCase>,
    data: JSONObject,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      actionProps;

    onBulkActionStart();

    const inProgressItems: Array<SecurityCase> = [...items];
    const successItems: Array<SecurityCase> = [];
    const failed: Array<BulkActionFailed<SecurityCase>> = [];

    for (const item of items) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        await ModelAPI.updateById<SecurityCase>({
          modelType: SecurityCase,
          id: new ObjectID(item._id!.toString()),
          data: data,
        });
        successItems.push(item);
      } catch (error) {
        failed.push({ item, failedMessage: API.getFriendlyMessage(error) });
      }

      onProgressInfo({
        totalItems: items,
        failed,
        successItems,
        inProgressItems,
      });
    }

    onBulkActionEnd();
    setRefreshToggle(Date.now().toString());
  };

  const bulkActions: Array<
    BulkActionButtonSchema<SecurityCase> | ModalTableBulkDefaultActions
  > = [
    /*
     * Not on Assigned to Me, where every case is already yours, nor on
     * Closed Cases (SecurityCaseQueueViews.ts). On Unassigned it is the way
     * to take cases on.
     */
    ...(!view.canAssignToMe
      ? []
      : [
          {
            title: "Assign to Me",
            icon: IconProp.User,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              actionProps: BulkActionOnClickProps<SecurityCase>,
            ): Promise<void> => {
              await applyToSelected(actionProps, {
                assignedToUserId: User.getUserId().toString(),
              });
            },
          },
        ]),
    {
      title: "Change Status",
      icon: IconProp.ArrowCircleRight,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: async (
        actionProps: BulkActionOnClickProps<SecurityCase>,
      ): Promise<void> => {
        setBulkActionProps(actionProps);
        setBulkChange("status");
      },
    },
    {
      title: "Change Priority",
      icon: IconProp.Signal,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: async (
        actionProps: BulkActionOnClickProps<SecurityCase>,
      ): Promise<void> => {
        setBulkActionProps(actionProps);
        setBulkChange("priority");
      },
    },
    ModalTableBulkDefaultActions.Delete,
  ];

  const closeBulkModal: () => void = (): void => {
    setBulkChange(null);
    setBulkActionProps(null);
  };

  // Every filter a case list may offer; each page offers the ones its cases answer.
  const filtersByKey: Record<SecurityCaseQueueFilter, Filter<SecurityCase>> = {
    title: {
      field: { title: true },
      title: "Title",
      type: FieldType.Text,
    },
    priority: {
      field: { securityCasePriorityId: true },
      title: "Priority",
      type: FieldType.Dropdown,
      filterDropdownOptions: getSecurityCasePriorityOptions(priorities, {
        forFilter: true,
      }),
    },
    status: {
      field: { securityCaseStatusId: true },
      title: "Status",
      type: FieldType.Dropdown,
      filterDropdownOptions: getSecurityCaseStatusOptions(
        getSecurityCaseQueueStatusOptions(view.key, statuses),
        { forFilter: true },
      ),
    },
    verdict: {
      field: { verdict: true },
      title: "Verdict",
      type: FieldType.Dropdown,
      filterDropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(SecurityCaseVerdict),
    },
    // What OneUptime AI's triage read the case as.
    aiVerdict: {
      field: { aiVerdict: true },
      title: "AI Verdict",
      type: FieldType.Dropdown,
      filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
        SecurityCaseAiVerdict,
      ),
    },
    labels: {
      field: { labels: { name: true, color: true } },
      title: "Labels",
      type: FieldType.EntityArray,
      filterEntityType: Label,
      filterQuery: { projectId: projectId },
      filterDropdownField: { label: "name", value: "_id" },
    },
    opened: {
      field: { createdAt: true },
      title: "Opened",
      type: FieldType.Date,
    },
    closed: {
      field: { closedAt: true },
      title: "Closed",
      type: FieldType.Date,
    },
  };

  // Every column a case list may draw; each page draws the ones its cases are read by.
  const columnsByKey: Record<SecurityCaseQueueColumn, Column<SecurityCase>> = {
    case: {
      /*
       * What the case is, what raised it and who or what it is about,
       * in one column that wraps: the title over at most two lines,
       * then its source and the first entities it names. The other
       * columns are short values, so the queue fits beside the side
       * menu.
       */
      field: { title: true, entities: true },
      title: "Case",
      type: FieldType.Element,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-xl",
      getElement: (item: SecurityCase): ReactElement => {
        const detections: number = item.detectionCount || 0;
        const entities: Array<SecurityEntity> = readSecurityEntities(
          item.entities,
        );

        return (
          /*
           * One grid track that may shrink to nothing (grid-cols-1 is
           * minmax(0, 1fr)), never under 14rem: what the cell holds
           * never widens the column, so the queue keeps fitting beside
           * the side menu with each row's ⋯ menu. An entity chip
           * longer than the column truncates (its tooltip has the
           * whole value), and a long word in the title breaks.
           */
          <div className="grid min-w-[14rem] grid-cols-1">
            <AppLink
              className="group block min-w-0"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
                { modelId: new ObjectID(item._id!.toString()) },
              )}
            >
              <span className="line-clamp-2 break-words font-medium text-gray-900 group-hover:underline">
                <span className="mr-1.5 font-mono text-xs text-gray-500">
                  {item.caseNumberWithPrefix || ""}
                </span>
                {item.title || ""}
              </span>
            </AppLink>
            {/*
              Where the case came from, how many detections it holds and
              OneUptime AI's read of it, on one line while they fit; the
              read wraps under them, on the cell's edge, when they do not.
            */}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
              <Icon
                icon={getSecurityDetectionSourceIcon(item.source)}
                className="h-3 w-3 text-gray-400"
              />
              <span>
                {item.source ? translator.translateText(item.source) : ""}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {translator.translatePlural(
                  {
                    one: "{{count}} detection",
                    other: "{{count}} detections",
                  },
                  detections,
                )}
              </span>
              {/*
                What OneUptime AI's triage read the case as, where the
                queue is scanned: the likely malicious stand out. Not
                drawn with the project's AI off.
              */}
              {isAiOffered && item.aiVerdict ? (
                <span
                  className="inline-flex"
                  data-testid="security-case-row-ai-verdict"
                >
                  <SecurityCaseAiVerdictPill
                    value={item.aiVerdict}
                    size={PillSize.Small}
                    tooltip={
                      translator.translateText(SECURITY_CASE_AI_READ_TOOLTIP) ||
                      undefined
                    }
                  />
                </span>
              ) : (
                <></>
              )}
            </div>
            {entities.length > 0 ? (
              <div className="mt-1.5">
                <SecurityEntityChips entities={entities} limit={2} />
              </div>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    /*
     * The column ids stay "priority" and "status", as they were when these
     * were text on the case, so each person's column layout still applies.
     */
    priority: {
      id: "priority",
      field: { securityCasePriority: { name: true, color: true } },
      title: "Priority",
      type: FieldType.Element,
      getElement: (item: SecurityCase): ReactElement => {
        return <SecurityCasePriorityPill value={item.securityCasePriority} />;
      },
    },
    status: {
      id: "status",
      field: { securityCaseStatus: { name: true, color: true } },
      title: "Status",
      type: FieldType.Element,
      getElement: (item: SecurityCase): ReactElement => {
        return <SecurityCaseStatusPill value={item.securityCaseStatus} />;
      },
    },
    verdict: {
      field: { verdict: true },
      title: "Verdict",
      type: FieldType.Element,
      getElement: (item: SecurityCase): ReactElement => {
        return <SecurityCaseVerdictPill value={item.verdict} />;
      },
    },
    assignee: {
      field: {
        assignedToUser: {
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "Assignee",
      type: FieldType.Element,
      hideOnMobile: true,
      getElement: (item: SecurityCase): ReactElement => {
        if (item.assignedToUser) {
          return <UserElement user={item.assignedToUser} hideEmail={true} />;
        }

        if (item.assignedToTeam?.name) {
          return (
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <Icon
                icon={IconProp.UserGroup}
                className="h-4 w-4 text-gray-400"
              />
              {item.assignedToTeam.name}
            </span>
          );
        }

        return (
          <span className="text-sm text-gray-400">
            {translator.translateText("Unassigned")}
          </span>
        );
      },
    },
    // The team a case was handed to, as the case's own page shows it.
    team: {
      field: { assignedToTeam: { name: true } },
      title: "Team",
      type: FieldType.Element,
      hideOnMobile: true,
      getElement: (item: SecurityCase): ReactElement => {
        if (!item.assignedToTeam?.name) {
          return <span className="text-sm text-gray-400">-</span>;
        }

        return (
          <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <Icon icon={IconProp.UserGroup} className="h-4 w-4 text-gray-400" />
            {item.assignedToTeam.name}
          </span>
        );
      },
    },
    labels: {
      field: { labels: { name: true, color: true } },
      title: "Labels",
      type: FieldType.EntityArray,
      hideOnMobile: true,
      getElement: (item: SecurityCase): ReactElement => {
        return <LabelsElement labels={item.labels || []} />;
      },
    },
    lastDetection: {
      field: { lastDetectedAt: true },
      title: "Last Detection",
      type: FieldType.Element,
      hideOnMobile: true,
      getElement: (item: SecurityCase): ReactElement => {
        return <CaseMoment value={item.lastDetectedAt} />;
      },
    },
    closed: {
      field: { closedAt: true },
      title: "Closed",
      type: FieldType.Element,
      hideOnMobile: true,
      getElement: (item: SecurityCase): ReactElement => {
        return <CaseMoment value={item.closedAt} />;
      },
    },
  };

  const columns: Array<Column<SecurityCase>> = view.columns.map(
    (key: SecurityCaseQueueColumn): Column<SecurityCase> => {
      return view.hiddenColumns.includes(key)
        ? { ...columnsByKey[key], isHiddenByDefault: true }
        : columnsByKey[key];
    },
  );

  const filters: Array<Filter<SecurityCase>> = getSecurityCaseQueueFilters(
    view,
    isAiOffered,
  ).map((key: SecurityCaseQueueFilter): Filter<SecurityCase> => {
    return filtersByKey[key];
  });

  /*
   * What an empty page says. Open Cases and Unassigned empty is good news,
   * drawn as Active Incidents is; Assigned to Me points at Unassigned,
   * where cases are picked up.
   */
  const emptyState: EmptyStateOptions = {
    isAllClear: view.isEmptyGoodNews,
    ...(view.key === "mine"
      ? {
          actions: [
            {
              title: VIEW_UNASSIGNED_CASES,
              icon: IconProp.Inbox,
              dataTestId: VIEW_UNASSIGNED_CASES_TEST_ID,
              onClick: (): void => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SECURITY_CASES_UNASSIGNED] as Route,
                  ),
                );
              },
            },
          ],
        }
      : {}),
  };

  return (
    <>
      <ModelTable<SecurityCase>
        /*
         * One table per page: going from one of the queue's pages to another
         * starts the list afresh (its columns, filters and page), rather than
         * carrying the last page's into the next.
         */
        key={view.key}
        modelType={SecurityCase}
        id="security-cases-table"
        name="Security Events > Cases"
        userPreferencesKey={getSecurityCasesTablePreferencesKey(view.key)}
        query={{
          projectId: projectId,
          ...getSecurityCaseQueueQuery(view.key, User.getUserId(), statuses),
        }}
        refreshToggle={refreshToggle}
        /*
         * Delete in each case's ⋯ menu and in Bulk Actions - one switch for
         * both. Its dialogs name the case as its page does, say what goes
         * with it (DeleteConsequences) and that a verdict keeps the record.
         */
        isDeleteable={true}
        getItemName={getSecurityCaseName}
        deleteConfirmationWarning={CLOSE_CASE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={view.canOpenCase}
        isViewable={true}
        viewButtonText="View"
        createVerb="Open"
        createEditModalWidth={ModalWidth.Large}
        sortBy={view.sortBy}
        sortOrder={SortOrder.Descending}
        bulkActions={{ buttons: bulkActions }}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SECURITY_CASES] as Route,
        )}
        /*
         * No row menu with the record's ID: each row names its case by number,
         * and the case's page has the ID line. The queue keeps its width for
         * the case itself.
         */
        cardProps={{
          title: view.title,
          description: view.description,
        }}
        noItemsMessage={view.emptyMessage}
        emptyState={emptyState}
        createInitialValues={
          (defaultPriority?.id
            ? { securityCasePriorityId: defaultPriority.id.toString() }
            : {}) as unknown as FormValues<SecurityCase>
        }
        formSteps={[
          { title: "Case", id: "case" },
          { title: "Assignment", id: "assignment" },
        ]}
        formFields={[
          {
            field: { title: true },
            stepId: "case",
            title: "Title",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Suspicious sign-ins for alice@example.com",
          },
          {
            field: { description: true },
            stepId: "case",
            title: "Description",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            description: "What prompted this case, and what to look at first.",
          },
          {
            field: { securityCasePriorityId: true },
            stepId: "case",
            title: "Priority",
            description: "How urgent the case is.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: getSecurityCasePriorityOptions(priorities),
          },
          {
            field: { assignedToUserId: true },
            stepId: "assignment",
            title: "Assign To",
            fieldType: FormFieldSchemaType.PeoplePicker,
            required: false,
            description: "Optional. The person working the case.",
            peoplePicker: getSecurityCaseAssigneePickerConfig(),
          },
          {
            field: { assignedToTeamId: true },
            stepId: "assignment",
            title: "Team",
            fieldType: FormFieldSchemaType.PeoplePicker,
            required: false,
            description: "Optional. The team the case belongs to.",
            peoplePicker: getSecurityCaseTeamPickerConfig(),
          },
          {
            field: { labels: true },
            stepId: "assignment",
            title: "Labels",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: false,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        showRefreshButton={true}
        searchableFields={["title", "caseNumberWithPrefix"]}
        selectMoreFields={{
          caseNumberWithPrefix: true,
          source: true,
          detectionCount: true,
          aiVerdict: true,
          assignedToTeam: { name: true, _id: true },
        }}
        filters={filters}
        columns={columns}
      />

      {bulkChange && bulkActionProps ? (
        <BasicFormModal<JSONObject>
          title={
            bulkChange === "status"
              ? "Change Status of Selected Cases"
              : "Change Priority of Selected Cases"
          }
          description={
            bulkChange === "status"
              ? "Every selected case moves to this status. Closing asks for a verdict, which is kept on each case."
              : "Every selected case gets this priority."
          }
          submitButtonText={
            bulkChange === "status" ? "Change Status" : "Change Priority"
          }
          onClose={closeBulkModal}
          formProps={{
            name: "security-case-bulk-change",
            initialValues:
              bulkChange === "status"
                ? acknowledgedStatus?.id
                  ? {
                      securityCaseStatusId: acknowledgedStatus.id.toString(),
                    }
                  : {}
                : highPriority?.id
                  ? { securityCasePriorityId: highPriority.id.toString() }
                  : {},
            fields:
              bulkChange === "status"
                ? [
                    {
                      field: { securityCaseStatusId: true },
                      title: "Status",
                      fieldType: FormFieldSchemaType.Dropdown,
                      required: true,
                      dropdownOptions: getSecurityCaseStatusOptions(statuses),
                    },
                    {
                      field: { verdict: true },
                      title: "Verdict",
                      fieldType: FormFieldSchemaType.Dropdown,
                      required: true,
                      description:
                        "What the cases turned out to be. Kept for the overview's verdict counts.",
                      dropdownOptions:
                        DropdownUtil.getDropdownOptionsFromEnum(
                          SecurityCaseVerdict,
                        ),
                      // A status that closes a case takes a verdict.
                      showIf: (formValues: FormValues<JSONObject>): boolean => {
                        return SecurityCaseStatuses.isClosed(
                          statuses,
                          formValues["securityCaseStatusId"] as string,
                        );
                      },
                    },
                  ]
                : [
                    {
                      field: { securityCasePriorityId: true },
                      title: "Priority",
                      fieldType: FormFieldSchemaType.Dropdown,
                      required: true,
                      dropdownOptions:
                        getSecurityCasePriorityOptions(priorities),
                    },
                  ],
          }}
          onSubmit={async (formValues: FormValues<JSONObject>) => {
            const actionProps: BulkActionOnClickProps<SecurityCase> =
              bulkActionProps;
            const statusId: string =
              (formValues["securityCaseStatusId"] as string) || "";
            const data: JSONObject =
              bulkChange === "status"
                ? {
                    securityCaseStatusId: statusId,
                    ...(SecurityCaseStatuses.isClosed(statuses, statusId)
                      ? {
                          verdict:
                            (formValues["verdict"] as string) ||
                            SecurityCaseVerdict.Undetermined,
                        }
                      : {}),
                  }
                : {
                    securityCasePriorityId: formValues[
                      "securityCasePriorityId"
                    ] as string,
                  };

            closeBulkModal();
            await applyToSelected(actionProps, data);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SecurityCasesTable;
