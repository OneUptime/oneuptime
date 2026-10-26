import { DetectionRuleTypeLabel } from "./DetectionRuleSummary";
import {
  ADD,
  ADDED,
  DATA_COLUMN,
  DATA_KIND_TITLES,
  RECOMMENDED,
  RULE_COLUMN,
  SEVERITY_COLUMN,
  TURNED_OFF,
} from "./RuleLibraryCopy";
import RuleLibraryDataStatus from "./RuleLibraryDataStatus";
import { LibraryRuleView, getLibraryRuleTacticNames } from "./RuleLibraryUtil";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";
import { getProblemReasonText } from "../SecurityOverview/SecurityTurnOnProblems";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DetectionRuleLibraryEntry } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { getMitreTechnique } from "Common/Types/SecurityEvent/MitreAttack";
import { TurnOnRecommendedProblem } from "Common/Types/SecurityEvent/TurnOnRecommended";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { isRowOpeningClick } from "Common/UI/Components/Table/RowClick";
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
 * The library as a list a security engineer scans, drawn as every list in
 * OneUptime is: the shared Table, in the page's card - its header row, its
 * rows, a phone's cards. One row a rule:
 *
 *   Rule      its name (which opens its details), Recommended and its kind
 *             (a sequence, a first-seen rule) beside it, what it finds under
 *             it, and the ATT&CK tactics and techniques it is tagged with;
 *   Data      the events it reads, and whether the project sends them;
 *   Severity  how severe its findings are (its Sigma level);
 *   and at the row's end Add, or Added (and Off, when the project's copy
 *   is turned off).
 *
 * A phone's card is the rule alone: its severity, events and whether they
 * arrive in one line under its name, and Add or Added under that - not a
 * field for each, which made every card of the 47 a screen tall.
 *
 * A click anywhere on a row opens the rule's details, as a row opens its
 * record everywhere (RowClick); the name is a button too, for the keyboard.
 */

export const RULE_LIBRARY_TABLE_ID: string = "rule-library-table";

/*
 * The Rule column is prose (Column.wrapContent): a name runs onto a second
 * line rather than being cut short, its description wraps under it. As
 * wide as they want, up to 34rem, and never narrower than 11rem. Between
 * the two it gives way, so the table fits its card beside the side menu
 * (1024px wide) with Data, Severity and Add in sight, rather than
 * scrolling sideways to reach them - in English with room to spare, and in
 * the languages with the longest words too (German's Hinzufügen, Swedish's
 * Allvarlighetsgrad, Dutch's Aanmeldgebeurtenissen: Dutch was 2px over at
 * 12rem).
 */
export const RULE_LIBRARY_RULE_COLUMN_MAX_WIDTH_CLASS_NAME: string =
  "max-w-[34rem]";
export const RULE_LIBRARY_RULE_COLUMN_CLASS_NAME: string = "min-w-[11rem]";

/*
 * A row's quieter lines under its name - what it finds, its ATT&CK tags:
 * the regular weight. The table draws its first column a step heavier (the
 * row's name), which they would otherwise take.
 */
export const RULE_LIBRARY_ROW_FACT_CLASS_NAME: string =
  "font-normal text-gray-500";

/*
 * Added at a row's end, as tall as the Add button it takes the place of
 * (30px, centred on the row's first line), so the word sits on the name's
 * line as the button does; Off, when the project's copy is turned off,
 * under it rather than beside it, so the column stays the button's width.
 */
export const RULE_LIBRARY_ADDED_CLASS_NAME: string =
  "inline-flex h-[30px] items-center gap-1 whitespace-nowrap text-sm font-medium text-gray-700";

/*
 * The Data column wraps between words: "Kubernetes audit logs" runs onto a
 * second line beside the side menu rather than pushing Add out of the card.
 * A word stays whole - the column is never narrower than its longest
 * (German's Anmeldeereignisse was cut into Anmeldeereignis and se). Never
 * narrower than 7rem, never wider than 11rem, which the longest of them
 * all, Dutch's Aanmeldgebeurtenissen (161px), fits.
 */
