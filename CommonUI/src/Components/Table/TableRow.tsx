import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {}

const TableRow: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (
        <tr>
            <th scope="row">1</th>
            <td>Table cell</td>
            <td>Table cell</td>
            <td>Table cell</td>
            <td>Table cell</td>
            <td>Table cell</td>
            <td>Table cell</td>
        </tr>
    );
};

export default TableRow;
