import React, { Component } from 'react';
import RenderBasedOnRole from '../basic/RenderBasedOnRole';
import PropTypes from 'prop-types';

export default class TableColumn extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    getElement() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { title, onClick } = this.props;

        return (
            <td onClick={onClick}>
                <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                    {title}
                </div>
            </td>
        );
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'visibleForOwner' does not exist on type ... Remove this comment to see the full error message
            visibleForOwner,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'visibleForAdmin' does not exist on type ... Remove this comment to see the full error message
            visibleForAdmin,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'visibleForViewer' does not exist on type... Remove this comment to see the full error message
            visibleForViewer,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'visibleForMember' does not exist on type... Remove this comment to see the full error message
            visibleForMember,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'visibleForAll' does not exist on type 'R... Remove this comment to see the full error message
            visibleForAll,
        } = this.props;

        return (
            <RenderBasedOnRole
                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; visibleForOwner: any; v... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableColumn.propTypes = {
    title: PropTypes.string.isRequired,
    onClick: PropTypes.func,

    visibleForOwner: PropTypes.bool,
    visibleForAdmin: PropTypes.bool,
    visibleForViewer: PropTypes.bool,
    visibleForMember: PropTypes.bool,
    visibleForAll: PropTypes.bool,
};
