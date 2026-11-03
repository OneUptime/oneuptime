import {
  ANY_SECURITY_EVENTS,
  HUNTS_TEST_IDS,
  HUNT_COLUMN_TITLE,
  HUNT_DATA_NOT_RECEIVED,
  OPEN_HUNT,
  TRY_IT,
} from "./HuntsCopy";
import { HuntLibraryView } from "./HuntLibraryModel";
import { HUNT_SEARCH_ONE_LINE_CLASS_NAME } from "./HuntCells";
import { getHuntViewRoute } from "./HuntsModel";
import {
  ADD,
  ADDED,
  DATA_COLUMN,
  DATA_KIND_TITLES,
  DATA_STATUS_SENTENCES,
} from "../RuleLibraryCopy";
import RuleLibraryDataStatus from "../RuleLibraryDataStatus";
import { LibraryRuleDataStatus } from "../RuleLibraryUtil";
import {
  RULE_LIBRARY_ADDED_CLASS_NAME,
  RULE_LIBRARY_DATA_COLUMN_CLASS_NAME,
  RULE_LIBRARY_DATA_COLUMN_MAX_WIDTH_CLASS_NAME,
  RULE_LIBRARY_ROW_FACT_CLASS_NAME,
  RULE_LIBRARY_RULE_COLUMN_CLASS_NAME,
  RULE_LIBRARY_RULE_COLUMN_MAX_WIDTH_CLASS_NAME,
} from "../RuleLibraryTable";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { SecurityHuntLibraryEntry } from "Common/Types/SecurityEvent/SecurityHuntLibrary";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Table from "Common/UI/Components/Table/Table";
import {
  useAreTableColumnsFolded,
  useIsTableCard,
} from "Common/UI/Components/Table/TableCellContext";
import { TableEmptyStateProps } from "Common/UI/Components/Table/TableEmptyState";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Hunt Library as a list a security engineer scans, drawn as the Rule
 * Library is: the shared Table, in the page's card - its header row, its
 * rows, a phone's cards. One row a starter:
 *
 *   Hunt   its name, what it finds under it, and its search as it would
 *          be typed on Events, in the mono type, on one line (the whole of
 *          it on hover);
 *   Data   the events it reads, and whether the project sends them;
 *   and at the row's end Try it - its search on Events, nothing saved -
 *   and Add, or, once the project has it, Added and Open (its hunt's page).
 *
 * Below lg, and on a phone's card, the Data column folds under the name.
 */

/*
 * A starter's search, on its own line under what it finds: read left to
 * right, and on a right-to-left page lined up under the starter's name, at
 * the start of the line, as the rest of the row is.
 */
export const HUNT_LIBRARY_SEARCH_LINE_CLASS_NAME: string =
  "block font-normal [text-align:left] rtl:[text-align:right]";

export interface ComponentProps {
  views: Array<HuntLibraryView>;
  isLoading: boolean;
  error: string;
  onRetry: () => void;
  emptyState: TableEmptyStateProps | undefined;
  // The starter an Add in flight is adding, if any.
  addingId: string | null;
  // Whether the reader may add hunts, and why not.
  canAdd: boolean;
  cannotAddReason?: string | undefined;
  // Why the last Add of a starter could not add it, by starter.
  problems: Record<string, string>;
  onTry: (entry: SecurityHuntLibraryEntry) => void;
  onAdd: (entry: SecurityHuntLibraryEntry) => void;
}

/*
 * The sentence behind a starter's dot: that events of its kind arrived, as
 * the Rule Library says it, or that none did and the hunt finds nothing
 * until they do - a starter is no rule that runs.
 */
export const HUNT_DATA_STATUS_SENTENCES: Record<
  Exclude<LibraryRuleDataStatus, LibraryRuleDataStatus.Unknown>,
  string
> = {
  [LibraryRuleDataStatus.Received]:
    DATA_STATUS_SENTENCES[LibraryRuleDataStatus.Received],
  [LibraryRuleDataStatus.NotReceived]: HUNT_DATA_NOT_RECEIVED,
};

// The events a starter reads, and whether they arrive.
const DataFacts: FunctionComponent<{ view: HuntLibraryView }> = (props: {
  view: HuntLibraryView;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const entry: SecurityHuntLibraryEntry = props.view.entry;
  const title: string = entry.dataKind
    ? DATA_KIND_TITLES[entry.dataKind]
    : ANY_SECURITY_EVENTS;

  return (
    <>
      <span className="break-words text-sm font-normal text-gray-700">
        {translator.translateText(title) || title}
      </span>
      <span>
        <RuleLibraryDataStatus
          status={props.view.dataStatus}
          sentences={HUNT_DATA_STATUS_SENTENCES}
          dataTestId={`${HUNTS_TEST_IDS.libraryEntry}-data-status-${entry.id}`}
        />
      </span>
    </>
  );
};

const HuntCell: FunctionComponent<{
  view: HuntLibraryView;
  problem: string | undefined;
}> = (props: {
  view: HuntLibraryView;
  problem: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isCard: boolean = useIsTableCard();
  const areFactsFolded: boolean = useAreTableColumnsFolded();
  const entry: SecurityHuntLibraryEntry = props.view.entry;

  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-0.5"
      data-testid={`${HUNTS_TEST_IDS.libraryEntry}-hunt-${entry.id}`}
    >
      <span className="break-words font-medium text-gray-900">
        {translator.translateText(entry.title) || entry.title}
      </span>
      <span
        className={`line-clamp-2 whitespace-normal text-sm ${RULE_LIBRARY_ROW_FACT_CLASS_NAME}`}
      >
        {translator.translateText(entry.description) || entry.description}
      </span>
      {/* The search, as written: never looked up as words. */}
      <code
        className={`${HUNT_SEARCH_ONE_LINE_CLASS_NAME} ${HUNT_LIBRARY_SEARCH_LINE_CLASS_NAME}`}
        dir="ltr"
        title={entry.searchQuery}
        data-testid={`${HUNTS_TEST_IDS.libraryEntry}-search-${entry.id}`}
      >
        {entry.searchQuery}
      </code>
      {isCard || areFactsFolded ? (
        <span
          className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"
          data-testid={`${HUNTS_TEST_IDS.libraryEntry}-folded-${entry.id}`}
        >
          <DataFacts view={props.view} />
        </span>
      ) : (
        <></>
      )}
      {props.problem ? (
        <div
          className="mt-1 flex items-start gap-1.5 whitespace-normal text-sm font-normal text-amber-800 [overflow-wrap:anywhere]"
          data-testid={`${HUNTS_TEST_IDS.libraryProblem}-${entry.id}`}
          role="alert"
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
          />
          <span>{props.problem}</span>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

interface ActionsCellProps {
  view: HuntLibraryView;
  isAdding: boolean;
  isAddDisabled: boolean;
  canAdd: boolean;
  cannotAddReason?: string | undefined;
  onTry: (entry: SecurityHuntLibraryEntry) => void;
  onAdd: (entry: SecurityHuntLibraryEntry) => void;
}

/*
 * Try it, then Add - or, once the project has it, Added beside Open, its
 * hunt's page. Try it opens the starter's search on Events whatever the
 * reader may save: reading events is what Events checks.
 */
const ActionsCell: FunctionComponent<ActionsCellProps> = (
  props: ActionsCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const entry: SecurityHuntLibraryEntry = props.view.entry;

  const tryButton: ReactElement = (
    <Button
      title={TRY_IT}
      icon={IconProp.Search}
      buttonStyle={ButtonStyleType.OUTLINE}
      buttonSize={ButtonSize.Small}
      dataTestId={`${HUNTS_TEST_IDS.libraryTry}-${entry.id}`}
      onClick={() => {
        props.onTry(entry);
      }}
    />
  );

  if (props.view.addedHuntId) {
    return (
      <span className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <span
          className={RULE_LIBRARY_ADDED_CLASS_NAME}
          data-testid={`${HUNTS_TEST_IDS.libraryAdded}-${entry.id}`}
        >
          <Icon
            icon={IconProp.Check}
            className="h-4 w-4 flex-none text-emerald-600"
          />
          {translator.translateText(ADDED)}
        </span>
        <Link
          to={getHuntViewRoute(props.view.addedHuntId)}
          className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          dataTestId={`${HUNTS_TEST_IDS.libraryOpen}-${entry.id}`}
        >
          {translator.translateText(OPEN_HUNT) || OPEN_HUNT}
        </Link>
      </span>
    );
  }

  // An Add that cannot be pressed looks it; the one adding shows its spinner.
  const isUnavailable: boolean =
    !props.isAdding && Boolean(!props.canAdd || props.isAddDisabled);

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {tryButton}
      {/*
       * Sized to its words, as Try it is: the two sit side by side on a
       * phone's card too, where a NORMAL button fills its own line.
       */}
      <Button
        title={ADD}
        icon={IconProp.Add}
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        isLoading={props.isAdding}
        disabled={isUnavailable}
        tooltip={props.canAdd ? undefined : props.cannotAddReason}
        dataTestId={`${HUNTS_TEST_IDS.libraryAdd}-${entry.id}`}
        onClick={() => {
          props.onAdd(entry);
        }}
      />
    </span>
  );
};

const HuntLibraryTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const columns: Columns<HuntLibraryView> = [
    {
      title: HUNT_COLUMN_TITLE,
      type: FieldType.Element,
      key: "entry",
      disableSort: true,
      hideTitleOnMobile: true,
      wrapContent: true,
      wrapMaxWidthClassName: RULE_LIBRARY_RULE_COLUMN_MAX_WIDTH_CLASS_NAME,
      contentClassName: RULE_LIBRARY_RULE_COLUMN_CLASS_NAME,
      getElement: (view: HuntLibraryView): ReactElement => {
        return (
          <HuntCell
            view={view}
            problem={
              props.addingId === view.entry.id
                ? undefined
                : props.problems[view.entry.id]
            }
          />
        );
      },
    },
    {
      title: DATA_COLUMN,
      type: FieldType.Element,
      key: "dataStatus",
      disableSort: true,
      hideOnMobile: true,
      // Under the starter's name below lg, as the Rule Library folds its own.
      hideBelowLargeScreen: true,
      wrapContent: true,
      wrapMaxWidthClassName: RULE_LIBRARY_DATA_COLUMN_MAX_WIDTH_CLASS_NAME,
      contentClassName: RULE_LIBRARY_DATA_COLUMN_CLASS_NAME,
      getElement: (view: HuntLibraryView): ReactElement => {
        return (
          <div
            className="flex flex-col"
            data-testid={`${HUNTS_TEST_IDS.libraryEntry}-data-${view.entry.id}`}
          >
            <DataFacts view={view} />
          </div>
        );
      },
    },
    {
      title: "Actions",
      type: FieldType.Actions,
      key: "addedHuntId",
      getElement: (view: HuntLibraryView): ReactElement => {
        return (
          <ActionsCell
            view={view}
            isAdding={props.addingId === view.entry.id}
            isAddDisabled={props.addingId !== null}
            canAdd={props.canAdd}
            cannotAddReason={props.cannotAddReason}
            onTry={props.onTry}
            onAdd={props.onAdd}
          />
        );
      },
    },
  ];

  return (
    <Table<HuntLibraryView>
      id={HUNTS_TEST_IDS.libraryTable}
      data={props.views}
      columns={columns}
      singularLabel="Hunt"
      pluralLabel="Hunts"
      isLoading={props.isLoading}
      error={props.error}
      onRefreshClick={props.onRetry}
      emptyStateProps={props.emptyState}
      disablePagination={true}
      currentPageNumber={1}
      totalItemsCount={props.views.length}
      itemsOnPage={Math.max(props.views.length, 10)}
      onNavigateToPage={() => {
        // Every starter is on the one page.
      }}
      // The library's own order: by category.
      sortBy={null}
      sortOrder={SortOrder.Ascending}
      onSortChanged={() => {
        // No column sorts.
      }}
      getRowProps={(
        view: HuntLibraryView,
      ): React.HTMLAttributes<HTMLElement> => {
        return {
          "data-testid": `${HUNTS_TEST_IDS.libraryEntry}-${view.entry.id}`,
          "data-added": view.addedHuntId ? "true" : "false",
        } as React.HTMLAttributes<HTMLElement>;
      }}
    />
  );
};

export default HuntLibraryTable;
