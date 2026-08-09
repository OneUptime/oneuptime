import Icon from "../Icon/Icon";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import { StatusPageGroupHierarchyRow } from "../../../Utils/StatusPage/GroupHierarchyView";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The status page group hierarchy, as the operator who builds it sees it.
 *
 * This used to be a table with a "Parent Group" column, which is the shape you
 * reach for when nesting is one more attribute of a row. It is not: the nesting
 * IS the data here, and the questions an operator has in front of it - what is
 * under what, how deep does this go, where does this new group belong - are all
 * questions about shape. A table can only answer them one row at a time.
 *
 * Everything drawn here comes from rows the caller has already worked out with
 * StatusPageGroupHierarchyViewUtil. The component owns no tree logic of its own;
 * it owns the guide rails, the disclosure controls and the per-row actions.
 */

export interface ComponentProps {
  /* In render order, collapsed subtrees already removed. */
  rows: Array<StatusPageGroupHierarchyRow>;
  onToggleExpand: (statusPageGroupId: string) => void;

  isCreateable?: boolean | undefined;
  isEditable?: boolean | undefined;
  isDeleteable?: boolean | undefined;

  onAddSubGroup?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onEdit?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onDelete?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onMoveUp?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onMoveDown?: ((statusPageGroup: StatusPageGroup) => void) | undefined;
  onShowId?: ((statusPageGroup: StatusPageGroup) => void) | undefined;

  /*
   * The row whose write is in flight. Its actions are disabled so a second
   * click cannot queue a move on top of a move that has not landed yet - the
   * server renumbers siblings on every reorder, so two in flight at once
   * resolve against a hierarchy neither of them saw.
   */
  busyGroupId?: string | null | undefined;

  ariaLabel?: string | undefined;
}

/*
 * The vertical centre of a row's first line: py-2 (8px) plus half of the 20px
 * line the chevron sits on. The elbow is anchored to it rather than to the
 * middle of the row, so a row carrying a description - which is taller - still
 * meets its parent's rail at the same height as its siblings. The row's own
 * contents are top aligned for the same reason.
 */
const CONNECTOR_OFFSET_CLASS_NAME: string = "top-[18px]";

/*
 * An indent column is exactly as wide as a chevron, and its rail runs down the
 * middle of it. That is what lands every rail on the centre line of the chevron
 * of the group it descends from, at every depth, rather than somewhere near it.
 */
const INDENT_COLUMN_CLASS_NAME: string = "relative w-5 flex-shrink-0";
const RAIL_CLASS_NAME: string = "absolute inset-y-0 left-2.5 w-px bg-gray-200";

/*
 * Every control on the right of a row is the same square with the same glyph
 * size, hover and focus ring, because they read as one cluster and any drift
 * between them is visible at a glance.
 *
 * They are native buttons rather than <Button buttonStyle={ICON} />: the
 * overflow trigger has to be one - MoreMenu only enhances a custom trigger in
 * place when it already is a native button - and ButtonStyleType.ICON cannot be
 * talked into matching it from a className, because its padding, its 20px glyph
 * and its indigo-500 offset focus ring are all baked into the style, and its
 * own text-gray-600 beats an appended text-gray-400 (Tailwind orders utilities
 * in the stylesheet, not in the class attribute).
 */
const ROW_ACTION_CLASS_NAME: string =
  "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:pointer-events-none disabled:opacity-40";

interface RowActionButtonProps {
  icon: IconProp;
  tooltip: string;
  ariaLabel: string;
  dataTestId: string;
  isDisabled: boolean;
  onClick: () => void;
}

const RowActionButton: FunctionComponent<RowActionButtonProps> = (
  props: RowActionButtonProps,
): ReactElement => {
  return (
    <Tooltip text={props.tooltip}>
      <button
        type="button"
        aria-label={props.ariaLabel}
        data-testid={props.dataTestId}
        disabled={props.isDisabled}
        className={ROW_ACTION_CLASS_NAME}
        onClick={props.onClick}
      >
        <Icon icon={props.icon} className="h-4 w-4" />
      </button>
    </Tooltip>
  );
};

