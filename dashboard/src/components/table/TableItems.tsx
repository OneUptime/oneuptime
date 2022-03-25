import React, { Component } from 'react';
import TableItem from './TableItem';
import PropTypes from 'prop-types';

interface TableItemsProps {
    columns: unknown[];
    items: unknown[];
    id?: string;
    onClickTableRow?: Function;
    actionButtons?: unknown[];
}

export default class TableItems extends Component<TableItemsProps> {
    constructor(props: $TSFixMe) {
        super(props);
    }

    override render() {
        const {

            items,

            columns,

            id,

            onClickTableRow,

            actionButtons,
        } = this.props;

        return (
            <tbody id={id}>
                {items.map((item: $TSFixMe, i: $TSFixMe) => {
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
