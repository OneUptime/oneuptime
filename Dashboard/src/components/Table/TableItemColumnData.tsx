import React, { Component } from 'react';
import PropTypes from 'prop-types';
import RenderBasedOnRole from '../basic/RenderBasedOnRole';

interface TableItemColumnDataProps {
    column: object;
    item: object;
}

export default class TableItemColumnData extends Component<TableItemColumnDataProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
    }

    getElement() {

        const { item, column }: $TSFixMe = this.props;
        const {
            onColumnItemClick,
            onColumnItemDescriptionClick,
            itemPropertyKey,
            itemPropertyNullText,
            itemPropertyDescriptionKey,
            itemPropertyDescriptionNullText,
        } = column;

        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord">
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
                    {item[itemPropertyDescriptionKey] ||
                        itemPropertyDescriptionNullText}
                </div>
            </div>
        </td>;
    }

    override render() {

        const { column }: $TSFixMe = this.props;

        const {
            visibleForOwner,
            visibleForAdmin,
            visibleForViewer,
            visibleForMember,
            visibleForAll,
        } = column;

        return (
            <RenderBasedOnRole
                visibleForOwner={visibleForOwner}
                visibleForAdmin={visibleForAdmin}
                visibleForViewer={visibleForViewer}
                visibleForMember={visibleForMember}
                visibleForAll={visibleForAll}
            >

                {this.getElement()}
            </RenderBasedOnRole>
        );
    }
}


TableItemColumnData.propTypes = {
    column: PropTypes.object.isRequired,
    item: PropTypes.object.isRequired,
};
