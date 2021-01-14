import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import 'imrc-datetime-picker/dist/imrc-datetime-picker.css';
import { reduxForm, Field, formValueSelector, FieldArray } from 'redux-form';
import ClickOutside from 'react-click-outside';

import { updateScheduledEvent } from '../../actions/scheduledEvent';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderTextArea } from '../basic/RenderTextArea';
import { RenderSelect } from '../basic/RenderSelect';
import DateTimeSelector from '../basic/DateTimeSelector';

function validate(values) {
    const errors = {};

    if (!values.name) {
        errors.name = 'Maintenance name is required';
    }
    return errors;
}

class UpdateSchedule extends React.Component {
    state = {
        currentDate: moment(),
        dateError: null,
        monitorError: null,
    };

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const {
            updateScheduledEvent,
            closeModal,
            updateScheduledEventModalId,
            monitors,
        } = this.props;
        const projectId = this.props.currentProject._id;
        const scheduledEventId = this.props.initialValues._id;
        const postObj = {};

        if (values.monitors && values.monitors.length > 0) {
            const monitors = values.monitors.filter(
                monitorId => typeof monitorId === 'string'
            );
            postObj.monitors = monitors;
        } else {
            postObj.monitors = monitors.map(monitor => monitor._id);
        }

        postObj.name = values.name;
        postObj.startDate = moment(values.startDate);
        postObj.endDate = moment(values.endDate);
        postObj.description = values.description;
        postObj.showEventOnStatusPage = values.showEventOnStatusPage;
        postObj.callScheduleOnEvent = values.callScheduleOnEvent;
        postObj.monitorDuringEvent = values.monitorDuringEvent;
        postObj.alertSubscriber = values.alertSubscriber;

        const isDuplicate = postObj.monitors
            ? postObj.monitors.length === new Set(postObj.monitors).size
                ? false
                : true
            : false;

        if (isDuplicate) {
            this.setState({
                monitorError: 'Duplicate monitor selection found',
            });
            return;
        }

        if (
            postObj.monitors &&
            postObj.monitors.length === 0 &&
            !values.selectAllMonitors
        ) {
            this.setState({
                monitorError: 'No monitor was selected',
            });
            return;
        }

        if (postObj.startDate > postObj.endDate) {
            this.setState({
                dateError: 'Start date should always be less than End date',
            });
            return;
        }

