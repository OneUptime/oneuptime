import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { Field, reduxForm } from 'redux-form';
import { openModal } from 'CommonUI/actions/Modal';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import DeletePerformanceTracker from './DeletePerformanceTracker';
import TrackerInfo from './TrackerInfo';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import { updatePerformanceTracker } from '../../actions/performanceTracker';
import { history, RootState } from '../../store';

interface PerformanceTrackerHeaderProps {
    performanceTracker?: object;
    componentSlug?: string;
    project?: object;
    component?: object;
    openModal?: Function;
    updateTrackerObj?: object;
    handleSubmit?: Function;
    updatePerformanceTracker?: Function;
}

class PerformanceTrackerHeader extends Component<ComponentProps> {
    state = {
        editName: false,
    };

    cancelEdit = () => this.setState({ editName: false });

    enableEdit = () => this.setState({ editName: true });

    submitForm = (values: $TSFixMe) => {
        const {

            project,

            component,

            performanceTracker,

            updatePerformanceTracker,

            updateTrackerObj,
        } = this.props;

        updatePerformanceTracker({
            projectId: project._id,
            componentId: component._id,
            performanceTrackerId: performanceTracker._id,
            values,
        }).then(({
            data
        }: $TSFixMe) => {
            if (!updateTrackerObj.error) {
                history.replace(
                    `/dashboard/project/${project.slug}/component/${component.slug}/performance-tracker/${data.slug}`
                );
                this.cancelEdit();
            }
        });
    };

    override render() {
        const {

            performanceTracker,

            openModal,

            project,

            componentSlug,

            updateTrackerObj,

            handleSubmit,
        } = this.props;

        const trackerName: $TSFixMe =
            (updateTrackerObj.performanceTracker &&
                updateTrackerObj.performanceTracker.name) ||
            (performanceTracker && performanceTracker.name);

        return (
            <div>
                <div
                    className="Box-root Card-shadow--medium"
                    style={{ marginTop: '10px', marginBottom: '10px' }}

                    tabIndex="0"
                >
                    <div>
                        <div
                            className={
                                !this.state.editName ? 'db-Trends-header' : ''
                            }
                        >
                            <div className="db-Trends-title">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <ShouldRender
                                        if={
                                            this.state.editName &&
                                            performanceTracker
                                        }
                                    >
                                        <div
                                            className="Box-root"
                                            style={{ fontSize: 14 }}
                                        >
                                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root">
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        <span>
                                                            Edit Performance
                                                            Tracker
                                                        </span>
                                                    </span>
                                                    <p>
                                                        <span
                                                            id={`performance-tracker-edit-title-${performanceTracker?.name}`}
                                                        >
                                                            {`Edit Performance Tracker ${performanceTracker?.name}`}
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                            <form
                                                id="form-new-performance-tracker"
                                                onSubmit={handleSubmit(
                                                    this.submitForm
                                                )}
                                            >
                                                <div
                                                    className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                                    style={{
                                                        boxShadow: 'none',
                                                    }}
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
                                                                    updateTrackerObj.error
                                                                }
                                                            >
                                                                <div className="Box-root Margin-right--8">
                                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                                </div>
                                                                <div className="Box-root">
                                                                    <span
                                                                        style={{
                                                                            color:
                                                                                'red',
                                                                        }}
                                                                    >
                                                                        {
                                                                            updateTrackerObj.error
                                                                        }
                                                                    </span>
                                                                </div>
                                                            </ShouldRender>
                                                            <ShouldRender
                                                                if={
                                                                    updateTrackerObj.error
                                                                }
                                                            >
                                                                <div className="Box-root Margin-right--8">
                                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                                </div>
                                                                <div className="Box-root">
                                                                    <span
                                                                        style={{
                                                                            color:
                                                                                'red',
                                                                        }}
                                                                    >
                                                                        {
                                                                            updateTrackerObj.error
                                                                        }
                                                                    </span>
                                                                </div>
                                                            </ShouldRender>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <button
                                                            className="bs-Button"
                                                            disabled={
                                                                updateTrackerObj.requesting
                                                            }
                                                            onClick={
                                                                this.cancelEdit
                                                            }
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
                                                                    !updateTrackerObj.requesting
                                                                }
                                                            >
                                                                <span>
                                                                    Edit
                                                                    Performance
                                                                    Tracker
                                                                </span>
                                                            </ShouldRender>

                                                            <ShouldRender
                                                                if={
                                                                    updateTrackerObj.requesting
                                                                }
                                                            >
                                                                <FormLoader />
                                                            </ShouldRender>
                                                        </button>
                                                    </div>
                                                </div>
                                            </form>
                                        </div>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            !this.state.editName &&
                                            performanceTracker
                                        }
                                    >
                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                <span
                                                    id="performance-tracker-content-header"
                                                    className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                                >
                                                    <span
                                                        id={`performance-tracker-title-${trackerName}`}
                                                    >
                                                        {trackerName}
                                                    </span>
                                                </span>
                                            </div>
                                            <div className="db-Trends-control Flex-justifyContent--flexEnd Flex-flex">
                                                <div>
                                                    <button
                                                        id={`key_${trackerName}`}
                                                        className={
                                                            'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--key'
                                                        }
                                                        type="button"
                                                        onClick={() =>
                                                            openModal({
                                                                content: TrackerInfo,
                                                                currentProject: project,
                                                                performanceTracker,
                                                            })
                                                        }
                                                    >
                                                        <span>Log API Key</span>
                                                    </button>
                                                    <button
                                                        id={`edit_${trackerName}`}
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings"
                                                        type="button"
                                                        onClick={
                                                            this.enableEdit
                                                        }
                                                    >
                                                        <span>Edit</span>
                                                    </button>
                                                    <button
                                                        id={`delete_${trackerName}`}
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                                        type="button"
                                                        onClick={() =>
                                                            openModal({
                                                                content: DeletePerformanceTracker,
                                                                project: project,
                                                                componentSlug: componentSlug,
                                                                performanceTrackerId:
                                                                    performanceTracker._id,
                                                            })
                                                        }
                                                    >
                                                        <span>Delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


PerformanceTrackerHeader.displayName = 'PerformanceTrackerHeader';


PerformanceTrackerHeader.propTypes = {
    performanceTracker: PropTypes.object,
    componentSlug: PropTypes.string,
    project: PropTypes.object,
    component: PropTypes.object,
    openModal: PropTypes.func,
    updateTrackerObj: PropTypes.object,
    handleSubmit: PropTypes.func,
    updatePerformanceTracker: PropTypes.func,
};

const mapStateToProps: Function = (state: RootState, ownProps: $TSFixMe) => {
    return {
        updateTrackerObj: state.performanceTracker.updatePerformanceTracker,
        initialValues: {
            name: ownProps.performanceTracker.name,
        },
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ openModal, updatePerformanceTracker }, dispatch);

const PerformanceTrackerHeaderForm: $TSFixMe = new reduxForm({
    form: 'PerformanceTrackerHeaderForm',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(PerformanceTrackerHeader);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PerformanceTrackerHeaderForm);
