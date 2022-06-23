import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps{

}

const TableHeader: FunctionComponent<ComponentProps> = (_props: ComponentProps): ReactElement => {
    return (<thead>
        <tr>
            <th>#</th>
            <th>Table heading</th>
            <th>Table heading</th>
            <th>Table heading</th>
            <th>Table heading</th>
            <th>Table heading</th>
            <th>Table heading</th>
        </tr>
    </thead>)
}

export default TableHeader;