        updateScheduledEvent(projectId, scheduledEventId, postObj).then(() => {
            this.setState({
                monitorError: null,
            });

            if (!this.props.scheduledEventError) {
                closeModal({
                    id: updateScheduledEventModalId,
                });
            }
        });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return document
                    .getElementById('updateScheduledEventButton')
                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.closeModal({
            id: this.props.updateScheduledEventModalId,
        });
    };

    renderMonitors = ({ fields }) => {
        const { monitorError } = this.state;
        const { formValues } = this.props;
        return (
            <>
                {formValues && formValues.selectAllMonitors && (
                    <div
                        className="bs-Fieldset-row"
                        style={{ padding: 0, width: '100%' }}
                    >
                        <div
                            className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                            style={{ padding: 0 }}
                        >
                            <div
                                className="Box-root"
                                style={{
                                    height: '5px',
                                }}
                            ></div>
                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                <label
                                    className="Checkbox"
                                    htmlFor="selectAllMonitorsBox"
                                >
                                    <Field
                                        component="input"
                                        type="checkbox"
                                        name="selectAllMonitors"
                                        className="Checkbox-source"
                                        id="selectAllMonitorsBox"
                                    />
                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                        <div className="Checkbox-target Box-root">
                                            <div className="Checkbox-color Box-root"></div>
                                        </div>
                                    </div>
                                    <div className="Checkbox-label Box-root Margin-left--8">
                                        <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <span>All Monitors Selected</span>
                                        </span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>
                )}
                {formValues && !formValues.selectAllMonitors && (
                    <div
                        style={{
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        <button
                            id="addMoreMonitor"
                            className="Button bs-ButtonLegacy ActionIconParent"
                            style={{
                                position: 'absolute',
                                zIndex: 1,
                                right: 0,
                            }}
                            type="button"
                            onClick={() => {
                                fields.push();
                            }}
                        >
                            <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                <span>Add Monitor</span>
                            </span>
                        </button>
                        {fields.length === 0 && !formValues.selectAllMonitors && (
                            <div
                                className="bs-Fieldset-row"
                                style={{ padding: 0, width: '100%' }}
                            >
                                <div
                                    className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                    style={{ padding: 0 }}
                                >
                                    <div
                                        className="Box-root"
                                        style={{
                                            height: '5px',
                                        }}
                                    ></div>
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                        <label
                                            className="Checkbox"
                                            htmlFor="selectAllMonitorsBox"
                                        >
                                            <Field
                                                component="input"
                                                type="checkbox"
                                                name="selectAllMonitors"
                                                className="Checkbox-source"
                                                id="selectAllMonitorsBox"
                                            />
                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                <div className="Checkbox-target Box-root">
                                                    <div className="Checkbox-color Box-root"></div>
                                                </div>
                                            </div>
                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>
                                                        Select All Monitors
                                                    </span>
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {fields.map((field, index) => {
                            return (
                                <div
                                    style={{
                                        width: '65%',
                                        marginBottom: 10,
                                    }}
                                    key={index}
                                >
                                    <Field
                                        className="db-select-nw Table-cell--width--maximized"
                                        component={RenderSelect}
                                        name={field}
                                        id={`monitorfield_${index}`}
                                        placeholder="Monitor"
                                        style={{
                                            height: '28px',
                                            width: '100%',
                                        }}
                                        options={[
                                            {
                                                value: '',
                                                label: 'Select a Monitor',
                                            },
                                            ...(this.props.monitors &&
                                            this.props.monitors.length > 0
                                                ? this.props.monitors.map(
                                                      monitor => ({
                                                          value: monitor._id,
                                                          label: `${monitor.componentId.name} / ${monitor.name}`,
                                                      })
                                                  )
                                                : []),
                                        ]}
                                    />
                                    <button
                                        id="addMoreMonitor"
                                        className="Button bs-ButtonLegacy ActionIconParent"
                                        style={{
                                            marginTop: 10,
                                        }}
                                        type="button"
                                        onClick={() => {
                                            fields.remove(index);
                                        }}
                                    >
                                        <span className="bs-Button bs-Button--icon bs-Button--delete">
                                            <span>Remove Monitor</span>
                                        </span>
                                    </button>
                                </div>
                            );
                        })}
                        {monitorError && (
                            <div
                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                style={{
                                    marginTop: '5px',
                                    alignItems: 'center',
                                }}
                            >
                                <div
                                    className="Box-root Margin-right--8"
                                    style={{ marginTop: '2px' }}
                                >
                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                </div>
                                <div className="Box-root">
                                    <span
                                        id="monitorError"
                                        style={{ color: 'red' }}
                                    >
                                        {monitorError}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </>
        );
    };

    render() {
        const { currentDate } = this.state;
        const { requesting, scheduledEventError, startDate } = this.props;
        const { handleSubmit, closeModal } = this.props;

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 600 }}>
                        <ClickOutside onClickOutside={this.handleCloseModal}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Update Scheduled Maintenance Event
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id="editScheduledEventForm"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="endpoint"
                                                    >
                                                        <span>
                                                            Maintenance Name
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="name"
                                                                placeholder="Maintenance name"
                                                                id="name"
                                                                className="bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '3px 5px',
                                                                }}
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="endpoint"
                                                    >
                                                        <span>Monitors</span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <FieldArray
                                                                name="monitors"
                                                                component={
                                                                    this
                                                                        .renderMonitors
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorIds"
                                                    >
                                                        <span>
                                                            Maintenance
                                                            Description
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                className="bs-TextArea"
                                                                component={
                                                                    RenderTextArea
                                                                }
                                                                type="text"
                                                                name="description"
                                                                rows="5"
                                                                id="description"
                                                                placeholder="Event Description"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    resize:
                                                                        'none',
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorIds"
                                                    >
                                                        <span>
                                                            Start date and time
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div className="bs-Fieldset-field">
                                                            <Field
                                                                className="bs-TextInput"
                                                                type="text"
                                                                name="startDate"
                                                                component={
                                                                    DateTimeSelector
                                                                }
                                                                placeholder="10pm"
                                                                style={{
                                                                    width:
                                                                        '250px',
                                                                }}
                                                                minDate={
                                                                    currentDate
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorIds"
                                                    >
                                                        <span>
                                                            End date and time
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div className="bs-Fieldset-field">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                type="text"
                                                                name="endDate"
                                                                component={
                                                                    DateTimeSelector
                                                                }
                                                                placeholder="10pm"
                                                                style={{
                                                                    width:
                                                                        '250px',
                                                                }}
                                                                minDate={
                                                                    startDate
                                                                }
                                                                onChange={
                                                                    this
                                                                        .handleChangeEndDate
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{ height: '5px' }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="showEventOnStatusPage"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="showEventOnStatusPage"
                                                            className="Checkbox-source"
                                                            id="showEventOnStatusPage"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Show this
                                                                    maintenance
                                                                    event on
                                                                    Status Page
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{ height: '5px' }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="callScheduleOnEvent"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="callScheduleOnEvent"
                                                            className="Checkbox-source"
                                                            id="callScheduleOnEvent"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Alert your
                                                                    team members
                                                                    who are on
                                                                    call when
                                                                    this
                                                                    maintenance
                                                                    event starts
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{ height: '5px' }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="alertSubscriber"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="alertSubscriber"
                                                            className="Checkbox-source"
                                                            id="alertSubscriber"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Alert
                                                                    subscribers
                                                                    about this
                                                                    scheduled
                                                                    maintenance
                                                                    event
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{ height: '5px' }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="monitorDuringEvent"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="monitorDuringEvent"
                                                            className="Checkbox-source"
                                                            id="monitorDuringEvent"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Do not
                                                                    monitor this
                                                                    monitor
                                                                    during this
                                                                    event
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={
                                                scheduledEventError ||
                                                this.state.dateError
                                            }
                                        >
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {scheduledEventError ||
                                                                this.state
                                                                    .dateError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() =>
                                                closeModal({
                                                    id: this.props
                                                        .updateScheduledEventModalId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="updateScheduledEventButton"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Update</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

UpdateSchedule.displayName = 'UpdateSchedule';

UpdateSchedule.propTypes = {
    currentProject: PropTypes.object,
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    updateScheduledEvent: PropTypes.func.isRequired,
    updateScheduledEventModalId: PropTypes.string,
    requesting: PropTypes.bool,
    scheduledEventError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    initialValues: PropTypes.object,
    startDate: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    formValues: PropTypes.object,
    monitors: PropTypes.array,
};

const NewUpdateSchedule = reduxForm({
    form: 'newUpdateSchedule',
    enableReinitialize: true,
    validate,
    destroyOnUnmount: true,
})(UpdateSchedule);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            updateScheduledEvent,
            closeModal,
        },
        dispatch
    );

const selector = formValueSelector('newUpdateSchedule');

const mapStateToProps = state => {
    const scheduledEventToBeUpdated = state.modal.modals[0].event;

    const monitorData = state.monitor.monitorsList.monitors.find(
        data => String(data._id) === String(state.modal.modals[0].projectId)
    );
    const monitors = monitorData.monitors;

    const initialValues = {};
    const startDate = selector(state, 'startDate');

    const monitorIds =
        monitors.length !== scheduledEventToBeUpdated.monitors.length
            ? scheduledEventToBeUpdated
                ? scheduledEventToBeUpdated.monitors.map(
                      monitor => monitor.monitorId._id
                  )
                : []
            : [];

    if (scheduledEventToBeUpdated) {
        initialValues.name = scheduledEventToBeUpdated.name;
        initialValues.startDate = scheduledEventToBeUpdated.startDate
            ? scheduledEventToBeUpdated.startDate
            : null;
        initialValues.endDate = scheduledEventToBeUpdated.startDate
            ? scheduledEventToBeUpdated.endDate
            : null;
        initialValues.description = scheduledEventToBeUpdated.description;
        initialValues.showEventOnStatusPage =
            scheduledEventToBeUpdated.showEventOnStatusPage;
        initialValues.callScheduleOnEvent =
            scheduledEventToBeUpdated.callScheduleOnEvent;
        initialValues.monitorDuringEvent =
            scheduledEventToBeUpdated.monitorDuringEvent;
        initialValues.alertSubscriber =
            scheduledEventToBeUpdated.alertSubscriber;
        initialValues._id = scheduledEventToBeUpdated._id;
        initialValues.selectAllMonitors =
            monitors.length === scheduledEventToBeUpdated.monitors.length
                ? true
                : false;
        initialValues.monitors = [...monitorIds];
    }

    return {
        currentProject: state.project.currentProject,
        updatedScheduledEvent: state.scheduledEvent.updatedScheduledEvent,
        scheduledEventError: state.scheduledEvent.updatedScheduledEvent.error,
        requesting: state.scheduledEvent.updatedScheduledEvent.requesting,
        updateScheduledEventModalId: state.modal.modals[0].id,
        initialValues,
        startDate,
        formValues:
            state.form.newUpdateSchedule && state.form.newUpdateSchedule.values,
        monitors,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(NewUpdateSchedule);
