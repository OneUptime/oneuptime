import { GetReactElementFunction } from "../../Types/FunctionTypes";
import Button, { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import Typeof from "../../../Types/Typeof";
import React, { ReactElement } from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  DropResult,
  Droppable,
  DroppableProvided,
} from "react-beautiful-dnd";

// Every row of the list: a button, unless it has a Delete button of its own.
export const MODEL_LIST_ROW_TEST_ID: string = "model-list-row";

export interface ComponentProps<TBaseModel extends BaseModel> {
  list: Array<TBaseModel>;
  headerField?: string | ((item: TBaseModel) => ReactElement) | undefined;
  descriptionField?: string | undefined;
  selectedItems: Array<TBaseModel>;
  onClick: (item: TBaseModel) => void;
  titleField: string;
  onDelete?: ((item: TBaseModel) => void) | undefined;
  /*
   * When set, the row Delete buttons stay on screen but are locked, and say
   * this on hover.
   */
  deleteDisabledReason?: string | undefined;
  customElement?: ((item: TBaseModel) => ReactElement) | undefined;
  enableDragAndDrop?: boolean | undefined;
  dragAndDropScope?: string | undefined;
  dragDropIdField?: keyof TBaseModel | undefined;
  dragDropIndexField?: keyof TBaseModel | undefined;
  // Positions in `list`; never called for a drop that moved nothing.
  onDragDrop?:
    | ((id: string, destinationIndex: number, sourceIndex: number) => void)
    | undefined;
}

const StaticModelList: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  type GetRowFunction = (
    model: TBaseModel,
    isSelected: boolean,
    provided?: DraggableProvided | undefined,
  ) => ReactElement;

  const getRow: GetRowFunction = (
    model: TBaseModel,
    isSelected: boolean,
    provided?: DraggableProvided | undefined,
  ): ReactElement => {
    const choose: () => void = (): void => {
      props.onClick(model);
    };

    /*
     * A row is a choice - a sign-in page's provider, a record a dialog
     * picks - so it is a button the keyboard reaches and Enter or Space
     * presses, with the theme's focus ring. It was a box only a mouse could
     * click: a keyboard skipped every provider on a single sign-on page. A
     * row with a Delete button of its own keeps the plain click, so no
     * control sits inside another.
     */
    const rowControlProps: React.HTMLAttributes<HTMLDivElement> = props.onDelete
      ? {}
      : {
          role: "button",
          tabIndex: 0,
          "aria-pressed": isSelected,
          onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>): void => {
            if (event.target !== event.currentTarget) {
              return;
            }

            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              choose();
            }
          },
        };

    return (
      <div
        onClick={choose}
        {...rowControlProps}
        {...provided?.draggableProps}
        ref={provided?.innerRef}
        className={`cursor-pointer mt-2 mb-2 flex justify-between items-center space-x-3 rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 hover:border-gray-400 ${
          isSelected ? "ring ring-indigo-500" : ""
        }`}
        data-testid={MODEL_LIST_ROW_TEST_ID}
      >
        {/*
         * The row's words take the room the row has (min-w-0): a long
         * description used to run out past the row's edge instead of
         * wrapping in it.
         */}
        <div className="flex min-w-0 flex-1">
          {props.enableDragAndDrop && (
            <div
              className="mr-5 mt-2 -ml-5 w-10"
              {...provided?.dragHandleProps}
            >
              <Icon
                icon={IconProp.ArrowUpDown}
                className="ml-6 h-5 w-5 text-gray-500 hover:text-indigo-800 m-auto cursor-ns-resize"
              />
            </div>
          )}
          {!props.customElement && (
            <div className="min-w-0 flex-1">
              <div className="focus:outline-none">
                {props.headerField &&
                  typeof props.headerField === Typeof.String && (
                    <p className="text-sm font-medium text-gray-300">
                      {model.getValue(props.headerField as string) as string}
                    </p>
                  )}

                {props.headerField &&
                  typeof props.headerField === "function" &&
                  props.headerField(model)}
                <p className="break-words text-sm font-medium text-gray-900">
                  {model.getValue(props.titleField) as string}
                </p>
                {/*
                 * Up to two lines, then an ellipsis: a description is read
                 * to choose a row (which single sign-on provider is mine),
                 * and one line ran out of the row mid-word.
                 */}
                {props.descriptionField && (
                  <p className="line-clamp-2 break-words text-sm text-gray-500">
                    {model.getValue(props.descriptionField) as string}
                  </p>
                )}
              </div>
            </div>
          )}

          {props.customElement?.(model)}
        </div>

        {props.onDelete && (
          <div>
            <Button
              icon={IconProp.Trash}
              buttonStyle={ButtonStyleType.OUTLINE}
              title="Delete"
              disabled={Boolean(props.deleteDisabledReason)}
              tooltip={props.deleteDisabledReason}
              onClick={() => {
                if (props.deleteDisabledReason) {
                  return;
                }

                props.onDelete?.(model);
              }}
            />
          </div>
        )}
      </div>
    );
  };

  type GetBodyFunction = (
    provided?: DroppableProvided | undefined,
  ) => ReactElement;

  const getBody: GetBodyFunction = (
    provided?: DroppableProvided,
  ): ReactElement => {
    return (
      <div ref={provided?.innerRef} {...provided?.droppableProps}>
        {props.list &&
          props.list.length > 0 &&
          props.list.map((model: TBaseModel, i: number): ReactElement => {
            const isSelected: boolean =
              props.selectedItems.filter((selectedItem: TBaseModel) => {
                return selectedItem._id?.toString() === model._id?.toString();
              }).length > 0;

            if (props.enableDragAndDrop) {
              return (
                <Draggable
                  draggableId={
                    (model as any)[props.dragDropIdField || ""]?.toString() ||
                    ""
                  }
                  /*
                   * The row's place on screen, not its stored order: the
                   * Draggable index must run 0, 1, 2... with no gaps.
                   */
                  index={i}
                  key={
                    (model as any)[props.dragDropIdField || ""]?.toString() || i
                  }
                >
                  {(provided: DraggableProvided) => {
                    return getRow(model, isSelected, provided);
                  }}
                </Draggable>
              );
            }

            return <div key={i}>{getRow(model, isSelected)}</div>;
          })}
        {provided?.placeholder}
      </div>
    );
  };

  const getComponent: GetReactElementFunction = (): ReactElement => {
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

  return (
    <DragDropContext
      onDragEnd={(result: DropResult) => {
        // Index 0 is the top of the list: a drop there is a real move.
        if (
          !props.onDragDrop ||
          !result.destination ||
          result.destination.index === result.source.index
        ) {
          return;
        }

        props.onDragDrop(
          result.draggableId,
          result.destination.index,
          result.source.index,
        );
      }}
    >
      {getComponent()}
    </DragDropContext>
  );
};

export default StaticModelList;
