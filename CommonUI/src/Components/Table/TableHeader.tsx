import React, { FunctionComponent, ReactElement } from 'react';
import Columns from './Types/Columns';

export interface ComponentProps {
    columns: Columns;
    id: string;
}

const TableHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <thead>
            <tr>
                {props.columns.map((column, i) => {
                    return <th key={i}>{column.title}</th>
                })}
            </tr>
        </thead>
    );
};

export default TableHeader;
