import React, { Component } from 'react';
import TableItem from './TableItem';
import PropTypes from 'prop-types';

export default class TableItems extends Component {
    constructor(props) {
        super(props);
    }

    render() {
        const {
            items,
            columns,
            id,
            onClickTableRow,
            actionButtons,
        } = this.props;

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
        );
    }
}

TableItems.propTypes = {
    columns: PropTypes.array.isRequired,
    items: PropTypes.array.isRequired,
    id: PropTypes.string,
    onClickTableRow: PropTypes.func,
    actionButtons: PropTypes.array,
};
