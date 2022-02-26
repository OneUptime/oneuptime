import React, { Component } from 'react';
import PropTypes from 'prop-types';
import RenderBasedOnRole from '../basic/RenderBasedOnRole';

export default class TableItemColumnData extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    getElement() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { item, column } = this.props;
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: any; onColumnItemClick: any; cla... Remove this comment to see the full error message
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

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'column' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { column } = this.props;

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
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'void' is not assignable to type 'ReactNode'.
                {this.getElement()}
            </RenderBasedOnRole>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableItemColumnData.propTypes = {
    column: PropTypes.object.isRequired,
    item: PropTypes.object.isRequired,
};
