import React, { FC, ReactElement } from 'react';
import '../../Table/Table.scss';

export interface ComponentProps {
    children: Array<ReactElement> | ReactElement;
}

const Pagination: FC<ComponentProps> = ({ children }): ReactElement => {
    return <div className="pager">{children}</div>;
};

export default Pagination;
