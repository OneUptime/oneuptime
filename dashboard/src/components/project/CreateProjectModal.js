import React, { Component } from 'react';
import { SubmissionError } from 'redux-form';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import ProjectForm from './ProjectForm';
import { hideForm, createProject, switchProject } from '../../actions/project';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

export class CreateProjectModal extends Component {
    constructor(props) {
        super(props);
        this.createProject = this.createProject.bind(this);
    }

    createProject(values) {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('New Project Created', values);
        }
        const { switchProject, dispatch } = this.props;
        return this.props.createProject(values).then(res => {
            if (
                this.props.projects &&
                this.props.projects.newProject &&
                this.props.projects.newProject.project
            ) {
                switchProject(dispatch, this.props.projects.newProject.project);
            }
            if (res.error) {
                throw new SubmissionError({ _error: res.error.message });
            }
            let { path } = this.props.match;
            path = path.replace(':projectId', res._id);
            this.props.history.push(path);
            this.props.hideForm();
        });
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.hideForm();
            default:
                return false;
        }
    };

    render() {
        return this.props.visible ? (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            >
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <ProjectForm
                            submitForm={this.createProject}
                            {...this.props}
                        />
                    </div>
                </div>
            </div>
        ) : null;
    }
}

const mapStateToProps = state => ({
    visible: state.project.showForm,
    errorStack: state.project.newProject.error,
    requesting: state.project.newProject.requesting,
    projects: state.project,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            createProject,
            switchProject,
            dispatch,
            hideForm,
        },
        dispatch
    );

CreateProjectModal.displayName = 'CreateProjectModal';

CreateProjectModal.propTypes = {
    dispatch: PropTypes.func.isRequired,
    history: PropTypes.object.isRequired,
    hideForm: PropTypes.func.isRequired,
    switchProject: PropTypes.func.isRequired,
    createProject: PropTypes.func.isRequired,
    projects: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    match: PropTypes.object.isRequired,
    visible: PropTypes.bool,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(CreateProjectModal)
);
