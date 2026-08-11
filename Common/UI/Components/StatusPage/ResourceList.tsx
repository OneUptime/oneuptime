import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import IconProp from "../../../Types/Icon/IconProp";
import StatusPageResourceExplorerUtil from "../../../Utils/StatusPage/ResourceExplorer";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import React, { FunctionComponent, ReactElement } from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
  DropResult,
  Droppable,
  DroppableProvided,
} from "react-beautiful-dnd";

export interface ComponentProps {
  statusPageResources: Array<StatusPageResource>;
  /*
   * Distinguishes this list's drag scope from any other on the page. Two
   * droppables sharing an id would let a row be dropped into the wrong one.
   */
  listKey: string;

  /*
   * How a resource's monitor is drawn. The monitor element lives in the
   * dashboard - it links through to the monitor and knows about project
   * routing - and this component is in Common, so the caller hands it in.
   */
  getResourceElement: (statusPageResource: StatusPageResource) => ReactElement;

  isEditable: boolean;
  isDeleteable: boolean;
  /*
   * False while a filter is on. The order a drag writes is "take the place of
   * the row you were dropped on", and in a filtered list the row above is not
   * the row above - so the reorder is offered only over the whole list.
   */
  isReorderable: boolean;

  onEdit: (statusPageResource: StatusPageResource) => void;
  onDelete: (statusPageResource: StatusPageResource) => void;
  onShowId: (statusPageResource: StatusPageResource) => void;
  /*
   * From and to are positions in the list as drawn. The caller turns them into
   * the one write the server understands.
   */
  onReorder: (fromIndex: number, toIndex: number) => void;

  /* The row whose write is in flight; its actions are disabled while it is. */
  busyResourceId?: string | null | undefined;

  /* Rows past this are held back behind "Show more". */
  visibleCount: number;
  onShowMore: () => void;

  emptyState: ReactElement;
}

/*
 * The resources of one status page group, as the list they are.
 *
 * This used to be a ModelTable, mounted inside a row of a tree of other groups:
 * a card with its own title, description, create button and overflow menu, a
 * checkbox column, a sortable header and a pagination footer, all to show two
 * columns of at most a few dozen rows. Everything about that chrome was a
 * second, competing frame around content that was already inside one, and the
 * deeper the group sat the more it read as a page inside a page.
 *
 * What is actually being edited here is a short ordered list, and the order is
 * the point - it is the order visitors see. So it is drawn as an ordered list
 * with a grip on each row, and everything else (creating, filtering, the group
 * this belongs to) lives once, in the pane header above it.
 *
 * It is drawn in columns rather than as free floating rows. A dashboard pane is
 * as wide as the window, and a row holding one short name on the left and two
 * icons on the right leaves a metre of empty white between the thing and the
 * buttons that act on it - which is both ugly and a long way for the eye to
 * travel. So the row carries what an operator actually wants to compare down
 * the column: the position visitors see it in, the monitor, and the name it is
 * published under.
 */

/*
 * One set of column widths, used by the header and by every row, so the two
 * cannot drift apart. The published-name column takes the whole row on a phone
 * (basis-full) and shares the width from sm up, which keeps it a single element
 * rather than one copy per breakpoint.
 */
const GRIP_COLUMN_CLASS_NAME: string = "w-5 flex-shrink-0";
/*
 * Held back on a phone, where 24px of number costs a fifth of what is left for
 * the monitor's name and the rows are already in the order it describes.
 */
const POSITION_COLUMN_CLASS_NAME: string =
  "hidden w-6 flex-shrink-0 text-right text-xs tabular-nums sm:block";
const MONITOR_COLUMN_CLASS_NAME: string = "min-w-0 flex-[2_1_0%]";
/*
 * Its own line on a phone, indented to sit under the monitor it renames rather
 * than out beneath the grip; beside the monitor from sm up.
 *
 * order-last is what keeps the row's buttons up on the first line with the
 * monitor: a full width column wraps everything after it, and the buttons are
 * after it in the markup because that is the order they are read in.
 */
const PUBLISHED_NAME_COLUMN_CLASS_NAME: string =
  "order-last min-w-0 flex-[3_1_100%] pl-8 sm:order-none sm:flex-[3_1_0%] sm:pl-0";