export const RULE_LIBRARY_DATA_COLUMN_MAX_WIDTH_CLASS_NAME: string =
  "max-w-[11rem]";
export const RULE_LIBRARY_DATA_COLUMN_CLASS_NAME: string = "min-w-[7rem]";

export interface ComponentProps {
  views: Array<LibraryRuleView>;
  isLoading: boolean;
  error: string;
  onRetry: () => void;
  emptyState: TableEmptyStateProps | undefined;
  // The rules an Add in flight is adding.
  addingIds: Array<string>;
  // Whether the reader may add rules, and why not.
  canAdd: boolean;
  cannotAddReason?: string | undefined;
  // Why the last Add could not add this rule, if it could not.
  getProblem: (
    entry: DetectionRuleLibraryEntry,
  ) => TurnOnRecommendedProblem | undefined;
  // The problem is the only thing said (one row's Add): it is the alert.
  isProblemAlert: boolean;
  // Each Add's answer is drawn afresh, so the same failure twice is announced twice.
  problemKey: number;
  onOpen: (entry: DetectionRuleLibraryEntry) => void;
  onAdd: (entry: DetectionRuleLibraryEntry) => void;
}

// A rule's ATT&CK tags in a line: its tactics' names, then its techniques' ids.
export function getRuleAttackLine(view: LibraryRuleView): string {
  const tactics: string = getLibraryRuleTacticNames(view.attack).join(", ");
  const techniques: string = view.attack.techniqueIds.join(", ");

  return [tactics, techniques]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" · ");
}

// The techniques by id and name, for the line's tooltip: "T1110.001 Brute Force".
export function getRuleTechniquesTitle(view: LibraryRuleView): string {
  return view.attack.techniqueIds
    .map((id: string): string => {
      const name: string = getMitreTechnique(id)?.name || "";

      return name ? `${id} ${name}` : id;
    })
    .join(", ");
}

// The events a rule reads, and whether they arrive.
const DataFacts: FunctionComponent<{ view: LibraryRuleView }> = (props: {
  view: LibraryRuleView;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <>
      <span className="break-words text-sm font-normal text-gray-700">
        {translator.translateText(DATA_KIND_TITLES[props.view.entry.dataKind])}
      </span>
      <span>
        <RuleLibraryDataStatus
          status={props.view.dataStatus}
          dataTestId={`rule-library-data-status-${props.view.entry.id}`}
        />
      </span>
    </>
  );
};

interface RuleCellProps {
  view: LibraryRuleView;
  problem: TurnOnRecommendedProblem | undefined;
  isProblemAlert: boolean;
  problemKey: number;
  onOpen: (entry: DetectionRuleLibraryEntry) => void;
}

