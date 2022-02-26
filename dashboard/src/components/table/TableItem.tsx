import React, { Component } from 'react';
import TableActionButton from './TableActionButtons';
import TableItemColumnData from './TableItemColumnData';
import PropTypes from 'prop-types';
export default class TableItem extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ item: any; column: any; }' is not assignab... Remove this comment to see the full error message
                                    item={item}
                                    column={column}
                                />
                            );
                        } else {
                            return <></>;
                        }
                    })}

                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ actionButtons: any; item: any; }' is not a... Remove this comment to see the full error message
                <TableActionButton actionButtons={actionButtons} item={item} />
            </tr>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableItem.propTypes = {
    item: PropTypes.object.isRequired,
    onClick: PropTypes.func,
    columns: PropTypes.array,
    actionButtons: PropTypes.array,
};
