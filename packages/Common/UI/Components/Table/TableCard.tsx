import Card, { CardButtonSchema } from "../Card/Card";
import Table, { ComponentProps as TableComponentProps } from "./Table";
import { getTableHeaderButtons } from "./TableHeaderControls";
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

/*
 * A table in a card, with the header every table has: the title and its
 * controls on one line, the description under both, and the buttons as a
 * model table draws them - the main one in sight, the rest in the ⋯
 * (getTableHeaderButtons).
 */
const TableCard: TableRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  return (
    <Card
      title={props.title}
      description={props.description}
      headerLayout="toolbar"
      buttons={getTableHeaderButtons(props.headerButtons)}
    >
      <Table {...props.tableProps} />
    </Card>
  );
};

export default TableCard;
