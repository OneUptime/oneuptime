import React, { Component } from 'react';
import PropTypes from 'prop-types';

class Notification extends Component {
    render() {
        return (
            <div
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'id' does not exist on type 'Readonly<{}>... Remove this comment to see the full error message
                id={this.props.id}
                className={`Box-root Flex-flex Flex-direction--row Flex-alignItems--center ${
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'backgroundClass' does not exist on type ... Remove this comment to see the full error message
                    this.props.backgroundClass
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'backgroundClass' does not exist on type ... Remove this comment to see the full error message
                        ? this.props.backgroundClass
                        : 'Box-background--green'
                } Text-color--white Border-radius--4 Text-fontWeight--bold Padding-horizontal--20 Padding-vertical--12 pointer Card-shadow--medium bs-mar-cursor`}
            >
                <span
                    className={`db-SideNav-icon ${
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'icon' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        this.props.icon
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'icon' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            ? this.props.icon
                            : 'db-SideNav-icon--tick'
                    } db-SideNav-icon--selected`}
                    style={{
                        filter: 'brightness(0) invert(1)',
                        marginTop: '1px',
                        marginRight: '3px',
                    }}
                ></span>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type 'Readonl... Remove this comment to see the full error message
                <span>{this.props.message}</span>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Notification.displayName = 'Notification';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Notification.propTypes = {
    message: PropTypes.object.isRequired,
    id: PropTypes.string,
    backgroundClass: PropTypes.string,
    icon: PropTypes.string,
};

export default Notification;
