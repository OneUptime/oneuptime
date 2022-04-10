import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { v4 as uuidv4 } from 'uuid';
import { User } from '../../config';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { FormLoader } from '../basic/Loader';
import { switchProject, getProjects, exitProject } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import ExitProjectModal from './ExitProjectModal';
import { openModal, closeModal } from 'CommonUI/actions/modal';

import { history, RootState } from '../../store';

export class ExitProjectBox extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    handleClick = () => {
        const {

            projectId,

            userId,

            nextProject,

            exitProject,

            dispatch,
        } = this.props;

        this.props.openModal({
            id: uuidv4(),
            onConfirm: () => {
                return exitProject(projectId, userId).then(function () {
                    if (nextProject) {
                        window.location.reload();

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

    override render() {

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


ExitProjectBox.displayName = 'ExitProjectBox';

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
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

const mapStateToProps = (state: RootState) => {
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
