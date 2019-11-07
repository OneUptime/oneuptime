import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import 'imrc-datetime-picker/dist/imrc-datetime-picker.css';
import { DatetimePickerTrigger } from 'imrc-datetime-picker';

import { reduxForm, Field } from 'redux-form';
import { createScheduledEvent } from '../../actions/scheduledEvent';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderTextArea } from '../basic/RenderTextArea';



function validate(values) {

    const errors = {};

    if (!values.name) {
        errors.name = 'Event name is required'
    }
    return errors;
}

class CreateSchedule extends React.Component {

    state = {
        currentDate: moment(),
        startDate: moment(),
        endDate: moment(),
        startDateCleared: false,
        endDateCleared: false
    };

    handleChangeStartDate = (moment) => {
        this.setState(state => {
            let { endDate } = state;

            if (endDate < moment) {
                endDate = moment;
            }
            return {
                startDate: moment,
                startDateCleared: false,
                endDate,
            }
        });
    }

    handleChangeEndDate = (moment) => {
        this.setState({
            endDate: moment,
            endDateCleared: false
        });
    }

    submitForm = (values) => {
        const { createScheduledEvent, closeModal, createScheduledEventModalId } = this.props;
        const { startDate, endDate } = this.state;
        const projectId = this.props.data.projectId;
        const monitorId = this.props.data.monitorId;
        const postObj = {};

        postObj.name = values.name;
        postObj.startDate = startDate;
        postObj.endDate = endDate;
        postObj.description = values.description;
        postObj.showEventOnStatusPage = values.showEventOnStatusPage;
        postObj.callScheduleOnEvent = values.callScheduleOnEvent;
        postObj.monitorDuringEvent = values.monitorDuringEvent;
        postObj.alertSubscriber = values.alertSubscriber;

        createScheduledEvent(projectId, monitorId, postObj)
            .then(() => {
                closeModal({
                    id: createScheduledEventModalId
                });
            });
    }

    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.props.createScheduledEventModalId
                })
            default:
                return false;
        }
    }

    render() {
        const { startDate, startDateCleared, endDate, endDateCleared, currentDate } = this.state;
        const { requesting, error } = this.props;

        const valueStartDate = !startDateCleared && startDate ? startDate.format('MMMM Do YYYY, h:mm a') : '';
        const valueEndDate = !endDateCleared && endDate ? endDate.format('MMMM Do YYYY, h:mm a') : '';


        const { handleSubmit, closeModal } = this.props;

        return (
            <div onKeyDown={this.handleKeyBoard} className="ModalLayer-contents" tabIndex="-1" style={{ marginTop: '40px' }}>
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 500 }}>
                        <div className="bs-Modal-header">
                            <div className="bs-Modal-header-copy"
                                style={{ marginBottom: '10px', marginTop: '10px' }}>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Create Scheduled event</span>
                                </span>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit(this.submitForm)}>
                            <div className="bs-Modal-content Padding-horizontal--12">
                                <div className="bs-Modal-block bs-u-paddingless">

                                    <div className="bs-Modal-content">

                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                            <fieldset className="Margin-bottom--16">
                                                <div className="bs-Fieldset-rows">
                                                    <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                                                        <label className="bs-Fieldset-label Text-align--left" htmlFor="endpoint">
                                                            <span>Event name</span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <div className="bs-Fieldset-field" style={{ width: '70%' }}>
                                                                <Field
                                                                    component={RenderField}
                                                                    name="name"
                                                                    placeholder="Event name"
                                                                    id="name"
                                                                    className="bs-TextInput"
                                                                    style={{ width: 300, padding: '3px 5px' }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>

                                            <fieldset className="Margin-bottom--16">
                                                <div className="bs-Fieldset-rows">
                                                    <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                                                        <label className="bs-Fieldset-label Text-align--left" htmlFor="monitorIds">
                                                            <span>Start date and time</span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <div className="bs-Fieldset-field" style={{ width: '70%' }}>
                                                                <DatetimePickerTrigger
                                                                    minDate={currentDate}
                                                                    moment={startDate}
                                                                    onChange={this.handleChangeStartDate}
                                                                    showTimePicker={true}
                                                                    closeOnSelectDay={true}>
                                                                    <input type="text" className="bs-TextInput" value={valueStartDate} style={{ width: 300, padding: '3px 5px' }} />
                                                                </DatetimePickerTrigger>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                            <fieldset className="Margin-bottom--16">
                                                <div className="bs-Fieldset-rows">
                                                    <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                                                        <label className="bs-Fieldset-label Text-align--left" htmlFor="monitorIds">
                                                            <span>End date and time</span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <div className="bs-Fieldset-field" style={{ width: '70%' }}>
                                                                <DatetimePickerTrigger
                                                                    minDate={startDate}
                                                                    moment={endDate}
                                                                    onChange={this.handleChangeEndDate}
                                                                    showTimePicker={true}
                                                                    closeOnSelectDay={true}>
                                                                    <input type="text" className="bs-TextInput" value={valueEndDate} style={{ width: 300, padding: '3px 5px' }} />
                                                                </DatetimePickerTrigger>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                            <fieldset className="Margin-bottom--16">
                                                <div className="bs-Fieldset-rows">
                                                    <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                                                        <label className="bs-Fieldset-label Text-align--left" htmlFor="monitorIds">
                                                            <span>Event Description</span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <div className="bs-Fieldset-field" style={{ width: '70%' }}>
                                                                <Field className="bs-TextArea"
                                                                    component={RenderTextArea}
                                                                    type="text"
                                                                    name="description"
                                                                    rows="5"
                                                                    id="description"
                                                                    placeholder="Event Description"
                                                                    style={{ width: 300, resize: 'none' }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox" htmlFor="showEventOnStatusPage">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name="showEventOnStatusPage"
                                                                className="Checkbox-source"
                                                                id='showEventOnStatusPage'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>Show this event on Status Page</span>
                                                                </span>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox" htmlFor="callScheduleOnEvent">
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
                                                                    <span>Alert your team members who are on call when this event starts</span>
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox" htmlFor="alertSubscriber">
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
                                                                    <span>Alert subscribers about this scheduled event</span>
                                                                </span>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox" htmlFor="monitorDuringEvent">
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
                                                                    <span>Do not monitor this monitor during this event</span>
                                                                </span>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <ShouldRender if={error}>
                                        <div className="bs-Tail-copy">
                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                                    </div>
                                                </div>
                                                <div className="Box-root">
                                                    <span style={{ color: 'red' }}>{error}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button className="bs-Button bs-DeprecatedButton" type="button" onClick={() => closeModal({
                                        id: this.props.createScheduledEventModalId
                                    })}>
                                        <span>Cancel</span></button>
                                    <button
                                        id="createScheduledEventButton"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={requesting}
                                        type="submit">
                                        {!requesting && <span>Create</span>}
                                        {requesting && <FormLoader />}
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

CreateSchedule.displayName = 'CreateSchedule';


CreateSchedule.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    createScheduledEvent: PropTypes.func.isRequired,
    createScheduledEventModalId: PropTypes.string,
    data: PropTypes.object,
    requesting: PropTypes.bool,
    error: PropTypes.object,
};

let NewCreateSchedule = reduxForm({
    form: 'newCreateSchedule',
    enableReinitialize: true,
    validate,
    destroyOnUnmount: true
})(CreateSchedule);

const mapDispatchToProps = dispatch => bindActionCreators(
    {
        createScheduledEvent,
        closeModal
    }
    , dispatch);

const mapStateToProps = state => (
    {
        newScheduledEvent: state.scheduledEvent.newScheduledEvent,
        requesting: state.scheduledEvent.newScheduledEvent.requesting,
        error: state.scheduledEvent.newScheduledEvent.error,
        createScheduledEventModalId: state.modal.modals[0].id
    }
);

export default connect(mapStateToProps, mapDispatchToProps)(NewCreateSchedule);