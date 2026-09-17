import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
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
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import Tooltip from "../Tooltip/Tooltip";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useRef,
} from "react";

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

  /*
   * Managing the hierarchy, which used to be a separate page. Every one of
   * these is optional so a screen that only browses can leave them out.
   */
  isCreateable?: boolean | undefined;
  isEditable?: boolean | undefined;
  isDeleteable?: boolean | undefined;

  /* Creating a group at the top level, from the section header. */
  onCreateGroup?: (() => void) | undefined;
  onAddSubGroup?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onEditGroup?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onDeleteGroup?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onMoveGroupUp?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onMoveGroupDown?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onShowGroupId?: ((statusPageGroup: StatusPageGroup) => void) | undefined;

  /*
   * The row whose write is in flight. Its actions are disabled so a second
   * click cannot queue a move on top of one that has not landed yet - the
   * server renumbers siblings on every reorder, so two in flight at once
   * resolve against a hierarchy neither of them saw.
   */
  busyGroupId?: string | null | undefined;
}

/*
 * The left hand side of the Resources explorer: the group hierarchy, as
 * somewhere to go AND as the thing being built.
 *
 * Groups used to be managed on a page of their own, which meant the two halves
 * of one job - "make a section" and "put monitors in it" - lived behind
 * different links, and building a status page was a loop of navigating between
 * them. They are one screen now: the tree here is what an operator selects to
 * fill, and the same rows are where a group is created, renamed, moved and
 * deleted.
 *
 * Three controls per row, and they do different things. The chevron opens the
 * group's sub groups; the row itself selects the group, which is what puts its
 * monitors in the pane on the right; the cluster that appears on hover acts on
 * the group. Keeping the first two apart is what lets an operator look inside a
 * branch without losing the group they were working in.
 */

/*
 * An indent column is exactly as wide as a chevron, and its rail runs down the
 * middle of it, so every rail lands on the centre line of the chevron of the
 * group it descends from, at every depth.
 */
const INDENT_COLUMN_CLASS_NAME: string = "relative w-5 flex-shrink-0";
const RAIL_CLASS_NAME: string = "absolute inset-y-0 left-2.5 w-px bg-gray-200";
/* The vertical centre of a row: py-2 (8px) plus half of its 20px line. */
const CONNECTOR_OFFSET_CLASS_NAME: string = "top-[1.125rem]";

/*
 * Every control in a row's hover cluster is the same square with the same glyph
 * size, hover and focus ring, because they read as one cluster and any drift
 * between them is visible at a glance.
 *
 * Native buttons rather than <Button buttonStyle={ICON} />: the overflow trigger
 * has to be one - MoreMenu only enhances a custom trigger in place when it
 * already is a native button - and ButtonStyleType.ICON cannot be talked into
 * matching it from a className, because its padding, its 20px glyph and its
 * indigo-500 offset focus ring are all baked into the style.
 */
const ROW_ACTION_CLASS_NAME: string =
  "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:pointer-events-none disabled:opacity-40";

const ROW_SELECTOR: string =
  "[data-testid='status-page-resource-navigator-row']";
const SELECT_SELECTOR: string =
  "[data-testid='status-page-resource-navigator-select']";

