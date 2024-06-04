import Button, { ButtonStyleType } from '../Button/Button';
import BaseModel from 'Common/Models/BaseModel';
import React, { ReactElement } from 'react';

export interface ComponentProps<TBaseModel extends BaseModel> {
    items: Array<TBaseModel>;
    getEachElement: (element: TBaseModel) => ReactElement;
    noItemsMessage: string | undefined;
    className?: string | undefined;
    moreText?: string | undefined;
}

const TableColumnListComponent: <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    if (!props.items || props.items.length === 0) {
        return <p>{props.noItemsMessage}</p>;
    }

    const firstThreeItems: Array<TBaseModel> = [];

    for (let i: number = 0; i < 3; i++) {
        if (props.items[i]) {
            firstThreeItems.push(props.items[i]!);
        }
    }

    // remaining items
    const remainingItems: Array<TBaseModel> = [];

    for (let i: number = 3; i < props.items.length; i++) {
        if (props.items[i]) {
            remainingItems.push(props.items[i]!);
        }
    }

    const [showMoreItems, setShowMoreItems] = React.useState<boolean>(false);

    return (
        <div className={props.className}>
            {firstThreeItems.map((item: TBaseModel, i: number) => {
                return <div key={i}>{props.getEachElement(item)}</div>;
            })}
            {showMoreItems ? (
                remainingItems.map((item: TBaseModel, i: number) => {
                    return <div key={i}>{props.getEachElement(item)}</div>;
                })
            ) : (
                <></>
            )}

            {remainingItems.length > 0 && !showMoreItems ? (
                <Button
                    className="-ml-3"
                    onClick={() => {
                        return setShowMoreItems(true);
                    }}
                    title={`${remainingItems.length} ${
                        props.moreText || 'more'
                    }`}
                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                />
            ) : (
                <></>
            )}

            {showMoreItems ? (
                <Button
                    className="-ml-3"
                    onClick={() => {
                        return setShowMoreItems(false);
                    }}
                    title="Show less"
                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                />
            ) : (
                <></>
            )}
        </div>
    );
};

export default TableColumnListComponent;
