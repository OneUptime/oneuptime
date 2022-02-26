import React, { Component } from 'react';
import PropTypes from 'prop-types';

import RenderIfAdmin from '../basic/RenderIfAdmin';
import RenderIfOwner from '../basic/RenderIfOwner';
import RenderIfMember from '../basic/RenderIfMember';
import RenderIfViewer from '../basic/RenderIfViewer';

export default class RenderBasedOnRole extends Component {
    constructor(props: $TSFixMe) {
        super(props);
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
            children,
        } = this.props;

        if (visibleForAll) {
            return children;
        }

        if (visibleForAdmin) {
            return <RenderIfAdmin>{children}</RenderIfAdmin>;
        }

        if (visibleForViewer) {
            return <RenderIfViewer>{children}</RenderIfViewer>;
        }

        if (visibleForMember) {
            return <RenderIfMember>{children}</RenderIfMember>;
        }

        if (visibleForOwner) {
            return <RenderIfOwner>{children}</RenderIfOwner>;
        }
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
RenderBasedOnRole.propTypes = {
    children: PropTypes.any.isRequired,

    visibleForOwner: PropTypes.bool,
    visibleForAdmin: PropTypes.bool,
    visibleForViewer: PropTypes.bool,
    visibleForMember: PropTypes.bool,
    visibleForAll: PropTypes.bool,
};
