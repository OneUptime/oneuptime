import React, { FunctionComponent, ReactElement } from 'react';

export interface Tab {
    name: string;
    children: ReactElement;
}

export interface ComponentProps {
    tab: Tab;
    onClick?: () => void;
    isSelected?: boolean;
}

const TabElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-3 mb-3">
            <div
                key={props.tab.name}
                onClick={props.onClick}
                className={`${
                    (props.isSelected
                        ? 'bg-gray-100 text-gray-700'
                        : 'text-gray-500 hover:text-gray-700') +
                    ' rounded-md px-3 py-2 text-sm font-medium cursor-pointer'
                }`}
                aria-current={props.isSelected ? 'page' : undefined}
            >
                {props.tab.name}
            </div>
        </div>
    );
};

export default TabElement;
