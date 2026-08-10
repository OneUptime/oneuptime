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
 */
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
        className="flex flex-shrink-0 items-center gap-0.5"
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

        <div className="min-w-0 flex-1">
          <div
            className="truncate text-sm font-medium text-gray-900"
            data-testid="status-page-resource-row-name"
          >
            {props.getResourceElement(statusPageResource)}
          </div>

          {/*
           * The display name is what visitors read, so it only earns a line
           * when it is not simply the monitor's own name repeated back.
           */}
          {displayName && displayName !== monitorName ? (
            <p
              className="mt-0.5 truncate text-xs text-gray-500"
              title={displayName}
              data-testid="status-page-resource-row-display-name"
            >
              Shown as “{displayName}”
            </p>
          ) : (
            <></>
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
      return <span className="h-5 w-5 flex-shrink-0" aria-hidden="true" />;
    }

    return (
      <span
        {...provided.dragHandleProps}
        className="flex h-5 w-5 flex-shrink-0 cursor-grab items-center justify-center rounded text-gray-300 transition-colors hover:bg-gray-200 hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:cursor-grabbing"
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
  ) => string;

  const getRowClassName: GetRowClassNameFunction = (
    isDragging: boolean,
    isBusy: boolean,
  ): string => {
    return `group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
      isDragging
        ? /*
           * bg-indigo-50 rather than bg-indigo-50/70: the dark theme remaps the
           * un-suffixed colour tokens and not the transparent ones, so an
           * opacity modifier leaves a light row in a dark list.
           */
          "border-indigo-200 bg-indigo-50 shadow-md"
        : "border-transparent bg-white hover:border-gray-200 hover:bg-gray-50"
    } ${isBusy ? "opacity-60" : ""}`;
  };

  type RenderRowsFunction = () => ReactElement;

  const renderRows: RenderRowsFunction = (): ReactElement => {
    if (!props.isReorderable) {
      return (
        <div className="space-y-0.5" data-testid="status-page-resource-rows">
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
                className="space-y-0.5"
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
    <div data-testid="status-page-resource-list">
      {renderRows()}

      {hiddenCount > 0 ? (
        <div
          className="pt-3 text-center"
          data-testid="status-page-resource-list-show-more"
        >
          <Button
            title={`Show ${Math.min(
              hiddenCount,
              StatusPageResourceExplorerUtil.ResourceRowsPerPage,
            ).toLocaleString()} more of ${hiddenCount.toLocaleString()}`}
            icon={IconProp.ChevronDown}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
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
