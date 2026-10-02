import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import RowActions from "../ActionButton/RowActions";
import Detail from "../Detail/Detail";
import Field from "../Detail/Field";
import DragHandle from "../Table/DragHandle";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useState, useEffect } from "react";
import {
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
} from "react-beautiful-dnd";

export interface ListDetailProps {
  showDetailsInNumberOfColumns?: number | undefined;
}

export interface ComponentProps<T extends GenericObject> {
  item: T;
  fields: Array<Field<T>>;
  actionButtons?: Array<ActionButtonSchema<T>> | undefined;
  enableDragAndDrop?: boolean | undefined;
  dragAndDropScope?: string | undefined;
  dragDropIdField?: keyof T | undefined;
  dragDropIndexField?: keyof T | undefined;
  // Where the card is in the list on screen: the Draggable's index.
  dragIndex?: number | undefined;
  isDragDisabled?: boolean | undefined;
  dragDisabledReason?: string | undefined;
  // What the card is, for its grip's accessible name.
  itemLabel?: string | undefined;
  listDetailOptions?: ListDetailProps | undefined;
}

type ListRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const ListRow: ListRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  // Track mobile view for responsive behavior
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  type GetRowFunction = (
    provided?: DraggableProvided,
    snapshot?: DraggableStateSnapshot,
  ) => ReactElement;

  const getRow: GetRowFunction = (
    provided?: DraggableProvided,
    snapshot?: DraggableStateSnapshot,
  ): ReactElement => {
    return (
      <div
        {...provided?.draggableProps}
        ref={provided?.innerRef}
        className={`bg-white px-4 py-6 sm:rounded-lg sm:px-6 ${
          snapshot?.isDragging ? "shadow-lg ring-1 ring-gray-200" : "shadow"
        }`}
      >
        <div>
          {props.enableDragAndDrop && (
            <div className="flex">
              <div className="-ml-2 mr-2 flex w-8 flex-none justify-center">
                <DragHandle
                  dragHandleProps={provided?.dragHandleProps}
                  itemLabel={props.itemLabel}
                  isDisabled={props.isDragDisabled}
                  disabledReason={props.dragDisabledReason}
                />
              </div>
              <Detail
                item={props.item}
                fields={props.fields}
                showDetailsInNumberOfColumns={
                  props.listDetailOptions?.showDetailsInNumberOfColumns || 1
                }
              />
            </div>
          )}
          {!props.enableDragAndDrop && (
            <Detail
              item={props.item}
              fields={props.fields}
              showDetailsInNumberOfColumns={
                props.listDetailOptions?.showDetailsInNumberOfColumns || 1
              }
            />
          )}
        </div>

        <div className={props.enableDragAndDrop ? `mt-5 ml-8` : `mt-5`}>
          <RowActions<T>
            item={props.item}
            actionButtons={props.actionButtons}
            isMobile={isMobile}
            className="justify-start"
          />
        </div>
      </div>
    );
  };

  if (props.enableDragAndDrop && props.dragDropIdField) {
    return (
      <Draggable
        draggableId={props.item[props.dragDropIdField]?.toString() || ""}
        index={props.dragIndex || 0}
        isDragDisabled={Boolean(props.isDragDisabled)}
      >
        {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => {
          return getRow(provided, snapshot);
        }}
      </Draggable>
    );
  }

  return getRow();
};

export default ListRow;
