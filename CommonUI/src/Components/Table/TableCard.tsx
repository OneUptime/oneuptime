import React, { FunctionComponent, ReactElement } from "react";
import Card from "../Card/Card";
import Table from "./Table";

export interface ComponentProps{
    title: string;
    description: string;
    headerButtons: Array<ReactElement>;
}

const TableRow: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
    return (<Card
        title={props.title}
        description={props.description}
        buttons={props.headerButtons}
    >
        <Table/>
        
    </Card>)
}

export default TableRow;
