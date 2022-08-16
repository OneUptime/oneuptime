import React, { FunctionComponent, ReactElement } from 'react';
import Item, { ListItem } from './Item';

export interface ComponentProps {
    items: Array<ListItem>;
    onCreateNewItem?: ((order: number) => void) | undefined;
    onEditItem?: ((item: ListItem) => void) | undefined;
    onClickItem?: ((item: ListItem) => void) | undefined;
    onDeleteItem?: ((item: ListItem) => void) | undefined;
    noItemsMessage?: string | undefined;
}

const OrderedStatesList: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            {props.items &&
                props.items.length > 0 &&
                props.items.map((item: ListItem, i: number) => {
                    return (
                        <div key={i}>
                            <Item
                                item={item}
                                onClick={(item: ListItem) => {
                                    props.onClickItem &&
                                        props.onClickItem(item);
                                }}
                                onEditClick={(item: ListItem) => {
                                    props.onEditItem && props.onEditItem(item);
                                }}
                                onDeleteClick={(item: ListItem) => {
                                    props.onDeleteItem &&
                                        props.onDeleteItem(item);
                                }}
                            />
                            <div className="vertical-list"></div>
                            {props.onCreateNewItem && (
                                <div>
                                    <Item
                                        onClick={(item: ListItem) => {
                                            props.onCreateNewItem &&
                                                props.onCreateNewItem(
                                                    parseInt(item.id)
                                                );
                                        }}
                                        item={{
                                            text: 'Create',
                                            id: i.toString(),
                                        }}
                                    />
                                    <div className="vertical-list"></div>
                                </div>
                            )}
                        </div>
                    );
                })}

            {!props.items ||
                (props.items.length === 0 && (
                    <p> {props.noItemsMessage || 'No items in this list.'}</p>
                ))}
        </div>
    );
};

export default OrderedStatesList;
