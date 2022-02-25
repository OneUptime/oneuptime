import React, { Component } from 'react';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';

import { bindActionCreators } from 'redux';
import {
    createPerformanceTracker,
    updatePerformanceTracker,
} from '../../actions/performanceTracker';

const selector = formValueSelector('NewPerformanceTracker');

class NewPerformanceTracker extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }
    validate = values => {
        const errors = {};
        if (!ValidateField.text(values[`name`])) {
            errors.name = 'Performance Tracker Name is required.';
        }
        return errors;
    };
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Enter':
                if (document.getElementById('editPerformanceTrackerButton'))
                    return document
                        .getElementById('editPerformanceTrackerButton')
                        .click();
                else return false;
            default:
                return false;
        }
    };

    submitForm = values => {
        const postObj = {};
        postObj.name = values[`name`];
        if (values[`resourceCategory`]) {
            postObj.resourceCategory = values[`resourceCategory`];
        }
        if (!this.props.edit) {
            this.props
                .createPerformanceTracker({
                    projectId: this.props.currentProject._id,
                    componentId: this.props.componentId,
                    values: postObj,
                })
                .then(
                    data => {
                        history.push(
                            `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/performance-tracker/${data.data.slug}`
                        );
                    },
                    error => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        } else {
            this.props
                .updatePerformanceTracker({
                    projectId: this.props.currentProject._id,
                    componentId: this.props.componentId,
                    performanceTrackerId: this.props.performanceTracker._id,
                    values: postObj,
                })
                .then(
                    data => {
                        history.push(
                            `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/performance-tracker/${data.data.slug}`
                        );
                    },
                    error => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        }
    };

    render() {
        const { handleSubmit, edit, performanceTracker } = this.props;
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <ShouldRender if={!edit}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>New Performance Tracker</span>
                                    </span>
                                    <p>
                                        <span>
                                            Create a performance tracker so you
                                            and your team can tracker the
                                            performance of your application.
                                        </span>
                                    </p>
                                </ShouldRender>
                                <ShouldRender if={edit}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Edit Performance Tracker</span>
                                    </span>
                                    <p>
                                        <span
                                            id={`performance-tracker-edit-title-${performanceTracker?.name}`}
                                        >
                                            {`Edit Performance Tracker ${performanceTracker?.name}`}
                                        </span>
                                    </p>
                                </ShouldRender>
                            </div>
                        </div>
                        <form
                            id="form-new-performance-tracker"
                            onSubmit={handleSubmit(this.submitForm)}
                        >
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
                                                            name={`name`}
                                                            id="name"
                                                            placeholder="Performance Tracker Name"
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <ShouldRender
                                            if={
                                                this.props.newPerformanceTracker
                                                    .error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        this.props
                                                            .newPerformanceTracker
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                this.props
                                                    .performanceTrackerUpdate
                                                    .error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        this.props
                                                            .performanceTrackerUpdate
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <ShouldRender if={!edit}>
                                    <div>
                                        <ShouldRender
                                            if={
                                                this.props.showCancelBtn &&
                                                this.props.toggleForm
                                            }
                                        >
                                            <button
                                                className="bs-Button"
                                                disabled={
                                                    this.props
                                                        .performanceTrackerUpdate
                                                        .requesting
                                                }
                                                onClick={this.props.toggleForm}
                                                type="button"
                                            >
                                                <span>Cancel</span>
                                            </button>
                                        </ShouldRender>
                                        <button
                                            id="addPerformanceTrackerButton"
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender
                                                if={
                                                    !this.props
                                                        .newPerformanceTracker
                                                        .requesting
                                                }
                                            >
                                                <span>
                                                    Add Performance Tracker
                                                </span>
                                            </ShouldRender>

                                            <ShouldRender
                                                if={
                                                    this.props
                                                        .newPerformanceTracker
                                                        .requesting
                                                }
                                            >
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={edit}>
                                    <div>
                                        <button
                                            className="bs-Button"
                                            disabled={
                                                this.props
                                                    .performanceTrackerUpdate
                                                    .requesting
                                            }
                                            onClick={this.cancelEdit}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id="editPerformanceTrackerButton"
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender
                                                if={
                                                    !this.props
                                                        .performanceTrackerUpdate
                                                        .requesting
                                                }
                                            >
                                                <span>
                                                    Edit Performance Tracker
                                                </span>
                                            </ShouldRender>

                                            <ShouldRender
                                                if={
                                                    this.props
                                                        .performanceTrackerUpdate
                                                        .requesting
                                                }
                                            >
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </ShouldRender>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

NewPerformanceTracker.displayName = 'NewPerformanceTracker';

const NewPerformanceTrackerForm = new reduxForm({
    form: 'NewPerformanceTracker',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewPerformanceTracker);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { createPerformanceTracker, updatePerformanceTracker },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const name = selector(state, 'name');
    const componentId = ownProps.componentId;
    const currentProject = state.project.currentProject;
    return {
        name,
        componentId,
        currentProject,
        newPerformanceTracker: state.performanceTracker.newPerformanceTracker,
        performanceTrackerUpdate:
            state.performanceTracker.updatePerformanceTracker,
    };
};

NewPerformanceTracker.propTypes = {
    performanceTracker: PropTypes.object,
    handleSubmit: PropTypes.func.isRequired,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    currentProject: PropTypes.object,
    edit: PropTypes.bool,
    newPerformanceTracker: PropTypes.object,
    performanceTrackerUpdate: PropTypes.object,
    createPerformanceTracker: PropTypes.func,
    updatePerformanceTracker: PropTypes.func,
    toggleForm: PropTypes.func,
    showCancelBtn: PropTypes.bool,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewPerformanceTrackerForm);
