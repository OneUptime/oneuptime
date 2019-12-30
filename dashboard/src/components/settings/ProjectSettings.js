import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field, reset } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import { Validate } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import { renameProject } from '../../actions/project';
import { RenderField } from '../basic/RenderField';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

function validate(value) {

    const errors = {};

    if (!Validate.text(value.project_name)) {
        errors.name = 'Project name is required.'
    }

    return errors;
}

export class ProjectSettings extends Component {

    submitForm = (values)=> {

        const projectName = values.project_name;

        if(projectName){
            this.props.renameProject(this.props.projectId, projectName).then(val => {
                if(val && val.data && val.data.name){
                    document.title = val.data.name + ' Dashboard';
                }
            });
            if(!IS_DEV){
            logEvent('Rename Project',values);
            }
        }
    }

    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Project Settings</span>
                                </span>
                                <p>
                                    <span>
                                        Change project settings like project name, icon, and more.
                                    </span>
                                </p>
                            </div>
                        </div>
                        <form onSubmit={this.props.handleSubmit(this.submitForm)}>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">Project Name</label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={RenderField}
                                                            type="text"
                                                            name="project_name"
                                                            id="name"
                                                            placeholder="New Project Name"
                                                            required="required"
                                                            disabled={this.props.isRequesting}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        id="btnCreateProject"
                                        className="bs-Button bs-Button--blue"
                                        disabled={this.props.isRequesting}
                                        type="submit"
                                    >
                                        <ShouldRender if={!this.props.isRequesting}>
                                            <span>Save</span>
                                        </ShouldRender>
                                        <ShouldRender if={this.props.isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        )
    }
}

ProjectSettings.displayName = 'ProjectSettings'

ProjectSettings.propTypes = {
    renameProject:PropTypes.func.isRequired,
    handleSubmit:PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null,undefined,true,false]),
    projectId: PropTypes.string
}

let formName = 'ProjectSettings'+Math.floor((Math.random() * 10) + 1);

let onSubmitSuccess = (result, dispatch) => dispatch(reset(formName))

let ProjectSettingsForm = new reduxForm({
    form: formName,
    enableReinitialize:true,
    validate,
    onSubmitSuccess
})(ProjectSettings);

const mapDispatchToProps = dispatch => (
    bindActionCreators({ renameProject }, dispatch)
)

const mapStateToProps = state => (
    {
        isRequesting: state.project.renameProject.isRequesting,
        projectId: state.project.currentProject !== null && state.project.currentProject._id,
        initialValues: { project_name: state.project.currentProject !== null ? state.project.currentProject.name : '' }
    }
)

export default connect(mapStateToProps, mapDispatchToProps)(ProjectSettingsForm);