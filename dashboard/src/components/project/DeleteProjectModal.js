import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import ClickOutside from 'react-click-outside';
import DeleteCaution from './DeleteCaution';
import { IS_SAAS_SERVICE } from '../../config';
import DeleteMessaging from './DeleteMessaging';
import {
    hideDeleteModal,
    deleteProject,
    switchProject,
    hideDeleteModalSaasMode,
} from '../../actions/project';
import { history } from '../../store';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

export class DeleteProjectModal extends Component {
    constructor(props) {
        super(props);
        this.state = {
            deleted: false,
        };

        this.deleteProject = this.deleteProject.bind(this);
        this.closeNotice = this.closeNotice.bind(this);
    }

    deleteProject(values) {
        const { projectId, deleteProject } = this.props;

        deleteProject(projectId, values.feedback).then(() => {
            this.setState({ deleted: true });
            this.closeNotice();
        });
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('EVENT: DASHBOARD > PROJECT > PROJECT DELETED', values);
        }
    }

    closeNotice() {
        const { switchProject, nextProject } = this.props;
        if (!IS_SAAS_SERVICE) {
            this.props.hideDeleteModal();
        }
        if (nextProject) switchProject(nextProject);
        else history.push('/');
    }

    render() {
        const { deleted } = this.state;
        const { deletedModal, deletedProjectSuccess } = this.props;
        return this.props.visible ? (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <ClickOutside onClickOutside={this.props.hideDeleteModal}>
                        {deletedModal ? (
                            <div className="bs-BIM">
                                {/* <DeleteRequestModal
                                closeNotice={this.closeNotice}
                                requesting={this.props.isRequesting}
                            /> */}
                                <DeleteCaution
                                    hide={this.props.hideDeleteModal}
                                    deleteProject={this.deleteProject}
                                    requesting={this.props.isRequesting}
                                    deleteSuccess={deletedProjectSuccess}
                                    hideOnDelete={
                                        this.props.hideDeleteModalSaasMode
                                    }
                                />
                            </div>
                        ) : (
                            <div className="bs-BIM">
                                <DeleteMessaging
                                    hide={this.props.hideDeleteModal}
                                    deleteProject={this.deleteProject}
                                    requesting={this.props.isRequesting}
                                    deleted={deleted}
                                    // showDeleteModal="show"
                                />
                            </div>
                        )}
                    </ClickOutside>
                </div>
            </div>
        ) : null;
    }
}

DeleteProjectModal.displayName = 'DeleteProjectModal';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            deleteProject,
            hideDeleteModal,
            hideDeleteModalSaasMode,
            switchProject: project => switchProject(dispatch, project),
        },
        dispatch
    );

const mapStateToProps = (state, props) => {
    const { projectId } = props.match.params;

    const { projects } = state.project.projects;

    const project =
        projects !== undefined && projects.length > 0
            ? projects.filter(project => project._id === projectId)[0]
            : [];

    const nextProject =
        projects !== undefined && projects.length > 0
            ? projects.filter(project => project._id !== projectId)[0]
            : {};

    const projectName = project && project.name;

    return {
        projectName,
        projectId,
        nextProject,
        visible: state.project.showDeleteModal,
        isRequesting: state.project.deleteProject.requesting,
        deletedProjectSuccess: state.project.deleteProject.deleted,
        deletedModal: state.project.deletedModal,
    };
};

DeleteProjectModal.propTypes = {
    deleteProject: PropTypes.func.isRequired,
    switchProject: PropTypes.func.isRequired,
    hideDeleteModal: PropTypes.func.isRequired,
    hideDeleteModalSaasMode: PropTypes.func.isRequired,
    nextProject: PropTypes.oneOfType([
        PropTypes.oneOf([null, undefined]),
        PropTypes.object,
    ]),
    projectId: PropTypes.string,
    visible: PropTypes.bool,
    isRequesting: PropTypes.bool,
    deletedModal: PropTypes.bool,
    deletedProjectSuccess: PropTypes.bool,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(DeleteProjectModal)
);
