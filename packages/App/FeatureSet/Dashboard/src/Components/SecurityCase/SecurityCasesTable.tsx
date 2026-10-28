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
  SecurityCaseQueueColumn,
  SecurityCaseQueueFilter,
  SecurityCaseQueueView,
  SecurityCaseQueueViewKey,
  SecurityCaseRowMoment,
  getSecurityCaseQueueColumns,
  getSecurityCaseQueueFilters,
  getSecurityCaseQueueQuery,
  getSecurityCaseQueueStatusOptions,
  getSecurityCaseQueueView,
  getSecurityCaseRowMoment,
  keepSecurityCaseTimeWhole,
} from "./SecurityCaseQueueViews";
import {
  SECURITY_CASE_FORM_STEPS,
  getSecurityCaseFormFields,
} from "./SecurityCaseFormFields";
import { SecurityCaseValueLists } from "./SecurityCaseValues";
import {
  getSecurityCasePriorityOptions,
  getSecurityCaseStatusOptions,
} from "./SecurityCaseValueOptions";
import useSecurityCaseListActions, {
  SecurityCaseListActions,
} from "./useSecurityCaseListActions";
import useSecurityCaseValues from "./useSecurityCaseValues";
import {
  SecurityCaseDueCell,
  SecurityCaseDueLine,
} from "./ResponseTargets/SecurityCaseTargetChip";
import { RESPONSE_TARGETS_COPY } from "./ResponseTargets/ResponseTargetsCopy";
import { projectHasTargets } from "./ResponseTargets/SecurityCaseTargetDisplay";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import Label from "Common/Models/DatabaseModels/Label";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseAiVerdict from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseVerdict from "Common/Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import Column from "Common/UI/Components/ModelTable/Column";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  // Which of the queue's pages this list is; the open cases when not given.
  view?: SecurityCaseQueueViewKey | undefined;
}

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

/*
 * The case list's create button and its dialog, worded whole in every
 * language. "Open" is not a verb the shared table words itself ("Create",
 * "Add", "Declare"...), so the button was the locale's word for the verb
 * before its word for the case: "Öffnen Sicherheitsfall" in German, open as
 * a door is, where a case is "eröffnet".
 */
export const OPEN_SECURITY_CASE: string = translationKey("Open Security Case");
export const OPEN_NEW_SECURITY_CASE: string = translationKey(
  "Open New Security Case",
);

/*
 * The line under each case's title - what raised it, its detections and
 * the time its list is sorted by - and that sentence in it.
 */
export const SECURITY_CASE_ROW_SOURCE_LINE_TEST_ID: string =
  "security-case-row-source-line";
// The case's number, before its title.
export const SECURITY_CASE_ROW_NUMBER_TEST_ID: string =
  "security-case-row-number";
export const SECURITY_CASE_ROW_DETECTIONS_TEST_ID: string =
  "security-case-row-detections";

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

// The team a case is with, in the Assignee and Team columns.
export const SECURITY_CASE_ROW_TEAM_TEST_ID: string = "security-case-row-team";

/*
 * A team's name ends in "..." where its column does, as a person's beside
 * their picture does (UserElement), and the table shows the whole of it
 * under the pointer: drawn whole, a team named "Security Operations Center
 * - Tier 2 Escalations (EMEA)" ran every list past its card at 1280, its
 * end under the sticky View and ⋯, in English as in German. The name is
 * read the way it is written (IsolatedText's reading), so on a Persian page
 * an English name is cut at its own end, not its start.
 */
