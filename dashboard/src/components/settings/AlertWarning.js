import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { env } from '../../config';
import booleanParser from '../../utils/booleanParser';

class AlertWarning extends Component {
    render() {
        const { alertEnable } = this.props;
        let IS_SAAS_SERVICE = env('IS_SAAS_SERVICE');
        IS_SAAS_SERVICE = booleanParser(IS_SAAS_SERVICE);

        return (
            <ShouldRender if={!alertEnable && IS_SAAS_SERVICE}>
                <div id="alertWarning" className="Box-root Margin-vertical--12">
                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                        <div className="Box-root Box-background--red4">
                            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                    <span>
                                        SMS and Call Alerts are disabled for this project.  Please go to Settings -> Billings and enable it.
                                    </span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </ShouldRender>
        );
    }
}

AlertWarning.displayName = 'AlertWarning';

AlertWarning.propTypes = {
    alertEnable: PropTypes.bool,
};

const mapStateToProps = state => {
    return {
        alertEnable:
            state.project &&
            state.project.currentProject &&
            state.project.currentProject.alertEnable,
    };
};

export default connect(mapStateToProps)(AlertWarning);
