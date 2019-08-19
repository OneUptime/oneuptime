import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { restoreProject } from '../../actions/project';
import { openModal, closeModal } from '../../actions/modal';

export class ProjectRestoreBox extends Component {

    constructor(props) {
        super(props);
        this.props = props;
    }

    handleClick = () => {
        const { restoreProject, projectId } = this.props;
        return restoreProject(projectId);
    }

    render() {

        const { isRequesting } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Restore This Project
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to restore this project.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button id="restore" className="bs-Button bs-Button--blue Box-background--blue" disabled={isRequesting} onClick={this.handleClick}>
                                        <ShouldRender if={!isRequesting}>
                                            <span>Restore Project</span>
                                        </ShouldRender>
                                        <ShouldRender if={isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

ProjectRestoreBox.displayName = 'ProjectRestoreBox'

const mapDispatchToProps = dispatch => (
    bindActionCreators({ restoreProject, openModal, closeModal }, dispatch)
)

const mapStateToProps = (state, props) => {
    const project = state.project.projects.projects.find(project => project._id === props.projectId);
    return {
        project,
        isRequesting: state.project && state.project.restoreProject && state.project.restoreProject.requesting,
    }
}

ProjectRestoreBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    history: PropTypes.object.isRequired,
    projectId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    restoreProject: PropTypes.func.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    projectId: PropTypes.string.isRequired,
}

ProjectRestoreBox.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(ProjectRestoreBox));