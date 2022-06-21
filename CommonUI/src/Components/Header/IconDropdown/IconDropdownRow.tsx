import React, { ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const IconDropdownRow = (props: ComponentProps) => {
    return <div className="no-gutters row">{props.children}</div>;
};

export default IconDropdownRow;
