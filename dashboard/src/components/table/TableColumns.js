import React, { Component } from 'react';
import TableColumn from './TableColumn';
import PropTypes from 'prop-types';
export default class TableColumns extends Component {
    constructor(props) {
        super(props);
    }

    render() {
        const { columns } = this.props;

        return (
            <thead className="Table-body">
                <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                    {columns &&
                        columns.map(column => {
                            return <TableColumn column={column} />;
                        })}
                </tr>
            </thead>
        );
    }
}


Table.propTypes = {
    columns: PropTypes.array.isRequired, // this contains props like [{name, id, onClick, itemPropertyKey, itemPropertyNullText, itemPropertyDescriptionKey, itemPropertyDescriptionNullText, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]
};

