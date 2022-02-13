import React, { Component } from 'react';

export default class TableItemColumnData extends Component {

    constructor(props) {
        super(props);
    }

    render() {
        const { item, column } = this.props;
        const { onColumnItemClick, onColumnItemDescriptionClick, itemPropertyKey, itemPropertyNullText, itemPropertyDescriptionKey, itemPropertyDescriptionNullText, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember } = column;

        return (
            <td
                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"

            >
                <div className="bs-ObjectList-cell bs-u-v-middle">
                    <div
                        onColumnItemClick={onColumnItemClick}
                        className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted"
                    >
                        {item[itemPropertyKey] || itemPropertyNullText}
                    </div>
                    <div
                        onClick={onColumnItemDescriptionClick}
                        className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted"
                    >
                         {item[itemPropertyDescriptionKey] || itemPropertyDescriptionNullText}
                    </div>
                </div>
            </td>
        )
    }
}
