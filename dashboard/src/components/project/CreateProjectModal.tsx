import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { SubmissionError } from 'redux-form';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ProjectForm from './ProjectForm';
import { hideForm, createProject, switchProject } from '../../actions/project';
import PropTypes from 'prop-types';

export class CreateProjectModal extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.createProject = this.createProject.bind(this);
    }

    createProject(values: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchProject' does not exist on type 'R... Remove this comment to see the full error message
        const { switchProject, dispatch } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createProject' does not exist on type 'R... Remove this comment to see the full error message
        return this.props.createProject(values).then((res: Response) => {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projects' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.projects &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projects' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.projects.newProject &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projects' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.projects.newProject.project
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projects' does not exist on type 'Readon... Remove this comment to see the full error message
                switchProject(dispatch, this.props.projects.newProject.project);
            }
            if (res.error) {
                throw new SubmissionError({ _error: res.error.message });
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideForm' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.hideForm();
        });
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'Readonl... Remove this comment to see the full error message
        return this.props.visible ? (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <ProjectForm
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children?: ReactNode; submitForm: (values:... Remove this comment to see the full error message
                            submitForm={this.createProject}
                            {...this.props}
                        />
                    </div>
                </div>
            </div>
        ) : null;
    }
}

const mapStateToProps = (state: $TSFixMe) => ({
    visible: state.project.showForm,
    errorStack: state.project.newProject.error,
    requesting: state.project.newProject.requesting,
    projects: state.project
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        createProject,
        switchProject,
        dispatch,
        hideForm,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CreateProjectModal.displayName = 'CreateProjectModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
CreateProjectModal.propTypes = {
    dispatch: PropTypes.func.isRequired,
    hideForm: PropTypes.func.isRequired,
    switchProject: PropTypes.func.isRequired,
    createProject: PropTypes.func.isRequired,
    projects: PropTypes.object,
    visible: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateProjectModal);
