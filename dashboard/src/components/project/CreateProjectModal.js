import React, { Component } from 'react';
import { SubmissionError } from 'redux-form';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ProjectForm from './ProjectForm';
import { hideForm, createProject, switchProject } from '../../actions/project';
import PropTypes from 'prop-types';



export class CreateProjectModal extends Component {
    constructor(props) {
        super(props);
        this.createProject = this.createProject.bind(this);
    }

    createProject(values) {
        
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
            this.props.hideForm();
        });
    }

    render() {
        return this.props.visible ? (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
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
    hideForm: PropTypes.func.isRequired,
    switchProject: PropTypes.func.isRequired,
    createProject: PropTypes.func.isRequired,
    projects: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    visible: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateProjectModal);
