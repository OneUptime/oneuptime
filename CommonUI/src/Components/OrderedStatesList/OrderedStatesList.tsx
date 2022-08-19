import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import Icon, { IconProp } from '../Icon/Icon';
import Item from './Item';

export interface ComponentProps {
    data: Array<JSONObject>;
    onCreateNewItem?: ((order: number) => void) | undefined;
    noItemsMessage?: string | undefined;
    error?: string | undefined;
    isLoading?: boolean | undefined;
    onRefreshClick?: (() => void) | undefined;
    singularLabel: string;
    pluralLabel: string;
    id?: string;
    actionButtons?: undefined | Array<ActionButtonSchema>;
    titleField: string; 
    descriptionField?: string | undefined;
    orderField: string;
}

const OrderedStatesList: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    if (props.isLoading) {
        return (
            <ComponentLoader />
        );
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
        <div>

            {props.error && <p>{props.error}</p>}
            {!props.error && props.data &&
                props.data.length > 0 &&
                props.data.map((item: JSONObject, i: number) => {
                    return (
                        <div key={i} id={props.id}>
                            <Item
                                item={item}
                                titleField={props.titleField}
                                descriptionField={props.descriptionField}
                                actionButtons={props.actionButtons}
                            />
                            <div className="vertical-list"></div>
                            {props.onCreateNewItem && (
                                <div>
                                    <div className='poointer' onClick={() => {
                                        props.onCreateNewItem && props.onCreateNewItem(item[props.orderField] ? (item[props.orderField] as number + 1) : 0);
                                    }}>
                                        <Icon icon={IconProp.Add} /> Add Item
                                    </div>
                                    <div className="vertical-list"></div>
                                </div>
                            )}
                        </div>
                    );
                })}
        </div>
    );
};

export default OrderedStatesList;
