import IconProp from "../../../Types/Icon/IconProp";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import StatusPageResourceExplorerUtil, {
  StatusPageResourceCountIndex,
  StatusPageResourceNavigatorRow,
  StatusPageResourceSelection,
  StatusPageResourceSelectionType,
} from "../../../Utils/StatusPage/ResourceExplorer";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /* In render order, collapsed subtrees already removed, counts attached. */
  rows: Array<StatusPageResourceNavigatorRow>;
  countIndex: StatusPageResourceCountIndex;
  selection: StatusPageResourceSelection;
  onSelect: (selection: StatusPageResourceSelection) => void;
  onToggleExpand: (statusPageGroupId: string) => void;

  /* How many rows the cap is holding back, and how to ask for more. */
  hiddenRowCount: number;
  onShowMore: () => void;

  searchText: string;
}

/*
 * The left hand side of the Resources explorer: the group hierarchy, as
 * somewhere to go rather than as something to unfold.
 *
 * Two controls per row, and they do different things. The chevron opens the
 * group's sub groups; the row itself selects the group, which is what puts its
 * monitors in the pane on the right. Keeping them apart is what lets an
 * operator look inside a branch without losing the group they were working in -
 * and it is why the chevron is a button beside the row rather than inside it.
 */

/*
 * An indent column is exactly as wide as a chevron, and its rail runs down the
 * middle of it, so every rail lands on the centre line of the chevron of the
 * group it descends from, at every depth. Same geometry as the Groups tab, so
 * the same hierarchy reads the same way on both screens.
 */
const INDENT_COLUMN_CLASS_NAME: string = "relative w-5 flex-shrink-0";
const RAIL_CLASS_NAME: string = "absolute inset-y-0 left-2.5 w-px bg-gray-200";
/* The vertical centre of a row: py-1.5 (6px) plus half of its 20px line. */
const CONNECTOR_OFFSET_CLASS_NAME: string = "top-4";

