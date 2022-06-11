import React, { ReactElement, FunctionComponent } from 'react';
import '../../Table/Table.scss';

export interface ComponentProps {
    children: Array<ReactElement> | ReactElement;
}

const Pagination: FunctionComponent<ComponentProps> = ({
    children,
}: ComponentProps): ReactElement => {
    return <div className="pager">{children}</div>;
};

export default Pagination;