const RuleCell: FunctionComponent<RuleCellProps> = (
  props: RuleCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * A phone's card, and below lg a tablet's row, where the Data and
   * Severity columns are left out (hideBelowLargeScreen): the severity and
   * the events go under the name.
   */
  const isCard: boolean = useIsTableCard();
  const areFactsFolded: boolean = useAreTableColumnsFolded();
  const view: LibraryRuleView = props.view;
  const entry: DetectionRuleLibraryEntry = view.entry;
  const attackLine: string = getRuleAttackLine(view);

  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-0.5"
      data-testid={`rule-library-rule-${entry.id}`}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          className="min-w-0 rounded-sm text-left font-medium text-gray-900 hover:text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          data-testid={`rule-library-name-${entry.id}`}
          onClick={() => {
            props.onOpen(entry);
          }}
        >
          {entry.title}
        </button>
        {view.isRecommended ? (
          <span
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
            data-testid={`rule-library-recommended-${entry.id}`}
          >
            <Icon icon={IconProp.Star} className="h-3 w-3" />
            {translator.translateText(RECOMMENDED)}
          </span>
        ) : (
          <></>
        )}
        {view.shape && view.shape.isCorrelation ? (
          <DetectionRuleTypeLabel
            shape={view.shape}
            dataTestId={`rule-library-type-${entry.id}`}
          />
        ) : (
          <></>
        )}
      </span>
      <span
        className={`line-clamp-2 whitespace-normal text-sm ${RULE_LIBRARY_ROW_FACT_CLASS_NAME}`}
        data-testid={`rule-library-description-${entry.id}`}
      >
        {entry.description}
      </span>
      {attackLine ? (
        <span
          className={`truncate text-xs ${RULE_LIBRARY_ROW_FACT_CLASS_NAME}`}
          title={getRuleTechniquesTitle(view)}
          data-testid={`rule-library-attack-${entry.id}`}
        >
          {attackLine}
        </span>
      ) : (
        <></>
      )}
      {isCard || areFactsFolded ? (
        <span
          className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"
          data-testid={`rule-library-card-facts-${entry.id}`}
        >
          <SecurityEventSeverityPill severityName={view.severity} />
          <DataFacts view={view} />
        </span>
      ) : (
        <></>
      )}
      {props.problem ? (
        <div
          key={props.problemKey}
          className="mt-1 flex items-start gap-1.5 whitespace-normal text-sm font-normal text-amber-800 [overflow-wrap:anywhere]"
          data-testid={`rule-library-problem-${entry.id}`}
          role={props.isProblemAlert ? "alert" : undefined}
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
          />
          <span>{getProblemReasonText(translator, props.problem)}</span>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

interface StatusCellProps {
  view: LibraryRuleView;
  isAdding: boolean;
  isAddDisabled: boolean;
  canAdd: boolean;
  cannotAddReason?: string | undefined;
  onAdd: (entry: DetectionRuleLibraryEntry) => void;
}

// Add, or Added - and Off when the project's copy is turned off.
const StatusCell: FunctionComponent<StatusCellProps> = (
  props: StatusCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const entry: DetectionRuleLibraryEntry = props.view.entry;

  if (props.view.isAdded) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <span
          className={RULE_LIBRARY_ADDED_CLASS_NAME}
          data-testid={`rule-library-added-${entry.id}`}
        >
          <Icon
            icon={IconProp.Check}
            className="h-4 w-4 flex-none text-emerald-600"
          />
          {translator.translateText(ADDED)}
        </span>
        {props.view.isTurnedOff ? (
          <span
            className="whitespace-nowrap rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600"
            data-testid={`rule-library-off-${entry.id}`}
          >
            {translator.translateText(TURNED_OFF)}
          </span>
        ) : (
          <></>
        )}
      </span>
    );
  }

  /*
   * An Add that cannot be pressed - the reader's role cannot add rules, or
   * another add is on its way - looks it (Button's disabled look). Not the
   * one adding, which is busy rather than locked and shows its spinner.
   */
  const isUnavailable: boolean =
    !props.isAdding && Boolean(!props.canAdd || props.isAddDisabled);

  return (
    <Button
      title={ADD}
      icon={IconProp.Add}
      buttonStyle={ButtonStyleType.NORMAL}
      buttonSize={ButtonSize.Small}
      isLoading={props.isAdding}
      disabled={isUnavailable}
      tooltip={props.canAdd ? undefined : props.cannotAddReason}
      dataTestId={`rule-library-add-${entry.id}`}
      onClick={() => {
        props.onAdd(entry);
      }}
    />
  );
};

const RuleLibraryTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const columns: Columns<LibraryRuleView> = [
    {
      title: RULE_COLUMN,
      type: FieldType.Element,
      key: "entry",
      disableSort: true,
      hideTitleOnMobile: true,
      wrapContent: true,
      wrapMaxWidthClassName: RULE_LIBRARY_RULE_COLUMN_MAX_WIDTH_CLASS_NAME,
      contentClassName: RULE_LIBRARY_RULE_COLUMN_CLASS_NAME,
      getElement: (view: LibraryRuleView): ReactElement => {
        return (
          <RuleCell
            view={view}
            problem={
              props.addingIds.includes(view.entry.id)
                ? undefined
                : props.getProblem(view.entry)
            }
            isProblemAlert={props.isProblemAlert}
            problemKey={props.problemKey}
            onOpen={props.onOpen}
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
      /*
       * Under the rule's name below lg, with its severity (RuleCell):
       * beside the side menu at 768px the card is 478px wide, and Rule,
       * Data, Severity and Add needed 566px - Add was under the sticky
       * last column until about 860px, and in German at 900px, where Data
       * is as wide as Anmeldeereignisse.
       */
      hideBelowLargeScreen: true,
      wrapContent: true,
      wrapMaxWidthClassName: RULE_LIBRARY_DATA_COLUMN_MAX_WIDTH_CLASS_NAME,
      contentClassName: RULE_LIBRARY_DATA_COLUMN_CLASS_NAME,
      getElement: (view: LibraryRuleView): ReactElement => {
        return (
          <div
            className="flex flex-col"
            data-testid={`rule-library-data-${view.entry.id}`}
          >
            <DataFacts view={view} />
          </div>
        );
      },
    },
    {
      title: SEVERITY_COLUMN,
      type: FieldType.Element,
      key: "severity",
      disableSort: true,
      hideOnMobile: true,
      // Under the rule's name below lg, with its events (see Data).
      hideBelowLargeScreen: true,
      getElement: (view: LibraryRuleView): ReactElement => {
        return (
          <span data-testid={`rule-library-severity-${view.entry.id}`}>
            <SecurityEventSeverityPill severityName={view.severity} />
          </span>
        );
      },
    },
    {
      title: "Actions",
      type: FieldType.Actions,
      key: "isAdded",
      getElement: (view: LibraryRuleView): ReactElement => {
        return (
          <StatusCell
            view={view}
            isAdding={props.addingIds.includes(view.entry.id)}
            isAddDisabled={props.addingIds.length > 0}
            canAdd={props.canAdd}
            cannotAddReason={props.cannotAddReason}
            onAdd={props.onAdd}
          />
        );
      },
    },
  ];

  return (
    <Table<LibraryRuleView>
      id={RULE_LIBRARY_TABLE_ID}
      data={props.views}
      columns={columns}
      singularLabel="Rule"
      pluralLabel="Rules"
      isLoading={props.isLoading}
      error={props.error}
      onRefreshClick={props.onRetry}
      emptyStateProps={props.emptyState}
      disablePagination={true}
      currentPageNumber={1}
      totalItemsCount={props.views.length}
      itemsOnPage={Math.max(props.views.length, 10)}
      onNavigateToPage={() => {
        // Every rule is on the one page.
      }}
      // The library's own order: by category, the recommended rules first in each.
      sortBy={null}
      sortOrder={SortOrder.Ascending}
      onSortChanged={() => {
        // No column sorts.
      }}
      getRowProps={(
        view: LibraryRuleView,
      ): React.HTMLAttributes<HTMLElement> => {
        const rowProps: React.HTMLAttributes<HTMLElement> & {
          "data-testid": string;
          "data-rule-id": string;
          "data-row-opens-record": string;
        } = {
          "data-testid": `rule-library-entry-${view.entry.id}`,
          "data-rule-id": view.entry.id,
          "data-row-opens-record": "true",
          onClick: (event: React.MouseEvent<HTMLElement>): void => {
            if (!isRowOpeningClick(event)) {
              return;
            }

            props.onOpen(view.entry);
          },
        };

        return rowProps;
      }}
    />
  );
};

export default RuleLibraryTable;
