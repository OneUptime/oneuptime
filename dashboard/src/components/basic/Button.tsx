import React, { Component } from 'react';
import PropTypes from 'prop-types';
import RenderBasedOnRole from './RenderBasedOnRole';
import BasicButton from 'common-ui/components/basic/Button';

export default class Button extends Component {
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
            visibleForAll = true,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
            title,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'shortcutKey' does not exist on type 'Rea... Remove this comment to see the full error message
            shortcutKey, id, onClick, disabled
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
                <BasicButton
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ title: any; shortcutKey: any; id: any; onC... Remove this comment to see the full error message
                    title={title}
                    shortcutKey={shortcutKey}
                    id={id}
                    onClick={onClick}
                    disabled={disabled}
                />
            </RenderBasedOnRole>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Button.propTypes = {
    title: PropTypes.string.isRequired,
    onClick: PropTypes.func,
    disabled: PropTypes.bool,
    id: PropTypes.string,
    shortcutKey: PropTypes.string,

    visibleForOwner: PropTypes.bool,
    visibleForAdmin: PropTypes.bool,
    visibleForViewer: PropTypes.bool,
    visibleForMember: PropTypes.bool,
    visibleForAll: PropTypes.bool,
};
