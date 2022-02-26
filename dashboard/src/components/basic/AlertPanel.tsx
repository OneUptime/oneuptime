import React, { Component } from 'react';
import PropTypes from 'prop-types';

class AlertPanel extends Component {
    render() {
        return (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'id' does not exist on type 'Readonly<{}>... Remove this comment to see the full error message
            <div id={this.props.id} className="Box-root">
                <div className="db-Trends Card-shadow--small bs-ContentSection Card-root">
                    <div
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'customClass' does not exist on type 'Rea... Remove this comment to see the full error message
                        className={`Box-root ${this.props.customClass} ${
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'backgroundClass' does not exist on type ... Remove this comment to see the full error message
                            this.props.backgroundClass
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'backgroundClass' does not exist on type ... Remove this comment to see the full error message
                                ? this.props.backgroundClass
                                : 'Box-background--red4'
                        }`}
                    >
                        <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type 'Readonl... Remove this comment to see the full error message
                                <span>{this.props.message}</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AlertPanel.displayName = 'AlertPanel';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
AlertPanel.propTypes = {
    message: PropTypes.object.isRequired,
    id: PropTypes.string,
    customClass: PropTypes.string,
    backgroundClass: PropTypes.string,
};

export default AlertPanel;
