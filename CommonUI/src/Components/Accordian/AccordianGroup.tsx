import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';

export interface ComponentProps {
    children: Array<ReactElement> | ReactElement;
}

const AccordianGroup: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div className="row accordian-group">{props.children}</div>;
};

export default AccordianGroup;
