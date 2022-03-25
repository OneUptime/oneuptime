import React, { Component } from 'react';
import TableActionButton from './TableActionButtons';
import TableItemColumnData from './TableItemColumnData';
import PropTypes from 'prop-types';

interface TableItemProps {
    item: object;
    onClick?: Function;
    columns?: unknown[];
    actionButtons?: unknown[];
}

export default class TableItem extends Component<TableItemProps> {
    constructor(props: $TSFixMe) {
        super(props);
    }

    override render() {

        const { item, columns, onClick, actionButtons } = this.props;

        return (
            <tr
                className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink statusPageListItem"
                onClick={() => onClick && onClick(item)}
            >
                {columns &&
                    columns.map((column: $TSFixMe) => {
                        if (!column.isActionColumn) {
                            return (
                                <TableItemColumnData

                                    item={item}
                                    column={column}
                                />
                            );
                        } else {
                            return <></>;
                        }
                    })}


                <TableActionButton actionButtons={actionButtons} item={item} />
            </tr>
        );
    }
}


TableItem.propTypes = {
    item: PropTypes.object.isRequired,
    onClick: PropTypes.func,
    columns: PropTypes.array,
    actionButtons: PropTypes.array,
};