const ACTIONS_COLUMN_CLASS_NAME: string =
  "flex w-[3.75rem] flex-shrink-0 items-center justify-end gap-0.5";

const ROW_CLASS_NAME: string =
  "group flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors";
const ResourceList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const visibleResources: Array<StatusPageResource> =
    props.statusPageResources.slice(0, props.visibleCount);

  const hiddenCount: number =
    props.statusPageResources.length - visibleResources.length;

  type RenderActionsFunction = (
    statusPageResource: StatusPageResource,
    index: number,
  ) => ReactElement;

  const renderActions: RenderActionsFunction = (
    statusPageResource: StatusPageResource,
    index: number,
  ): ReactElement => {
    const resourceId: string = statusPageResource._id?.toString() || "";
    const isBusy: boolean = props.busyResourceId === resourceId;
    const name: string =
      StatusPageResourceExplorerUtil.getResourceName(statusPageResource);

    const menuItems: Array<ReactElement> = [];

    if (props.isReorderable) {
      /*
       * The same move a drag makes, reachable from the keyboard and from a
       * touch screen - neither of which has anywhere to drag to.
       */
      menuItems.push(
        <MoreMenuItem
          key="move-up"
          text="Move up"
          icon={IconProp.ArrowUp}
          isDisabled={isBusy || index === 0}
          onClick={() => {
            props.onReorder(index, index - 1);
          }}
        />,
      );

      menuItems.push(
        <MoreMenuItem
          key="move-down"
          text="Move down"
          icon={IconProp.ArrowDown}
          isDisabled={isBusy || index === props.statusPageResources.length - 1}
          onClick={() => {
            props.onReorder(index, index + 1);
          }}
        />,
      );
    }

    menuItems.push(
      <MoreMenuItem
        key="show-id"
        text="Show ID"
        icon={IconProp.Info}
        onClick={() => {
          props.onShowId(statusPageResource);
        }}
      />,
    );

    if (props.isDeleteable) {
      menuItems.push(
        <MoreMenuItem
          key="delete"
          text="Remove from status page"
          icon={IconProp.Trash}
          className="text-red-600 enabled:hover:bg-red-50 enabled:hover:text-red-700"
          iconClassName="text-red-400 group-hover:text-red-500"
          isDisabled={isBusy}
          onClick={() => {
            props.onDelete(statusPageResource);
          }}
        />,
      );
    }

    return (
      <div
        className={ACTIONS_COLUMN_CLASS_NAME}
        data-testid="status-page-resource-row-actions"
      >
        {props.isEditable ? (
          <Button
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.ICON}
            icon={IconProp.Edit}
            title=""
            tooltip="Edit this resource"
            ariaLabel={`Edit ${name}`}
            dataTestId="status-page-resource-row-edit"
            disabled={isBusy}
            className="text-gray-400 hover:bg-gray-200 hover:text-gray-700"
            onClick={() => {
              props.onEdit(statusPageResource);
            }}
          />
        ) : (
          <></>
        )}

        <MoreMenu
          text={`More actions for ${name}`}
          menuIcon={IconProp.EllipsisHorizontal}
          isDisabled={isBusy}
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              aria-label={`More actions for ${name}`}
              data-testid="status-page-resource-row-more"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <Icon icon={IconProp.EllipsisHorizontal} className="h-5 w-5" />
            </button>
          }
        >
          {menuItems}
        </MoreMenu>
      </div>
    );
  };

  type RenderRowBodyFunction = (
    statusPageResource: StatusPageResource,
    index: number,
    dragHandle: ReactElement,
  ) => ReactElement;

  const renderRowBody: RenderRowBodyFunction = (
    statusPageResource: StatusPageResource,
    index: number,
    dragHandle: ReactElement,
  ): ReactElement => {
    const monitorName: string =
      StatusPageResourceExplorerUtil.getResourceName(statusPageResource);
    const displayName: string = statusPageResource.displayName || "";

    return (
      <>
        {dragHandle}

        {/*
         * The position visitors see this resource in. The order is the whole
         * point of this list, and until it was numbered the only way to read it
         * was to count rows.
         */}
        <span
          className={`${POSITION_COLUMN_CLASS_NAME} text-gray-400`}
          aria-hidden="true"
          data-testid="status-page-resource-row-position"
        >
          {index + 1}
        </span>

        <div className={MONITOR_COLUMN_CLASS_NAME}>
          <div
            /*
             * The monitor element draws its name inside a flex span (it may
             * carry an icon), and text-overflow does not reach the anonymous
             * item a flex container makes of its text - so a long name was
             * clipped mid-letter with no ellipsis. Laying that span out as a
             * block puts the name back in an inline formatting context, where
             * truncation means what it says.
             */
            className="truncate text-sm font-medium text-gray-900 [&_span]:block [&_span]:truncate"
            data-testid="status-page-resource-row-name"
          >
            {props.getResourceElement(statusPageResource)}
          </div>
        </div>

        {/*
         * The display name is what visitors actually read, so it gets a column
         * of its own rather than a second line under the monitor - but only a
         * value when it is not simply the monitor's own name repeated back.
         */}
        <div className={PUBLISHED_NAME_COLUMN_CLASS_NAME}>
          {displayName && displayName !== monitorName ? (
            <p
              className="truncate text-sm text-gray-500"
              title={displayName}
              data-testid="status-page-resource-row-display-name"
            >
              {displayName}
            </p>
          ) : (
            <p className="truncate text-sm text-gray-400">
              Same as the monitor name
            </p>
          )}
        </div>

        {renderActions(statusPageResource, index)}
      </>
    );
  };

  type RenderDragHandleFunction = (
    provided: DraggableProvided | null,
    statusPageResource: StatusPageResource,
  ) => ReactElement;

  const renderDragHandle: RenderDragHandleFunction = (
    provided: DraggableProvided | null,
    statusPageResource: StatusPageResource,
  ): ReactElement => {
    if (!props.isReorderable || !provided) {
      /*
       * The column stays so that a filtered list does not shift sideways the
       * moment a filter is typed.
       */
      return (
        <span className={`${GRIP_COLUMN_CLASS_NAME} h-5`} aria-hidden="true" />
      );
    }

    return (
      <span
        {...provided.dragHandleProps}
        className={`${GRIP_COLUMN_CLASS_NAME} flex h-6 cursor-grab items-center justify-center rounded text-gray-300 transition-colors hover:bg-gray-200 hover:text-gray-600 group-hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:cursor-grabbing`}
        data-testid="status-page-resource-row-drag-handle"
        aria-label={`Reorder ${StatusPageResourceExplorerUtil.getResourceName(
          statusPageResource,
        )}`}
      >
        <Icon icon={IconProp.Drag} className="h-4 w-4" />
      </span>
    );
  };

  type GetRowClassNameFunction = (
    isDragging: boolean,
    isBusy: boolean,
    isLastRow: boolean,
  ) => string;

  const getRowClassName: GetRowClassNameFunction = (
    isDragging: boolean,
    isBusy: boolean,
    isLastRow: boolean,
  ): string => {
    return `${ROW_CLASS_NAME} ${
      isDragging
        ? /*
           * bg-indigo-50 rather than bg-indigo-50/70: the dark theme remaps the
           * un-suffixed colour tokens and not the transparent ones, so an
           * opacity modifier leaves a light row in a dark list.
           *
           * A lifted row is rounded on all four corners because it is off the
           * list while it is being dragged; a settled one only rounds where the
           * container does, so its hover fill cannot square off the card's own
           * bottom corners.
           */
          "rounded-xl bg-indigo-50 shadow-md ring-1 ring-indigo-200"
        : `bg-white hover:bg-gray-50 ${isLastRow ? "rounded-b-xl" : ""}`
    } ${isBusy ? "opacity-60" : ""}`;
  };

  type IsLastRowFunction = (index: number) => boolean;

  /*
   * Only the bottom row of the whole card rounds its corners, and a card that
   * ends in a "show more" footer has no such row.
   */
  const isLastRow: IsLastRowFunction = (index: number): boolean => {
    return hiddenCount === 0 && index === visibleResources.length - 1;
  };

  type RenderHeaderFunction = () => ReactElement;

  /*
   * Column headings, from sm up. They are what makes the second column read as
   * "the name visitors see" rather than as a stray subtitle, and they are the
   * only place the position column can be explained at all.
   *
   * Below sm the published name wraps under the monitor instead of sitting
   * beside it, so a header row would be labelling columns that are not there.
   */
  const renderHeader: RenderHeaderFunction = (): ReactElement => {
    return (
      <div
        className="hidden items-center gap-x-3 rounded-t-xl border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:flex"
        data-testid="status-page-resource-list-header"
        aria-hidden="true"
      >
        <span className={GRIP_COLUMN_CLASS_NAME} />
        <span
          className={POSITION_COLUMN_CLASS_NAME}
          title="Position on the status page"
        >
          #
        </span>
        <span className={MONITOR_COLUMN_CLASS_NAME}>Monitor</span>
        <span className={PUBLISHED_NAME_COLUMN_CLASS_NAME}>
          Shown on the status page as
        </span>
        <span className={ACTIONS_COLUMN_CLASS_NAME} />
      </div>
    );
  };

  type RenderRowsFunction = () => ReactElement;

  const renderRows: RenderRowsFunction = (): ReactElement => {
    if (!props.isReorderable) {
      return (
        <div
          className="divide-y divide-gray-100"
          data-testid="status-page-resource-rows"
        >
          {visibleResources.map(
            (statusPageResource: StatusPageResource, index: number) => {
              const resourceId: string =
                statusPageResource._id?.toString() || `${index}`;

              return (
                <div
                  key={resourceId}
                  data-testid="status-page-resource-row"
                  data-resource-id={resourceId}
                  className={getRowClassName(
                    false,
                    props.busyResourceId === resourceId,
                    isLastRow(index),
                  )}
                >
                  {renderRowBody(
                    statusPageResource,
                    index,
                    renderDragHandle(null, statusPageResource),
                  )}
                </div>
              );
            },
          )}
        </div>
      );
    }

    return (
      <DragDropContext
        onDragEnd={(result: DropResult) => {
          if (!result.destination) {
            return;
          }

          props.onReorder(result.source.index, result.destination.index);
        }}
      >
        <Droppable droppableId={`status-page-resources-${props.listKey}`}>
          {(droppableProvided: DroppableProvided) => {
            return (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
                className="divide-y divide-gray-100"
                data-testid="status-page-resource-rows"
              >
                {visibleResources.map(
                  (statusPageResource: StatusPageResource, index: number) => {
                    const resourceId: string =
                      statusPageResource._id?.toString() || `${index}`;

                    return (
                      <Draggable
                        key={resourceId}
                        draggableId={resourceId}
                        index={index}
                        isDragDisabled={props.busyResourceId === resourceId}
                      >
                        {(
                          draggableProvided: DraggableProvided,
                          snapshot: DraggableStateSnapshot,
                        ) => {
                          return (
                            <div
                              ref={draggableProvided.innerRef}
                              {...draggableProvided.draggableProps}
                              data-testid="status-page-resource-row"
                              data-resource-id={resourceId}
                              className={getRowClassName(
                                snapshot.isDragging,
                                props.busyResourceId === resourceId,
                                isLastRow(index),
                              )}
                            >
                              {renderRowBody(
                                statusPageResource,
                                index,
                                renderDragHandle(
                                  draggableProvided,
                                  statusPageResource,
                                ),
                              )}
                            </div>
                          );
                        }}
                      </Draggable>
                    );
                  },
                )}
                {droppableProvided.placeholder}
              </div>
            );
          }}
        </Droppable>
      </DragDropContext>
    );
  };

  if (props.statusPageResources.length === 0) {
    return props.emptyState;
  }

  return (
    <div
      /*
       * One bordered card around the whole list rather than a border per row.
       * No overflow-hidden: a dragged row is moved with a transform, and a
       * clipping ancestor would cut it off the moment it left the list.
       */
      className="rounded-xl border border-gray-200 bg-white"
      data-testid="status-page-resource-list"
    >
      {renderHeader()}
      {renderRows()}

      {hiddenCount > 0 ? (
        <div
          className="rounded-b-xl border-t border-gray-100 bg-gray-50 px-4 py-2.5 text-center [&_button]:md:ml-0"
          data-testid="status-page-resource-list-show-more"
        >
          <Button
            title={`Show ${Math.min(
              hiddenCount,
              StatusPageResourceExplorerUtil.ResourceRowsPerPage,
            ).toLocaleString()} more of ${hiddenCount.toLocaleString()}`}
            icon={IconProp.ChevronDown}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={props.onShowMore}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ResourceList;
