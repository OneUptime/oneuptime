import React, { FunctionComponent, ReactElement } from 'react';
import Column from './Types/Column';
import Columns from './Types/Columns';

export interface ComponentProps {
    columns: Columns;
    id: string;
}

const TableHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <thead id={props.id}>
            <tr>
                {props.columns.map((column: Column, i: number) => {
                    return <th key={i}>{column.title}</th>;
                })}
            </tr>
        </thead>
    );
};

export default TableHeader;
