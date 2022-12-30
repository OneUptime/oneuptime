import React, { FunctionComponent, ReactElement } from 'react';
import Card, { CardButtonSchema } from '../Card/Card';
import Table, { ComponentProps as TableComponentProps } from './Table';

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
