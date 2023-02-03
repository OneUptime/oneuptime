import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const IconDropdown: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div
            className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none transform opacity-100 scale-100"
            role="menu"
            aria-orientation="vertical"
            aria-labelledby="user-menu-button"
        >
            {props.children}
        </div>
    );
};

export default IconDropdown;
