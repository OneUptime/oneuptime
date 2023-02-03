import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const IconDropdownRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div>{props.children}</div>;
};

export default IconDropdownRow;
