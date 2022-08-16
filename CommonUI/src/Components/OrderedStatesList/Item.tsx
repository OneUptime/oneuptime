import React, { FunctionComponent, ReactElement } from 'react';

export interface ListItem {
    id: string;
    text: string;
}

export interface ComponentProps {
    item: ListItem;
    onClick?: ((item: ListItem) => void) | undefined;
    onEditClick?: ((item: ListItem) => void) | undefined;
    onDeleteClick?: ((item: ListItem) => void) | undefined;
}

const Item: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div
            onClick={() => {
                props.onClick && props.onClick(props.item);
            }}
        >
            <div>{props.item.text}</div>
            <div>
                {props.onEditClick && (
                    <div
                        onClick={() => {
                            props.onEditClick && props.onEditClick(props.item);
                        }}
                    >
                        Edit
                    </div>
                )}
                {props.onDeleteClick && (
                    <div
                        onClick={() => {
                            props.onDeleteClick &&
                                props.onDeleteClick(props.item);
                        }}
                    >
                        Delete
                    </div>
                )}
            </div>
        </div>
    );
};

export default Item;
