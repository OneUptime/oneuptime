import React, { Component } from 'react';
import TableColumn from './TableColumn';
import PropTypes from 'prop-types';
export default class TableColumns extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'columns' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { columns } = this.props;

        return (
            <thead className="Table-body">
                <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                    {columns &&
                        columns.map((column: $TSFixMe, i: $TSFixMe) => {
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ key: any; column: any; }' is not assignabl... Remove this comment to see the full error message
                            return <TableColumn key={i} column={column} />;
                        })}
                </tr>
            </thead>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableColumns.propTypes = {
    columns: PropTypes.array.isRequired, // this contains props like [{name, id, onClick, itemPropertyKey, itemPropertyNullText, itemPropertyDescriptionKey, itemPropertyDescriptionNullText, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]
};
