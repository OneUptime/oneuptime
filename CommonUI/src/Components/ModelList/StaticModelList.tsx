import BaseModel from 'Common/Models/BaseModel';
import Typeof from 'Common/Types/Typeof';
import React, { ReactElement } from 'react';
import Button, { ButtonStyleType } from '../Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import { DragDropContext, Draggable, DraggableProvided, DropResult, Droppable, DroppableProvided } from 'react-beautiful-dnd';
import Icon from '../Icon/Icon';

export interface ComponentProps<TBaseModel extends BaseModel> {
    list: Array<TBaseModel>;
    headerField?: string | ((item: TBaseModel) => ReactElement) | undefined;
    descriptionField?: string | undefined;
    selectedItems: Array<TBaseModel>;
    onClick: (item: TBaseModel) => void;
    titleField: string;
    onDelete?: ((item: TBaseModel) => void) | undefined;
    customElement?: ((item: TBaseModel) => ReactElement) | undefined;
    enableDragAndDrop?: boolean | undefined;
    dragAndDropScope?: string | undefined;
    dragDropIdField?: string | undefined;
    dragDropIndexField?: string | undefined;
    onDragDrop?: ((id: string, newIndex: number) => void) | undefined;
}

const StaticModelList: <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {

        const getRow = (model: TBaseModel, isSelected: boolean, provided?: DraggableProvided | undefined) => {
            return (<div
                onClick={() => {
                    props.onClick(model);
                }}
                className={`cursor-pointer mt-2 mb-2 flex justify-between items-center space-x-3 rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm focus-within:ring-2 focus-within:ring-pink-500 focus-within:ring-offset-2 hover:border-gray-400 ${isSelected ? 'ring ring-indigo-500' : ''
                    }`}
            >
                {props.enableDragAndDrop && (
                    <td
                        className="ml-5 w-10"
                        {...provided?.dragHandleProps}
                    >
                        <Icon
                            icon={IconProp.ArrowUpDown}
                            className="ml-6 h-5 w-5 text-gray-500 hover:text-indigo-800 m-auto cursor-ns-resize"
                        />
                    </td>
                )}
                {!props.customElement && <div className="min-w-0 flex-1">
                    <div className="focus:outline-none">
                        {props.headerField &&
                            typeof props.headerField ===
                            Typeof.String && (
                                <p className="text-sm font-medium text-gray-300">
                                    {
                                        model.getValue(
                                            props.headerField as string
                                        ) as string
                                    }
                                </p>
                            )}

                        {props.headerField &&
                            typeof props.headerField ===
                            'function' &&
                            props.headerField(model)}
                        <p className="text-sm font-medium text-gray-900">
                            {
                                model.getValue(
                                    props.titleField
                                ) as string
                            }
                        </p>
                        {props.descriptionField && (
                            <p className="truncate text-sm text-gray-500">
                                {
                                    model.getValue(
                                        props.descriptionField
                                    ) as string
                                }
                            </p>
                        )}
                    </div>
                </div>}

                {props.customElement && props.customElement(model)}

                {props.onDelete && <div>
                    <Button icon={IconProp.Trash} buttonStyle={ButtonStyleType.OUTLINE} title='Delete' onClick={() => {
                        props.onDelete && props.onDelete(model);
                    }} />
                </div>}
            </div>)
        }


        const getBody: Function = (provided?: DroppableProvided): ReactElement => {
            return (
                <div ref={provided?.innerRef}
                    {...provided?.droppableProps}>
                    {props.list &&
                        props.list.length > 0 &&
                        props.list.map((model: TBaseModel, i: number): ReactElement => {
                            const isSelected: boolean =
                                props.selectedItems.filter(
                                    (selectedItem: TBaseModel) => {
                                        return (
                                            selectedItem._id?.toString() ===
                                            model._id?.toString()
                                        );
                                    }
                                ).length > 0;

                            if (props.enableDragAndDrop) {
                                return (
                                    <Draggable
                                        draggableId={
                                            ((model as any)[props.dragDropIdField || ''] as string) || ''
                                        }
                                        index={
                                            ((model as any)[props.dragDropIndexField || 0] as number) || 0
                                        }
                                        key={((model as any)[props.dragDropIndexField || 0] as number) || 0}
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
        }

        const getComponent: Function = (): ReactElement => {
            if (props.enableDragAndDrop) {
                return (
                    <Droppable droppableId={props.dragAndDropScope || ''}>
                        {(provided: DroppableProvided) => {
                            return getBody(provided);
                        }}
                    </Droppable>
                );
            }

            return getBody();
        }

        return (<DragDropContext
            onDragEnd={(result: DropResult) => {
                result.destination?.index &&
                    props.onDragDrop &&
                    props.onDragDrop(
                        result.draggableId,
                        result.destination.index
                    );
            }}
        >
            {getComponent()}

        </DragDropContext>)


    };

export default StaticModelList;
