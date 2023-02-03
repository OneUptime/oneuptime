import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type { CardButtonSchema } from '../Card/Card';
import Card from '../Card/Card';
import type { ComponentProps as TableComponentProps } from './Table';
import Table from './Table';

export interface ComponentProps {
    title: string;
    description: string;
    headerButtons: Array<CardButtonSchema>;
    tableProps: TableComponentProps;
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
