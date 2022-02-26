import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../config';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import { switchProject, getProjects, exitProject } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import ExitProjectModal from './ExitProjectModal';
import { openModal, closeModal } from '../../actions/modal';

import { history } from '../../store';

export class ExitProjectBox extends Component {
    handleClick = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
            userId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextProject' does not exist on type 'Rea... Remove this comment to see the full error message
            nextProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'exitProject' does not exist on type 'Rea... Remove this comment to see the full error message
            exitProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dispatch' does not exist on type 'Readon... Remove this comment to see the full error message
            dispatch,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            id: uuidv4(),
            onConfirm: () => {
                return exitProject(projectId, userId).then(function() {
                    if (nextProject) {
                        window.location.reload();
                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2-3 arguments, but got 1.
                        switchProject(nextProject);
                    } else {
                        history.push('/');
                    }
                    !nextProject && dispatch({ type: 'CLEAR_STORE' });
                    getProjects(false);
                });
            },
            content: ExitProjectModal,
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
        const { isRequesting } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Exit Project</span>
                                </span>
                                <p>
                                    <span>
                                        Clicking this button will remove you
                                        from this project.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red"
                                        onClick={this.handleClick}
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Exit Project</span>
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
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ExitProjectBox.displayName = 'ExitProjectBox';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        getProjects,
        openModal,
        closeModal,
        exitProject,
        dispatch,
        switchProject: nextProject => switchProject(dispatch, nextProject),
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const userId = User.getUserId();
    const projectId =
        state.project.currentProject && state.project.currentProject._id;

    const { projects } = state.project.projects;

    const nextProject =
        projects.length > 0
            ? projects.find(
                  (project: $TSFixMe) => project._id !== projectId &&
                  project.users.some((user: $TSFixMe) => user.userId === userId)
              )
            : null;

    const isRequesting = state.project.exitProject.requesting;

    return { projectId, userId, nextProject, isRequesting };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ExitProjectBox.propTypes = {
    openModal: PropTypes.func.isRequired,
    exitProject: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
    userId: PropTypes.string,
    projectId: PropTypes.string,
    nextProject: PropTypes.object,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
};

export default connect(mapStateToProps, mapDispatchToProps)(ExitProjectBox);
