import React, { FunctionComponent, ReactElement } from 'react';
import Card from '../Card/Card';
import Table from './Table';
import { ComponentProps as TableComponentProps } from './Table';

export interface ComponentProps {
    title: string;
    description: string;
    headerButtons: Array<ReactElement>;
    tableProps: TableComponentProps
}

const TableRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Card
            title={props.title}
            description={props.description}
            buttons={props.headerButtons}
        >
            <Table {...props.tableProps} />
        </Card>
    );
};

export default TableRow;
