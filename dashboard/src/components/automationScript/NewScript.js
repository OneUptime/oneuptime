import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field, formValueSelector } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { FormLoader } from '../basic/Loader';
import { openModal, closeModal } from '../../actions/modal';
import { showUpgradeForm } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import { fetchSchedules, scheduleSuccess } from '../../actions/schedule';
import { ValidateField } from '../../config';
import NewScriptEditor from './NewScriptEditor';

const selector = formValueSelector('NewComponent');

class NewScript extends Component {
    constructor(props) {
        super(props);
        this.state = {};
    }

    //Client side validation
    validate = values => {
        const errors = {};

        if (!ValidateField.text(values[`name_${this.props.index}`])) {
            errors.name = 'Name is required.';
        }

        return errors;
    };

    componentDidUpdate() {}

    cancelEdit = () => {
        this.props.editComponentSwitch(this.props.index);
    };

    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <ShouldRender if={true}>
                                            <span>New Script</span>
                                        </ShouldRender>
                                    </span>
                                </span>
                            </div>
                        </div>

                        <form id="form-new-component">
                            <div
                                className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                style={{ boxShadow: 'none' }}
                            >
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Name
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"
                                                            name={`name_${this.props.index}`}
                                                            id="name"
                                                            placeholder="Home Page"
                                                            disabled={false}
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Script
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <NewScriptEditor />
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"></div>
                                </div>
                                <div>
                                    <ShouldRender if={true}>
                                        <button
                                            className="bs-Button"
                                            disabled={false}
                                            onClick={this.cancelEdit}
                                        >
                                            <span>Cancel</span>
                                        </button>
                                    </ShouldRender>
                                    <button
                                        id="addComponentButton"
                                        className="bs-Button bs-Button--blue"
                                        disabled={true}
                                        type="submit"
                                    >
                                        <ShouldRender if={true}>
                                            <span>Add Script</span>
                                        </ShouldRender>

                                        <ShouldRender if={false}>
                                            <FormLoader />
                                        </ShouldRender>
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

NewScript.displayName = 'NewScript';

const NewScriptForm = new reduxForm({
    form: 'NewScript',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewScript);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            closeModal,
            fetchSchedules,
            scheduleSuccess,
            showUpgradeForm,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const name = selector(state, 'name_1000');
    const subProject = selector(state, 'subProject_1000');

    if (ownProps.edit) {
        const componentSlug = ownProps.match
            ? ownProps.match.params
                ? ownProps.match.params.componentSlug
                : null
            : null;
        return {
            component: state.component,
            currentProject: state.project.currentProject,
            name,
            subProject,
            subProjects: state.subProject.subProjects.subProjects,
            schedules: state.schedule.schedules.data,
            componentId:
                state.component.currentComponent.component &&
                state.component.currentComponent.component._id,
            componentSlug,
        };
    } else {
        return {
            initialValues: state.component.newComponent.initialValue,
            component: state.component,
            currentProject: state.project.currentProject,
            name,
            subProject,
            subProjects: state.subProject.subProjects.subProjects,
            schedules: state.schedule.schedules.data,
        };
    }
};

NewScript.propTypes = {
    index: PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    editComponentSwitch: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(NewScriptForm);
