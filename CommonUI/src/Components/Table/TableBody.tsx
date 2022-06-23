import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: Array<ReactElement>;
}

const TableBody: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <tbody>{props.children}</tbody>;
};

export default TableBody;
