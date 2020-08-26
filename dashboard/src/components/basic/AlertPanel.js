import React, { Component } from 'react';
import PropTypes from 'prop-types';

class AlertPanel extends Component {
    render() {
        return (
            <div id={this.props.id} className="Box-root">
                <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                    <div className="Box-root Box-background--red4">
                        <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                <span>{this.props.message}</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

AlertPanel.displayName = 'AlertPanel';

AlertPanel.propTypes = {
    message: PropTypes.object.isRequired,
    id: PropTypes.string,
};

export default AlertPanel;
