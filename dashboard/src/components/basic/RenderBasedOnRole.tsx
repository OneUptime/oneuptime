import React, { Component } from 'react';
import PropTypes from 'prop-types';

import RenderIfAdmin from '../basic/RenderIfAdmin';
import RenderIfOwner from '../basic/RenderIfOwner';
import RenderIfMember from '../basic/RenderIfMember';
import RenderIfViewer from '../basic/RenderIfViewer';

interface RenderBasedOnRoleProps {
    children: any;
    visibleForOwner?: boolean;
    visibleForAdmin?: boolean;
    visibleForViewer?: boolean;
    visibleForMember?: boolean;
    visibleForAll?: boolean;
}

export default class RenderBasedOnRole extends Component<RenderBasedOnRoleProps> {
    constructor(props: $TSFixMe) {
        super(props);
    }

    override render() {
        const {

            visibleForOwner,

            visibleForAdmin,

            visibleForViewer,

            visibleForMember,

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


RenderBasedOnRole.propTypes = {
    children: PropTypes.any.isRequired,

    visibleForOwner: PropTypes.bool,
    visibleForAdmin: PropTypes.bool,
    visibleForViewer: PropTypes.bool,
    visibleForMember: PropTypes.bool,
    visibleForAll: PropTypes.bool,
};
