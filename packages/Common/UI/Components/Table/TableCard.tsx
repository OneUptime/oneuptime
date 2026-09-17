import Card, { CardButtonSchema } from "../Card/Card";
import Table, { ComponentProps as TableComponentProps } from "./Table";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  title: string;
  description: string;
  headerButtons: Array<CardButtonSchema>;
  tableProps: TableComponentProps<T>;
}

type TableRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TableCard: TableRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
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

export default TableCard;
