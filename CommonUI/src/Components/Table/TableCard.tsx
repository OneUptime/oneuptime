import React, { ReactElement } from 'react';
import Card, { CardButtonSchema } from '../Card/Card';
import Table, { ComponentProps as TableComponentProps } from './Table';
import GenericObject from 'Common/Types/GenericObject';

export interface ComponentProps<T extends GenericObject> {
    title: string;
    description: string;
    headerButtons: Array<CardButtonSchema>;
    tableProps: TableComponentProps<T>;
}

type TableRowFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const TableRow: TableRowFunction = <T extends GenericObject>(
    props: ComponentProps<T>
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