const ResourceGroupNavigator: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isUngroupedSelected: boolean =
    props.selection.type === StatusPageResourceSelectionType.Ungrouped;

  type RenderIndentFunction = (
    row: StatusPageResourceNavigatorRow,
  ) => ReactElement;

  const renderIndent: RenderIndentFunction = (
    row: StatusPageResourceNavigatorRow,
  ): ReactElement => {
    if (row.depth <= 0) {
      return <></>;
    }

    return (
      <Fragment>
        {row.ancestorRails.map((doesRailContinue: boolean, column: number) => {
          return (
            <span
              key={`rail-${column}`}
              aria-hidden="true"
              className={INDENT_COLUMN_CLASS_NAME}
              data-testid="status-page-resource-navigator-rail"
              data-rail-continues={doesRailContinue ? "true" : "false"}
            >
              {doesRailContinue ? <span className={RAIL_CLASS_NAME} /> : <></>}
            </span>
          );
        })}
        <span
          aria-hidden="true"
          className={INDENT_COLUMN_CLASS_NAME}
          data-testid="status-page-resource-navigator-connector"
        >
          <span
            className={`absolute left-2.5 top-0 w-px bg-gray-200 ${
              row.isLastVisibleSibling ? "h-4" : "bottom-0"
            }`}
          />
          <span
            className={`absolute left-2.5 h-px w-2.5 bg-gray-200 ${CONNECTOR_OFFSET_CLASS_NAME}`}
          />
        </span>
      </Fragment>
    );
  };

  type RenderDisclosureFunction = (
    row: StatusPageResourceNavigatorRow,
  ) => ReactElement;

  const renderDisclosure: RenderDisclosureFunction = (
    row: StatusPageResourceNavigatorRow,
  ): ReactElement => {
    if (!row.hasVisibleSubGroups) {
      /*
       * A leaf keeps the column so every name in the navigator starts on the
       * same vertical line whether or not its row can be opened.
       */
      return (
        <span
          className="h-5 w-5 flex-shrink-0"
          aria-hidden="true"
          data-testid="status-page-resource-navigator-leaf-spacer"
        />
      );
    }

    return (
      <button
        type="button"
        aria-label={
          row.isExpanded
            ? `Collapse ${row.name || "group"}`
            : `Expand ${row.name || "group"}`
        }
        aria-expanded={row.isExpanded}
        data-testid="status-page-resource-navigator-disclosure"
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        onClick={() => {
          props.onToggleExpand(row.id);
        }}
      >
        <Icon
          icon={row.isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="h-4 w-4"
        />
      </button>
    );
  };

  type RenderCountFunction = (
    row: StatusPageResourceNavigatorRow,
  ) => ReactElement;

  const renderCount: RenderCountFunction = (
    row: StatusPageResourceNavigatorRow,
  ): ReactElement => {
    const label: string | null =
      StatusPageResourceExplorerUtil.getNavigatorCountLabel({
        row: row,
        countIndex: props.countIndex,
      });

    if (label === null) {
      return <></>;
    }

    return (
      <span
        className={`flex-shrink-0 text-[11px] tabular-nums ${
          row.ownResourceCount === 0 ? "text-gray-300" : "text-gray-400"
        }`}
        title={StatusPageResourceExplorerUtil.getNavigatorCountTooltip({
          row: row,
          countIndex: props.countIndex,
        })}
        data-testid="status-page-resource-navigator-count"
      >
        {label}
      </span>
    );
  };

  type RenderRowFunction = (
    row: StatusPageResourceNavigatorRow,
  ) => ReactElement;

  const renderRow: RenderRowFunction = (
    row: StatusPageResourceNavigatorRow,
  ): ReactElement => {
    const isSelected: boolean =
      props.selection.type === StatusPageResourceSelectionType.Group &&
      props.selection.statusPageGroupId === row.id;

    return (
      <div
        key={row.id}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-posinset={row.visibleSiblingIndex + 1}
        aria-setsize={row.visibleSiblingCount}
        aria-expanded={row.hasVisibleSubGroups ? row.isExpanded : undefined}
        aria-selected={isSelected}
        data-testid="status-page-resource-navigator-row"
        data-group-id={row.id}
        data-depth={row.depth}
        data-selected={isSelected ? "true" : "false"}
        className="flex items-stretch"
      >
        {renderIndent(row)}

        <div className="flex min-w-0 flex-1 items-center gap-1">
          {renderDisclosure(row)}

          <button
            type="button"
            data-testid="status-page-resource-navigator-select"
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pl-1.5 pr-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              isSelected
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-700 hover:bg-gray-100"
            }`}
            onClick={() => {
              props.onSelect({
                type: StatusPageResourceSelectionType.Group,
                statusPageGroupId: row.id,
              });
            }}
          >
            <Icon
              icon={
                row.viewMode === StatusPageGroupViewMode.Grid
                  ? IconProp.Grid
                  : row.hasSubGroups && row.isExpanded
                    ? IconProp.FolderOpen
                    : IconProp.Folder
              }
              className={`h-4 w-4 flex-shrink-0 ${
                isSelected
                  ? "text-indigo-500"
                  : row.hasSubGroups
                    ? "text-gray-400"
                    : "text-gray-300"
              }`}
            />

            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                isSelected ? "font-semibold" : "font-medium"
              } ${
                /*
                 * A row that is only on screen to give a match its place in the
                 * hierarchy is context, not a result.
                 */
                row.isSearchMatch ? "" : "text-gray-400"
              }`}
              title={row.name || "Untitled group"}
              data-testid="status-page-resource-navigator-name"
            >
              {row.name || "Untitled group"}
            </span>

            {renderCount(row)}
          </button>
        </div>
      </div>
    );
  };

  type RenderUngroupedRowFunction = () => ReactElement;

  const renderUngroupedRow: RenderUngroupedRowFunction = (): ReactElement => {
    return (
      <button
        type="button"
        data-testid="status-page-resource-navigator-ungrouped"
        aria-current={isUngroupedSelected ? "true" : undefined}
        className={`flex w-full items-center gap-2 rounded-md py-1.5 pl-1.5 pr-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          isUngroupedSelected
            ? "bg-indigo-50 text-indigo-700"
            : "text-gray-700 hover:bg-gray-100"
        }`}
        onClick={() => {
          props.onSelect({
            type: StatusPageResourceSelectionType.Ungrouped,
            statusPageGroupId: null,
          });
        }}
      >
        <Icon
          icon={IconProp.List}
          className={`h-4 w-4 flex-shrink-0 ${
            isUngroupedSelected ? "text-indigo-500" : "text-gray-400"
          }`}
        />
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            isUngroupedSelected ? "font-semibold" : "font-medium"
          }`}
        >
          Uncategorized
        </span>
        {props.countIndex.isComplete ? (
          <span
            className={`flex-shrink-0 text-[11px] tabular-nums ${
              props.countIndex.ungroupedCount === 0
                ? "text-gray-300"
                : "text-gray-400"
            }`}
            title={`${props.countIndex.ungroupedCount.toLocaleString()} ${
              props.countIndex.ungroupedCount === 1 ? "resource" : "resources"
            } that are not in any group`}
            data-testid="status-page-resource-navigator-ungrouped-count"
          >
            {props.countIndex.ungroupedCount.toLocaleString()}
          </span>
        ) : (
          <></>
        )}
      </button>
    );
  };

  type RenderGroupsFunction = () => ReactElement;

  const renderGroups: RenderGroupsFunction = (): ReactElement => {
    if (props.rows.length === 0) {
      return (
        <p
          className="px-1.5 py-3 text-xs text-gray-500"
          role="status"
          data-testid="status-page-resource-navigator-empty"
        >
          No groups match &quot;{props.searchText}&quot;.
        </p>
      );
    }

    return (
      <Fragment>
        <div
          role="tree"
          aria-label="Status page groups"
          data-testid="status-page-resource-navigator-tree"
          className="space-y-0.5"
        >
          {props.rows.map((row: StatusPageResourceNavigatorRow) => {
            return renderRow(row);
          })}
        </div>

        {props.hiddenRowCount > 0 ? (
          <div
            className="px-1 pt-2"
            data-testid="status-page-resource-navigator-show-more"
          >
            <Button
              title={`Show ${Math.min(
                props.hiddenRowCount,
                StatusPageResourceExplorerUtil.NavigatorRowsPerPage,
              ).toLocaleString()} more of ${props.hiddenRowCount.toLocaleString()}`}
              icon={IconProp.ChevronDown}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={props.onShowMore}
            />
          </div>
        ) : (
          <></>
        )}
      </Fragment>
    );
  };

  return (
    <div data-testid="status-page-resource-navigator">
      {renderUngroupedRow()}

      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Groups
        </p>
        {renderGroups()}
      </div>
    </div>
  );
};

export default ResourceGroupNavigator;