const SecurityCaseTeamName: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  return (
    <span
      className="flex min-w-0 max-w-full items-center gap-1.5 text-sm text-gray-700"
      data-testid={SECURITY_CASE_ROW_TEAM_TEST_ID}
      // A table that would run past its card may narrow it (TableLayout).
      data-table-shrinks="true"
    >
      <Icon
        icon={IconProp.UserGroup}
        className="h-4 w-4 shrink-0 text-gray-400"
      />
      <IsolatedText text={props.name} className="min-w-0 truncate" />
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
 *
 * A case is worked from its row too: the row's ⋯ menu has Assign to Me,
 * Assign to Someone Else, Change Status and Change Priority beside View,
 * with Delete last, and Bulk Actions the same for the cases selected
 * (useSecurityCaseListActions) - each by the rules the case's own page
 * follows, and the list shows the change at once.
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
  /*
   * Whether the project sets response targets: then each open row says
   * when its next target is due, under its priority, and the Due column can
   * be turned on to sort by it.
   */
  const hasTargets: boolean = projectHasTargets(priorities);
  // Where a case opened here starts.
  const defaultPriority: SecurityCasePriority | null =
    SecurityCasePriorities.getDefaultPriority(priorities);
  /*
   * Read the list again: a count, never the time. Two changes in one
   * millisecond - a bulk run ending as a row's change saves - or a page whose
   * clock stands still would otherwise set the same value twice, and the
   * second change would not be read back.
   */
  const [refreshCount, setRefreshCount] = useState<number>(0);

  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  /*
   * Each case's moves: in its row's ⋯ menu and, for the cases selected, in
   * Bulk Actions. Assign to Me is a bulk action where cases are taken on -
   * not on Assigned to Me, where every case is yours already, nor on Closed
   * Cases - and Assign to Someone Else wherever cases are worked
   * (SecurityCaseQueueViews.ts). Once a case changes, the list is read
   * again - a case taken off Unassigned leaves it - and so are the side
   * menu's counts.
   */
  const listActions: SecurityCaseListActions = useSecurityCaseListActions({
    values: props.values,
    canAssignToMeInBulk: view.canAssignToMe,
    canAssignToSomeoneElseInBulk: view.canAssignToSomeoneElse,
    onChanged: (): void => {
      setRefreshCount((count: number): number => {
        return count + 1;
      });
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
    },
  });

  const bulkActions: Array<
    BulkActionButtonSchema<SecurityCase> | ModalTableBulkDefaultActions
  > = [...listActions.bulkActions, ModalTableBulkDefaultActions.Delete];

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
        /*
         * How many detections, and the time the list is sorted by: when
         * the last one fired, or when the case closed.
         */
        const moment: SecurityCaseRowMoment = getSecurityCaseRowMoment(
          view.sortBy,
          item,
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
              {/*
                The title is read the way it is written, apart from the
                page (IsolatedText): on a Persian page an English title ran
                into the number before it, "CASE-142Password spray", and
                the number belongs at the start of the line, where a
                Persian reader begins.
              */}
              <span className="line-clamp-2 break-words font-medium text-gray-900 group-hover:underline">
                <span
                  className="mr-1.5 font-mono text-xs text-gray-500"
                  data-testid={SECURITY_CASE_ROW_NUMBER_TEST_ID}
                >
                  {item.caseNumberWithPrefix || ""}
                </span>
                <IsolatedText text={item.title || ""} />
              </span>
            </AppLink>
            {/*
              Where the case came from, how many detections it holds and
              when the last fired (or when it closed): one line of text
              while it fits, which wraps between its words when it does
              not, the time kept whole. Laid out as text rather than as
              boxes, the sentence never jumps to a line of its own and
              leaves the "·" alone at the end of the one above.
            */}
            <div
              className="mt-0.5 text-xs leading-5 text-gray-500"
              data-testid={SECURITY_CASE_ROW_SOURCE_LINE_TEST_ID}
            >
              {/*
                The source, its icon and the dot after it stay together, one
                box in the line: where the line breaks after it, the dot ends
                the first line rather than starting the next.
              */}
              <span className="me-1.5 inline-flex items-center gap-1.5 align-top">
                <Icon
                  icon={getSecurityDetectionSourceIcon(item.source)}
                  className="h-3 w-3 text-gray-400"
                />
                <span>
                  {item.source ? translator.translateText(item.source) : ""}
                </span>
                <span aria-hidden="true">·</span>
              </span>
              <span
                data-testid={SECURITY_CASE_ROW_DETECTIONS_TEST_ID}
                title={
                  moment.time
                    ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        moment.time,
                      )
                    : undefined
                }
              >
                {translator.translatePlural(
                  moment.template,
                  detections,
                  moment.time
                    ? {
                        time: keepSecurityCaseTimeWhole(
                          OneUptimeDate.fromNow(moment.time),
                        ),
                      }
                    : {},
                )}
              </span>
            </div>
            {/*
              What OneUptime AI's triage read the case as, where the queue
              is scanned: the likely malicious stand out. On a line of its
              own, at the cell's edge, so it is in the same place on every
              row and in every language - at the end of the line above, it
              stood wherever that sentence happened to wrap. Not drawn with
              the project's AI off.
            */}
            {isAiOffered && item.aiVerdict ? (
              <div className="mt-1 flex">
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
              </div>
            ) : (
              <></>
            )}
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
        return (
          <div className="flex min-w-0 flex-col items-start">
            <SecurityCasePriorityPill value={item.securityCasePriority} />
            {hasTargets ? (
              <SecurityCaseDueLine
                securityCase={item}
                priorities={priorities}
              />
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    // When the next response target is due: what the open lists sort by.
    due: {
      id: "due",
      field: { nextDueAt: true },
      title: RESPONSE_TARGETS_COPY.dueColumn,
      type: FieldType.Element,
      hideOnMobile: true,
      getElement: (item: SecurityCase): ReactElement => {
        return (
          <SecurityCaseDueCell securityCase={item} priorities={priorities} />
        );
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
          return <SecurityCaseTeamName name={item.assignedToTeam.name} />;
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

        return <SecurityCaseTeamName name={item.assignedToTeam.name} />;
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

  const columns: Array<Column<SecurityCase>> = getSecurityCaseQueueColumns(
    view,
    hasTargets,
  ).map((key: SecurityCaseQueueColumn): Column<SecurityCase> => {
    return view.hiddenColumns.includes(key)
      ? { ...columnsByKey[key], isHiddenByDefault: true }
      : columnsByKey[key];
  });

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
        refreshToggle={refreshCount > 0 ? String(refreshCount) : ""}
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
        createFormTitle={OPEN_NEW_SECURITY_CASE}
        createFormSubmitButtonText={OPEN_SECURITY_CASE}
        createEditModalWidth={ModalWidth.Large}
        sortBy={view.sortBy}
        sortOrder={SortOrder.Descending}
        bulkActions={{ buttons: bulkActions }}
        // Before the table's own Delete, which stays last.
        actionButtons={listActions.rowActions}
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
        formSteps={SECURITY_CASE_FORM_STEPS}
        formFields={getSecurityCaseFormFields({
          priorityOptions: getSecurityCasePriorityOptions(priorities),
        })}
        showRefreshButton={true}
        searchableFields={["title", "caseNumberWithPrefix"]}
        /*
         * What a row's moves read of its case: where it stands, how urgent,
         * who has it and which team's queue it is in, and what Close Case
         * starts its verdict on (the case's own, else OneUptime AI's read).
         */
        selectMoreFields={{
          caseNumberWithPrefix: true,
          source: true,
          detectionCount: true,
          // The times a case's line says, its own columns hidden or shown.
          lastDetectedAt: true,
          closedAt: true,
          aiVerdict: true,
          aiTriagePromptInjectionSuspected: true,
          verdict: true,
          securityCaseStatusId: true,
          securityCasePriorityId: true,
          // What its response targets are read from (SecurityCaseTargets).
          createdAt: true,
          acknowledgedAt: true,
          containedAt: true,
          acknowledgeDueAt: true,
          containDueAt: true,
          acknowledgeMissedAt: true,
          containMissedAt: true,
          nextDueAt: true,
          assignedToUserId: true,
          assignedToTeamId: true,
          assignedToTeam: { name: true, _id: true },
        }}
        filters={filters}
        columns={columns}
      />

      {/* Assign to Someone Else, Change Status and Change Priority. */}
      {listActions.modals}
    </>
  );
};

export default SecurityCasesTable;