const GroupHierarchy: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type RenderIndentFunction = (
    row: StatusPageGroupHierarchyRow,
  ) => ReactElement;

  /*
   * One column per level between this row and the left edge. The columns for
   * ancestors carry a rail only while that ancestor still has a sibling below
   * this row; the last column is this row's own connector, which meets the
   * parent's rail with a tee, or with an elbow when the row is the last child.
   */
  const renderIndent: RenderIndentFunction = (
    row: StatusPageGroupHierarchyRow,
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
              data-testid="status-page-group-hierarchy-rail"
              data-rail-continues={doesRailContinue ? "true" : "false"}
            >
              {doesRailContinue ? <span className={RAIL_CLASS_NAME} /> : <></>}
            </span>
          );
        })}
        <span
          aria-hidden="true"
          className={INDENT_COLUMN_CLASS_NAME}
          data-testid="status-page-group-hierarchy-connector"
          data-is-last-sibling={row.isLastVisibleSibling ? "true" : "false"}
        >
          <span
            className={`absolute left-2.5 top-0 w-px bg-gray-200 ${
              row.isLastVisibleSibling ? "h-[18px]" : "bottom-0"
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
    row: StatusPageGroupHierarchyRow,
  ) => ReactElement;

  const renderDisclosure: RenderDisclosureFunction = (
    row: StatusPageGroupHierarchyRow,
  ): ReactElement => {
    if (!row.hasVisibleSubGroups) {
      /*
       * A leaf keeps the column so every name in the tree starts on the same
       * vertical line, whether or not its row can be opened.
       */
      return (
        <span
          className="h-5 w-5 flex-shrink-0"
          aria-hidden="true"
          data-testid="status-page-group-hierarchy-leaf-spacer"
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
        data-testid="status-page-group-hierarchy-disclosure"
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

  type RenderChipsFunction = (row: StatusPageGroupHierarchyRow) => ReactElement;

  const renderChips: RenderChipsFunction = (
    row: StatusPageGroupHierarchyRow,
  ): ReactElement => {
    const chips: Array<ReactElement> = [];

    if (row.hasSubGroups) {
      chips.push(
        <span
          key="sub-groups"
          className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 tabular-nums"
          data-testid="status-page-group-hierarchy-sub-group-count"
          title={
            row.descendantCount === row.subGroupCount
              ? undefined
              : `${row.descendantCount} group${
                  row.descendantCount === 1 ? "" : "s"
                } in total below this one`
          }
        >
          {row.subGroupCount} sub group{row.subGroupCount === 1 ? "" : "s"}
        </span>,
      );
    }

    if (row.statusPageGroup.viewMode === StatusPageGroupViewMode.Grid) {
      chips.push(
        <span
          key="view-mode"
          className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600"
          data-testid="status-page-group-hierarchy-view-mode"
        >
          Grid
        </span>,
      );
    }

    /*
     * Only the non-default is worth a chip. isExpandedByDefault defaults to
     * true, so badging every group that is expanded would put a chip on almost
     * every row and say nothing.
     */
    if (row.statusPageGroup.isExpandedByDefault === false) {
      chips.push(
        <span
          key="collapsed-by-default"
          className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500"
          data-testid="status-page-group-hierarchy-collapsed-by-default"
          title="This group starts collapsed on the public status page."
        >
          Collapsed by default
        </span>,
      );
    }

    if (row.statusPageGroup.showUptimePercent) {
      chips.push(
        <span
          key="uptime"
          className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500"
          data-testid="status-page-group-hierarchy-uptime"
          title="Uptime percent is shown beside this group on the public status page."
        >
          Uptime %
        </span>,
      );
    }

    if (chips.length === 0) {
      return <></>;
    }

    return <Fragment>{chips}</Fragment>;
  };

  type RenderActionsFunction = (
    row: StatusPageGroupHierarchyRow,
  ) => ReactElement;

  const renderActions: RenderActionsFunction = (
    row: StatusPageGroupHierarchyRow,
  ): ReactElement => {
    const isBusy: boolean = props.busyGroupId === row.id;

    const menuItems: Array<ReactElement> = [];

    if (props.isEditable && props.onMoveUp) {
      menuItems.push(
        <MoreMenuItem
          key="move-up"
          text="Move up"
          icon={IconProp.ArrowUp}
          isDisabled={isBusy || !row.canMoveUp}
          onClick={() => {
            props.onMoveUp?.(row.statusPageGroup);
          }}
        />,
      );
    }

    if (props.isEditable && props.onMoveDown) {
      menuItems.push(
        <MoreMenuItem
          key="move-down"
          text="Move down"
          icon={IconProp.ArrowDown}
          isDisabled={isBusy || !row.canMoveDown}
          onClick={() => {
            props.onMoveDown?.(row.statusPageGroup);
          }}
        />,
      );
    }

    if (props.onShowId) {
      menuItems.push(
        <MoreMenuItem
          key="show-id"
          text="Show ID"
          icon={IconProp.Info}
          onClick={() => {
            props.onShowId?.(row.statusPageGroup);
          }}
        />,
      );
    }

    if (props.isDeleteable && props.onDelete) {
      menuItems.push(
        <MoreMenuItem
          key="delete"
          text="Delete group"
          icon={IconProp.Trash}
          className="text-red-600 enabled:hover:bg-red-50 enabled:hover:text-red-700"
          iconClassName="text-red-400 group-hover:text-red-500"
          isDisabled={isBusy}
          onClick={() => {
            props.onDelete?.(row.statusPageGroup);
          }}
        />,
      );
    }

    /*
     * The controls are taller than the line they sit on, so the negative margin
     * both centres them on it and stops them adding 8px to the height of every
     * row in the tree.
     */
    return (
      <div
        className="-my-1 ml-auto flex flex-shrink-0 items-center gap-1 pl-2"
        data-testid="status-page-group-hierarchy-actions"
      >
        {props.isCreateable && props.onAddSubGroup ? (
          <RowActionButton
            icon={IconProp.FolderPlus}
            tooltip="Add a sub group inside this group"
            ariaLabel={`Add a sub group inside ${row.name || "this group"}`}
            dataTestId="status-page-group-hierarchy-add-sub-group"
            isDisabled={isBusy}
            onClick={() => {
              props.onAddSubGroup?.(row.statusPageGroup);
            }}
          />
        ) : (
          <></>
        )}

        {props.isEditable && props.onEdit ? (
          <RowActionButton
            icon={IconProp.Edit}
            tooltip="Edit this group"
            ariaLabel={`Edit ${row.name || "this group"}`}
            dataTestId="status-page-group-hierarchy-edit"
            isDisabled={isBusy}
            onClick={() => {
              props.onEdit?.(row.statusPageGroup);
            }}
          />
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
                data-testid="status-page-group-hierarchy-more"
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

  type RenderRowFunction = (row: StatusPageGroupHierarchyRow) => ReactElement;

  const renderRow: RenderRowFunction = (
    row: StatusPageGroupHierarchyRow,
  ): ReactElement => {
    const isBusy: boolean = props.busyGroupId === row.id;

    return (
      <div
        key={row.id}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-posinset={row.visibleSiblingIndex + 1}
        aria-setsize={row.visibleSiblingCount}
        aria-expanded={row.hasVisibleSubGroups ? row.isExpanded : undefined}
        aria-busy={isBusy ? true : undefined}
        data-testid="status-page-group-hierarchy-row"
        data-depth={row.depth}
        data-group-id={row.id}
        data-search-match={row.isSearchMatch ? "true" : "false"}
        /*
         * The row's own padding is what lets a hover highlight reach past the
         * content column, out to the padding of whatever panel the caller has
         * put the tree in.
         */
        className={`group relative flex items-stretch rounded-lg px-2 transition-colors hover:bg-gray-50 ${
          isBusy ? "opacity-60" : ""
        }`}
      >
        {renderIndent(row)}

        {/*
         * Top aligned, not centred: a row with a description is two lines tall,
         * and centring would drag its chevron - and with it the elbow every
         * sibling's rail is drawn against - half a description downwards.
         */}
        <div className="flex min-w-0 flex-1 items-start gap-2 py-2 pr-1">
          {renderDisclosure(row)}

          <Icon
            icon={
              row.hasSubGroups && row.isExpanded
                ? IconProp.FolderOpen
                : IconProp.Folder
            }
            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
              row.hasSubGroups ? "text-indigo-400" : "text-gray-300"
            }`}
          />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`truncate text-sm font-medium ${
                  /*
                   * A row that is only on screen to give a match its place in
                   * the hierarchy is context, not a result.
                   */
                  row.isSearchMatch ? "text-gray-900" : "text-gray-400"
                }`}
                title={row.name}
                data-testid="status-page-group-hierarchy-name"
              >
                {row.name || "Untitled group"}
              </span>
              {renderChips(row)}
            </div>

            {row.statusPageGroup.description ? (
              <p
                className="mt-0.5 truncate text-xs text-gray-500"
                title={row.statusPageGroup.description}
                data-testid="status-page-group-hierarchy-description"
              >
                {row.statusPageGroup.description}
              </p>
            ) : (
              <></>
            )}
          </div>

          {renderActions(row)}
        </div>
      </div>
    );
  };

  return (
    <div
      role="tree"
      aria-label={props.ariaLabel || "Status page group hierarchy"}
      data-testid="status-page-group-hierarchy"
    >
      {props.rows.map((row: StatusPageGroupHierarchyRow) => {
        return renderRow(row);
      })}
    </div>
  );
};

export default GroupHierarchy;
