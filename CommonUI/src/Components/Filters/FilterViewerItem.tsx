import React, { ReactElement } from 'react';

export interface ComponentProps {
    text: string;
}

type FilterViewerItemComponentFunction = (
    props: ComponentProps
) => ReactElement;

const FilterViewerItem: FilterViewerItemComponentFunction = (
    props: ComponentProps
): ReactElement => {
    const { text } = props;

    return (
        <div className="flex w-full -ml-3">
            <div className="flex">
                <div className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                    <span className="font-medium text-gray-900">{text}</span>{' '}
                </div>
            </div>
        </div>
    );
};

export default FilterViewerItem;
