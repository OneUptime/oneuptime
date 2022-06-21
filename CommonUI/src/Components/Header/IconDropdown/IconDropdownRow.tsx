import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const IconDropdownRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div className="no-gutters row">{props.children}</div>;
};

export default IconDropdownRow;
