import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    title: string;
    children: ReactElement | Array<ReactElement>;
}

const SideMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    return (
        <>
            <h6 className="text-sm text-gray-500">{props.title}</h6>
            <div>{props.children}</div>
        </>
    );
};

export default SideMenuItem;
