import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import Field from "../Detail/Field";
import ListRow, { ListDetailProps } from "./ListRow";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";
import { Droppable, DroppableProvided } from "react-beautiful-dnd";

export interface ComponentProps<T extends GenericObject> {
  data: Array<T>;
  id: string;
  fields: Array<Field<T>>;
  actionButtons?: undefined | Array<ActionButtonSchema<T>> | undefined;
  enableDragAndDrop?: undefined | boolean;
  dragAndDropScope?: string | undefined;
  dragDropIdField?: keyof T | undefined;
  dragDropIndexField?: keyof T | undefined;
  isDragDisabled?: boolean | undefined;
  dragDisabledReason?: string | undefined;
  itemToString?: ((item: T) => string) | undefined;
  listDetailOptions?: undefined | ListDetailProps;
}

type ListBodyFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const ListBody: ListBodyFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  type GetBodyFunction = (provided?: DroppableProvided) => ReactElement;

  const getBody: GetBodyFunction = (
    provided?: DroppableProvided,
  ): ReactElement => {
    return (
      <div
        ref={provided?.innerRef}
        {...provided?.droppableProps}
        id={props.id}
        className="space-y-6 p-6 border-t border-gray-200"
      >
        {props.data &&
          props.data.map((item: T, i: number) => {
            // Keyed by id when cards move, so each keeps its own state.
            const id: string | undefined =
              props.enableDragAndDrop && props.dragDropIdField
                ? item[props.dragDropIdField]?.toString()
                : undefined;

            return (
              <ListRow
                key={id || i}
                item={item}
                fields={props.fields}
                actionButtons={props.actionButtons}
                dragAndDropScope={props.dragAndDropScope}
                enableDragAndDrop={props.enableDragAndDrop}
                dragDropIdField={props.dragDropIdField}
                dragDropIndexField={props.dragDropIndexField}
                dragIndex={i}
                isDragDisabled={props.isDragDisabled}
                dragDisabledReason={props.dragDisabledReason}
                itemLabel={props.itemToString?.(item)}
                listDetailOptions={props.listDetailOptions}
              />
            );
          })}
        {provided?.placeholder}
      </div>
    );
  };

  if (props.enableDragAndDrop) {
    return (
      <Droppable droppableId={props.dragAndDropScope || ""}>
        {(provided: DroppableProvided) => {
          return getBody(provided);
        }}
      </Droppable>
    );
  }

  return getBody();
};

export default ListBody;