const ResourceGroupNavigator: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isUngroupedSelected: boolean =
    props.selection.type === StatusPageResourceSelectionType.Ungrouped;

  /*
   * Whether a row has anything to act on it with. Every one of these is a
   * property of the screen rather than of a row, so it is worked out once - and
   * the count needs to know, because it is drawn where the cluster lands.
   */
  const hasRowActions: boolean = Boolean(
    (props.isCreateable && props.onAddSubGroup) ||
      (props.isEditable && (props.onEditGroup || props.onMoveGroupUp)) ||
      props.onShowGroupId ||
      (props.isDeleteable && props.onDeleteGroup),
  );

  const treeRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(
    null,
  ) as React.RefObject<HTMLDivElement>;

  type OnTreeKeyDownFunction = (
    event: React.KeyboardEvent<HTMLElement>,
  ) => void;

  /*
   * The arrow keys everybody already knows from a file tree: up and down walk
   * the rows that are on screen, right opens a branch and then steps into it,
   * left closes the branch you are in and then climbs out of it.
   *
   * Without this the only way through a large hierarchy from the keyboard is
   * Tab, which stops on every chevron and every hover action on the way past -
   * three stops per row, and no way to skip a subtree at all.
   */
  const onTreeKeyDown: OnTreeKeyDownFunction = (
    event: React.KeyboardEvent<HTMLElement>,
  ): void => {
    const navigationKeys: Array<string> = [
      "ArrowDown",
      "ArrowUp",
      "ArrowRight",
      "ArrowLeft",
      "Home",
      "End",
    ];

    if (!navigationKeys.includes(event.key)) {
      return;
    }

    const rowElements: Array<HTMLElement> = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR) || [],
    );

    const activeElement: Element | null = document.activeElement;

    const currentIndex: number = rowElements.findIndex(
      (rowElement: HTMLElement) => {
        return (
          activeElement instanceof Node && rowElement.contains(activeElement)
        );
      },
    );

    if (currentIndex < 0) {
      return;
    }

    const row: StatusPageResourceNavigatorRow | undefined =
      props.rows[currentIndex];

    if (!row) {
      return;
    }

    type FocusRowFunction = (index: number) => void;

    const focusRow: FocusRowFunction = (index: number): void => {
      const target: HTMLElement | undefined =
        rowElements[Math.max(0, Math.min(rowElements.length - 1, index))];

      target?.querySelector<HTMLElement>(SELECT_SELECTOR)?.focus();
    };

    /*
     * Claimed before anything is done with it, so the page does not scroll out
     * from under a tree the operator is walking.
     */
    event.preventDefault();

    if (event.key === "ArrowDown") {
      focusRow(currentIndex + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      focusRow(currentIndex - 1);
      return;
    }

    if (event.key === "Home") {
      focusRow(0);
      return;
    }

    if (event.key === "End") {
      focusRow(rowElements.length - 1);
      return;
    }

    if (event.key === "ArrowRight") {
      if (!row.hasVisibleSubGroups) {
        return;
      }

      if (row.isExpanded) {
        /* Already open, so the first child is the next row drawn. */
        focusRow(currentIndex + 1);
        return;
      }

      props.onToggleExpand(row.id);
      return;
    }

    /* ArrowLeft: close this branch, or climb to the one that contains it. */
    if (row.hasVisibleSubGroups && row.isExpanded) {
      props.onToggleExpand(row.id);
      return;
    }

    for (let index: number = currentIndex - 1; index >= 0; index--) {
      if ((props.rows[index]?.depth ?? 0) < row.depth) {
        focusRow(index);
        return;
      }
    }
  };

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
          data-is-last-sibling={row.isLastVisibleSibling ? "true" : "false"}
        >
          <span
            className={`absolute left-2.5 top-0 w-px bg-gray-200 ${
              row.isLastVisibleSibling ? "h-[1.125rem]" : "bottom-0"
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
    isSelected: boolean,
  ) => ReactElement;

  const renderCount: RenderCountFunction = (
    row: StatusPageResourceNavigatorRow,
    isSelected: boolean,
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
        /*
         * A pill rather than loose digits: a bare number at the end of a name
         * reads as part of the name, which on a status page full of "Region
         * 1000" and "Market 1001" is not a theoretical problem.
         *
         * It gives the row up to the action cluster, which is drawn over this
         * end of the row - `invisible` rather than `hidden` so the name is
         * truncated to the same width either way and cannot reflow under the
         * pointer. The cluster's own background cannot be relied on to cover
         * it: the dark theme maps indigo-50 to a translucent fill, and the
         * digits read straight through it.
         */
        className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
          hasRowActions
            ? "group-hover/nav-row:invisible group-focus-within/nav-row:invisible"
            : ""
        } ${
          isSelected
            ? hasRowActions
              ? "invisible"
              : "bg-indigo-100 text-indigo-700"
            : row.ownResourceCount === 0
              ? "bg-gray-100 text-gray-400"
              : "bg-gray-100 text-gray-500"
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

  type RenderActionsFunction = (
    row: StatusPageResourceNavigatorRow,
    isSelected: boolean,
  ) => ReactElement;

  /*
   * The group's own actions. They sit over the right hand end of the row rather
   * than beside the name, so a row is exactly as wide for its name whether or
   * not the pointer is on it - a cluster that pushed the name aside on hover
   * would make every name in a narrow sidebar jump as the pointer travelled
   * down it.
   *
   * bg-inherit is what makes the overlay work: the row underneath is the thing
   * carrying the hover and selected backgrounds, so the cluster is always
   * painted on whatever the row currently is.
   */
  const renderActions: RenderActionsFunction = (
    row: StatusPageResourceNavigatorRow,
    isSelected: boolean,
  ): ReactElement => {
    const isBusy: boolean = props.busyGroupId === row.id;

    const menuItems: Array<ReactElement> = [];

    if (props.isEditable && props.onEditGroup) {
      menuItems.push(
        <MoreMenuItem
          key="edit"
          text="Edit group"
          icon={IconProp.Edit}
          isDisabled={isBusy}
          onClick={() => {
            props.onEditGroup?.(row.statusPageGroup);
          }}
        />,
      );
    }

    if (props.isEditable && props.onMoveGroupUp) {
      menuItems.push(
        <MoreMenuItem
          key="move-up"
          text="Move up"
          icon={IconProp.ArrowUp}
          isDisabled={isBusy || !row.canMoveUp}
          onClick={() => {
            props.onMoveGroupUp?.(row.statusPageGroup);
          }}
        />,
      );
    }

    if (props.isEditable && props.onMoveGroupDown) {
      menuItems.push(
        <MoreMenuItem
          key="move-down"
          text="Move down"
          icon={IconProp.ArrowDown}
          isDisabled={isBusy || !row.canMoveDown}
          onClick={() => {
            props.onMoveGroupDown?.(row.statusPageGroup);
          }}
        />,
      );
    }

    if (props.onShowGroupId) {
      menuItems.push(
        <MoreMenuItem
          key="show-id"
          text="Show ID"
          icon={IconProp.Info}
          onClick={() => {
            props.onShowGroupId?.(row.statusPageGroup);
          }}
        />,
      );
    }

    if (props.isDeleteable && props.onDeleteGroup) {
      menuItems.push(
        <MoreMenuItem
          key="delete"
          text="Delete group"
          icon={IconProp.Trash}
          className="text-red-600 enabled:hover:bg-red-50 enabled:hover:text-red-700"
          iconClassName="text-red-400 group-hover:text-red-500"
          isDisabled={isBusy}
          onClick={() => {
            props.onDeleteGroup?.(row.statusPageGroup);
          }}
        />,
      );
    }

    const canAddSubGroup: boolean = Boolean(
      props.isCreateable && props.onAddSubGroup,
    );

    if (!canAddSubGroup && menuItems.length === 0) {
      return <></>;
    }

    return (
      <div
        /*
         * The selected row keeps its actions on screen. Hover is the discovery
         * affordance, not the only one: a touch screen has no hover at all, and
         * the row an operator is working in is precisely the one they are most
         * likely to want to act on. Its count is the thing given up for it, and
         * the pane beside it is already showing that number.
         */
        className={`absolute inset-y-0 right-0 items-center gap-0.5 rounded-r-md pl-4 pr-1 group-hover/nav-row:flex group-focus-within/nav-row:flex ${
          isSelected ? "flex bg-indigo-50" : "hidden bg-gray-100"
        }`}
        data-testid="status-page-resource-navigator-actions"
      >
        {canAddSubGroup ? (
          <Tooltip text="Add a sub group inside this group">
            <button
              type="button"
              aria-label={`Add a sub group inside ${row.name || "this group"}`}
              data-testid="status-page-resource-navigator-add-sub-group"
              disabled={isBusy}
              className={ROW_ACTION_CLASS_NAME}
              onClick={() => {
                props.onAddSubGroup?.(row.statusPageGroup);
              }}
            >
              <Icon icon={IconProp.FolderPlus} className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : (
          <></>
        )}

        {menuItems.length > 0 ? (
          <MoreMenu
            ariaLabel={`More actions for ${row.name || "this group"}`}
            isDisabled={isBusy}
            elementToBeShownInsteadOfButton={
              <button
                type="button"
                data-testid="status-page-resource-navigator-more"
                className={ROW_ACTION_CLASS_NAME}
              >
                <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
              </button>
            }
          >
            {menuItems}
          </MoreMenu>
        ) : (
          <></>
        )}
      </div>
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

    const isBusy: boolean = props.busyGroupId === row.id;

    return (
      <div
        key={row.id}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-posinset={row.visibleSiblingIndex + 1}
        aria-setsize={row.visibleSiblingCount}
        aria-expanded={row.hasVisibleSubGroups ? row.isExpanded : undefined}
        aria-selected={isSelected}
        aria-busy={isBusy ? true : undefined}
        data-testid="status-page-resource-navigator-row"
        data-group-id={row.id}
        data-depth={row.depth}
        data-selected={isSelected ? "true" : "false"}
        /*
         * A grid group lays its resources out as a matrix rather than a list,
         * which is the difference between "add a monitor" and "add a monitor to
         * a cell" - so the row says which it is, in its glyph and here.
         */
        data-view-mode={row.viewMode || StatusPageGroupViewMode.List}
        className={`group/nav-row relative flex items-stretch rounded-lg transition-colors ${
          isSelected
            ? "bg-indigo-50"
            : "hover:bg-gray-100 focus-within:bg-gray-100"
        } ${isBusy ? "opacity-60" : ""}`}
      >
        {renderIndent(row)}

        <div className="flex min-w-0 flex-1 items-center gap-1">
          {renderDisclosure(row)}

          <button
            type="button"
            data-testid="status-page-resource-navigator-select"
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pl-1 pr-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              isSelected ? "text-indigo-700" : "text-gray-700"
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

            {renderCount(row, isSelected)}
          </button>
        </div>

        {renderActions(row, isSelected)}
      </div>
    );
  };

  type RenderUngroupedRowFunction = () => ReactElement;

  /*
   * The resources that belong to no group. "Top of page" rather than
   * "Uncategorized": on the public status page these are drawn first, above
   * every group, so where they appear is the useful thing to know about them -
   * and it is a place an operator can picture, which "uncategorized" is not.
   */
  const renderUngroupedRow: RenderUngroupedRowFunction = (): ReactElement => {
    return (
      <button
        type="button"
        data-testid="status-page-resource-navigator-ungrouped"
        title="Resources that are not in any group. Visitors see these first, above every group."
        aria-current={isUngroupedSelected ? "true" : undefined}
        className={`flex w-full items-center gap-2 rounded-lg py-2 pl-2 pr-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
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
          Top of page
        </span>
        {props.countIndex.isComplete ? (
          <span
            className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
              isUngroupedSelected
                ? "bg-indigo-100 text-indigo-700"
                : props.countIndex.ungroupedCount === 0
                  ? "bg-gray-100 text-gray-400"
                  : "bg-gray-100 text-gray-500"
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
          className="rounded-lg border border-dashed border-gray-300 px-3 py-3 text-xs text-gray-500"
          role="status"
          data-testid="status-page-resource-navigator-empty"
        >
          {props.searchText
            ? `No groups match “${props.searchText}”.`
            : "No groups yet. Groups split a longer status page into sections, and they can be nested."}
        </p>
      );
    }

    return (
      <Fragment>
        <div
          ref={treeRef}
          role="tree"
          aria-label="Status page groups"
          data-testid="status-page-resource-navigator-tree"
          className="space-y-0.5"
          onKeyDown={onTreeKeyDown}
        >
          {props.rows.map((row: StatusPageResourceNavigatorRow) => {
            return renderRow(row);
          })}
        </div>

        {props.hiddenRowCount > 0 ? (
          <div
            className="px-1 pt-2 [&_button]:md:ml-0"
            data-testid="status-page-resource-navigator-show-more"
          >
            <Button
              title={`Show ${Math.min(
                props.hiddenRowCount,
                StatusPageResourceExplorerUtil.NavigatorRowsPerPage,
              ).toLocaleString()} more of ${props.hiddenRowCount.toLocaleString()}`}
              icon={IconProp.ChevronDown}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
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

      <div className="mt-3 border-t border-gray-200 pt-3">
        {/*
         * The section header is where a new group belongs: beside the list it
         * will join, rather than in a page header two panes away from it.
         */}
        <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Groups
          </p>

          {props.isCreateable && props.onCreateGroup ? (
            <Tooltip text="Create a top level group">
              <button
                type="button"
                aria-label="Create a top level group"
                data-testid="status-page-resource-navigator-create-group"
                className={ROW_ACTION_CLASS_NAME}
                onClick={props.onCreateGroup}
              >
                <Icon icon={IconProp.Add} className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : (
            <></>
          )}
        </div>

        {renderGroups()}
      </div>
    </div>
  );
};

export default ResourceGroupNavigator;
