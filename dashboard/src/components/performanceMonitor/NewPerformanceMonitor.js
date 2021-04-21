import React, { Component } from 'react';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { bindActionCreators } from 'redux';
import {
    createPerformanceMonitor,
    updatePerformanceMonitor,
} from '../../actions/performanceMonitor';

const selector = formValueSelector('NewPerformanceMonitor');

class NewPerformanceMonitor extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }
    validate = values => {
        const errors = {};
        if (!ValidateField.text(values[`name`])) {
            errors.name = 'Performance Monitor Name is required.';
        }
        return errors;
    };
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Enter':
                if (document.getElementById('editPerformanceMonitorButton'))
                    return document
                        .getElementById('editPerformanceMonitorButton')
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
                .createPerformanceMonitor({
                    projectId: this.props.currentProject._id,
                    componentId: this.props.componentId,
                    values: postObj,
                })
                .then(
                    data => {
                        history.push(
                            `/dashboard/project/${this.props.currentProject.slug}/${this.props.componentSlug}/performance-monitor/${data.data.slug}`
                        );
                        if (SHOULD_LOG_ANALYTICS) {
                            logEvent(
                                'EVENT: DASHBOARD > PROJECT > COMPONENT > PERFORMANCE MONITOR > NEW PERFORMANCE MONITOR',
                                values
                            );
                        }
                    },
                    error => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        } else {
            this.props
                .updatePerformanceMonitor({
                    projectId: this.props.currentProject._id,
                    componentId: this.props.componentId,
                    performanceMonitorId: this.props.performanceMonitor._id,
                    values: postObj,
                })
                .then(
                    data => {
                        history.push(
                            `/dashboard/project/${this.props.currentProject.slug}/${this.props.componentSlug}/performance-monitor/${data.data.slug}`
                        );
                        if (SHOULD_LOG_ANALYTICS) {
                            logEvent(
                                'EVENT: DASHBOARD > PROJECT > COMPONENT > PERFORMANCE MONITOR > EDIT PERFORMANCE MONITOR',
                                values
                            );
                        }
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
        const { handleSubmit, edit, performanceMonitor } = this.props;
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <ShouldRender if={!edit}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>New Performance Monitor</span>
                                    </span>
                                    <p>
                                        <span>
                                            Create a performance monitor so you
                                            and your team can monitor the
                                            performance of your application.
                                        </span>
                                    </p>
                                </ShouldRender>
                                <ShouldRender if={edit}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Edit Performance Monitor</span>
                                    </span>
                                    <p>
                                        <span
                                            id={`performance-monitor-edit-title-${performanceMonitor?.name}`}
                                        >
                                            {`Edit Performance Monitor ${performanceMonitor?.name}`}
                                        </span>
                                    </p>
                                </ShouldRender>
                            </div>
                        </div>
                        <form
                            id="form-new-performance-monitor"
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
                                                            placeholder="Performance Monitor Name"
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
                                                this.props.newPerformanceMonitor
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
                                                            .newPerformanceMonitor
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                this.props
                                                    .performanceMonitorUpdate
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
                                                            .performanceMonitorUpdate
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <ShouldRender if={!edit}>
                                    <div>
                                        <button
                                            id="addPerformanceMonitorButton"
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender
                                                if={
                                                    !this.props
                                                        .newPerformanceMonitor
                                                        .requesting
                                                }
                                            >
                                                <span>
                                                    Add Performance Monitor
                                                </span>
                                            </ShouldRender>

                                            <ShouldRender
                                                if={
                                                    this.props
                                                        .newPerformanceMonitor
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
                                                    .performanceMonitorUpdate
                                                    .requesting
                                            }
                                            onClick={this.cancelEdit}
                                            type="button"
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id="editPerformanceMonitorButton"
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender
                                                if={
                                                    !this.props
                                                        .performanceMonitorUpdate
                                                        .requesting
                                                }
                                            >
                                                <span>
                                                    Edit Performance Monitor
                                                </span>
                                            </ShouldRender>

                                            <ShouldRender
                                                if={
                                                    this.props
                                                        .performanceMonitorUpdate
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

NewPerformanceMonitor.displayName = 'NewPerformanceMonitor';

const NewPerformanceMonitorForm = new reduxForm({
    form: 'NewPerformanceMonitor',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewPerformanceMonitor);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { createPerformanceMonitor, updatePerformanceMonitor },
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
        newPerformanceMonitor: state.performanceMonitor.newPerformanceMonitor,
        performanceMonitorUpdate:
            state.performanceMonitor.updatePerformanceMonitor,
    };
};

NewPerformanceMonitor.propTypes = {
    performanceMonitor: PropTypes.object,
    handleSubmit: PropTypes.func.isRequired,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    currentProject: PropTypes.object,
    edit: PropTypes.bool,
    newPerformanceMonitor: PropTypes.object,
    performanceMonitorUpdate: PropTypes.object,
    createPerformanceMonitor: PropTypes.func,
    updatePerformanceMonitor: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewPerformanceMonitorForm);
