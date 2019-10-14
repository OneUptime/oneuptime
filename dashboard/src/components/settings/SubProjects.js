import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, FieldArray } from 'redux-form';
import { createSubProject, createSubProjectRequest, createSubProjectSuccess, createSubProjectError, getSubProjects } from '../../actions/subProject';
import { SubProject } from './SubProject';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

//Client side validation
function validate(values) {
    const errors = {};
    const subProjectsArrayErrors = [];

    if (values.subProjects) {
        for (var i = 0; i < values.subProjects.length; i++) {
            const subProjectErrors = {}
            if (values.subProjects[i].name) {

                if (!Validate.text(values.subProjects[i].name)) {
                    subProjectErrors.name = 'Name is not in text format.'
                    subProjectsArrayErrors[i] = subProjectErrors
                }
            }
        }

        if (subProjectsArrayErrors.length) {
            errors.subProjects = subProjectsArrayErrors
        }
    }

    return errors;
}

export class SubProjects extends Component {
    submitForm = (values) => {
        // console.log('values: ', values);
        this.props.createSubProject(this.props.currentProject._id, values);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('SubProjects Updated', values);
        }
    }

    render() {
        const { handleSubmit, subProject } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Sub Projects</span>
                                </span>
                                <p>
                                    <span>
                                    Subprojects let’s you have flexible access controls between Fyipe resources and your team.
                                </span>
                                </p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit(this.submitForm)} id="frmSubProjects">
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <FieldArray 
                                                    name="subProjects" 
                                                    component={SubProject} 
                                                />
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">

                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                        <ShouldRender if={this.props.subProject.newSubProject.error}>
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                                </div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {this.props.subProject.newSubProject.error}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>

                                <div>
                                    <button
                                        id="btnSaveSubproject"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={subProject.newSubProject.requesting}
                                        type="submit"
                                    >
                                        {!subProject.newSubProject.requesting && <span>Save</span>}
                                        {subProject.newSubProject.requesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

SubProjects.displayName = 'SubProjects'

SubProjects.propTypes = {
    createSubProject: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    subProject: PropTypes.object.isRequired,
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {
        createSubProject,
        createSubProjectRequest,
        createSubProjectSuccess,
        createSubProjectError,
        getSubProjects
    }, dispatch
)

const mapStateToProps = state => {
    const status = state.subProject.subProjects || [];
    let subProjects = [];

    status.subProjects && status.subProjects.forEach((subProject) => {
        subProjects.push({
            _id: subProject._id || null,
            name: subProject.name        
        })
    });

    return {
        initialValues: { subProjects },
        subProject: state.subProject,
        currentProject: state.project.currentProject,
    };
}

let SubProjectsForm = reduxForm({
    form: 'SubProjects', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
    enableReinitialize: true
})(SubProjects);

SubProjects.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(SubProjectsForm);