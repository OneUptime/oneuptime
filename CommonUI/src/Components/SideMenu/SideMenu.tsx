import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const SideMenu: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    let children: Array<ReactElement> = [];
    if (!Array.isArray(props.children)) {
        children = [props.children];
    } else {
        children = props.children;
    }

    return (
        <aside className="py-6 px-2 sm:px-6 lg:col-span-2 md:col-span-3 lg:py-0 lg:px-0 mb-10">
            <nav className="space-y-3">
                {children.map((child: ReactElement) => {
                    return child;
                })}
            </nav>
        </aside>
    );
};

export default SideMenu;
