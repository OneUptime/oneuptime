import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import Icon, { IconProp, SizeProp, ThickProp } from '../Icon/Icon';
import Item from './Item';

export interface ComponentProps {
    data: Array<JSONObject>;
    onCreateNewItem?: ((order: number) => void) | undefined;
    noItemsMessage?: string | undefined;
    error?: string | undefined;
    isLoading?: boolean | undefined;
    onRefreshClick?: (() => void) | undefined;
    singularLabel: string;
    id?: string;
    actionButtons?: undefined | Array<ActionButtonSchema>;
    titleField: string;
    descriptionField?: string | undefined;
    orderField: string;
    getTitleElement?: ((item: JSONObject) => ReactElement) | undefined;
    getDescriptionElement?: ((item: JSONObject) => ReactElement) | undefined;
    shouldAddItemInTheEnd?: boolean | undefined;
    shouldAddItemInTheBegining?: boolean | undefined;
}

const OrderedStatesList: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.isLoading) {
        return <ComponentLoader />;
    }

    if (props.error) {
        return (
            <ErrorMessage
                error={props.error}
                onRefreshClick={props.onRefreshClick}
            />
        );
    }

    if (props.data.length === 0) {
        return (
            <ErrorMessage
                error={
                    props.noItemsMessage
                        ? props.noItemsMessage
                        : `No ${props.singularLabel.toLocaleLowerCase()}`
                }
                onRefreshClick={props.onRefreshClick}
            />
        );
    }

    return (
        <div className="margin-50">
            {props.error && <p>{props.error}</p>}
            {!props.error &&
                props.data &&
                props.data.length > 0 &&
                props.data.map((item: JSONObject, i: number) => {
                    const isEnd: boolean = !(i + 1 < props.data.length);
                    const isBegining: boolean = !(i === 0);

                    return (
                        <div key={i} id={props.id}>
                            {props.onCreateNewItem &&
                                isBegining &&
                                props.shouldAddItemInTheBegining && (
                                    <div>
                                        <div
                                            className="pointer ordered-list-item ordered-list-item-add-button background-very-light-grey-on-hover"
                                            onClick={() => {
                                                props.onCreateNewItem &&
                                                    props.onCreateNewItem(
                                                        item[props.orderField]
                                                            ? (item[
                                                                  props
                                                                      .orderField
                                                              ] as number) + 1
                                                            : 0
                                                    );
                                            }}
                                        >
                                            <div className="flex text-center ">
                                                <Icon
                                                    icon={IconProp.Add}
                                                    thick={ThickProp.Thick}
                                                    className="margin-side-5"
                                                />{' '}
                                                Add New Item
                                            </div>
                                        </div>

                                        <div className="vertical-list text-center margin-30">
                                            <Icon
                                                icon={IconProp.ChevronDown}
                                                thick={ThickProp.Thick}
                                                size={SizeProp.Larger}
                                            />
                                        </div>
                                    </div>
                                )}
                            <Item
                                item={item}
                                titleField={props.titleField}
                                descriptionField={props.descriptionField}
                                actionButtons={props.actionButtons}
                                getTitleElement={props.getTitleElement}
                                getDescriptionElement={
                                    props.getDescriptionElement
                                }
                            />
                            {((isEnd && props.shouldAddItemInTheEnd) ||
                                !isEnd) && (
                                <div className="vertical-list text-center margin-30">
                                    <Icon
                                        icon={IconProp.ChevronDown}
                                        thick={ThickProp.Thick}
                                        size={SizeProp.Larger}
                                    />
                                </div>
                            )}
                            {props.onCreateNewItem &&
                                ((isEnd && props.shouldAddItemInTheEnd) ||
                                    !isEnd) && (
                                    <div>
                                        <div
                                            className="pointer ordered-list-item ordered-list-item-add-button background-very-light-grey-on-hover"
                                            onClick={() => {
                                                props.onCreateNewItem &&
                                                    props.onCreateNewItem(
                                                        item[props.orderField]
                                                            ? (item[
                                                                  props
                                                                      .orderField
                                                              ] as number) + 1
                                                            : 0
                                                    );
                                            }}
                                        >
                                            <div className="flex text-center ">
                                                <Icon
                                                    icon={IconProp.Add}
                                                    thick={ThickProp.Thick}
                                                    className="margin-side-5"
                                                />{' '}
                                                Add New Item
                                            </div>
                                        </div>
                                        {!isEnd && (
                                            <div className="vertical-list text-center margin-30">
                                                <Icon
                                                    icon={IconProp.ChevronDown}
                                                    thick={ThickProp.Thick}
                                                    size={SizeProp.Larger}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                        </div>
                    );
                })}
        </div>
    );
};

export default OrderedStatesList;
