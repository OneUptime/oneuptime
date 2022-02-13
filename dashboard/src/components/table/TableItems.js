import React, { Component } from 'react';
import TableItem from './TableItem';

export default class TableDescription extends Component {

    constructor(props) {
        super(props);
    }

    render() {
        const { items, columns, id, onClickTableRow, actionButtons } = this.props;

        return (
            <tbody id={id}>
                {items.map((item, i) => {
                    return (
                        <TableItem
                            onClick={onClickTableRow}
                            key={i}
                            item={item}
                            columns={columns}
                            actionButtons={actionButtons}
                        />
                    );
                })}
            </tbody>
        )
    }
}
