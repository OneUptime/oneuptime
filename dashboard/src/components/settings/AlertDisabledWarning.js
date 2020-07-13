import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { IS_SAAS_SERVICE } from '../../config';
import booleanParser from '../../utils/booleanParser';
import { history } from '../../store';

class AlertDisabledWarning extends Component {
    render() {
        const { alertEnable, currentProject } = this.props;
        const projectId = currentProject ? currentProject._id : null;
        const redirectTo = `/dashboard/project/${projectId}/settings/billing`;

        return (
            <ShouldRender if={!alertEnable && booleanParser(IS_SAAS_SERVICE)}>
                <div id="alertWarning" className="Box-root Margin-vertical--12">
                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                        <div className="Box-root Box-background--red4">
                            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                    <span>
                                        SMS and Call Alerts are disabled for
                                        this project. Please go to{' '}
                                        <span
                                            className="pointer underline"
                                            onClick={() =>
                                                history.push(redirectTo)
                                            }
                                        >
                                            Settings
                                            <span className="right-arrow" />
                                            Billings
                                        </span>{' '}
                                        and enable it.
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

AlertDisabledWarning.displayName = 'AlertDisabledWarning';

AlertDisabledWarning.propTypes = {
    alertEnable: PropTypes.bool,
    currentProject: PropTypes.shape({ _id: PropTypes.string }),
};

const mapStateToProps = state => {
    return {
        alertEnable:
            state.project &&
            state.project.currentProject &&
            state.project.currentProject.alertEnable,
        currentProject: state.project.currentProject,
    };
};

export default connect(mapStateToProps)(AlertDisabledWarning);
