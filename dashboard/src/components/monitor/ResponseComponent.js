import React from 'react';
import { connect } from 'react-redux';
import { Component } from 'react';
import { Field, FieldArray, formValueSelector, arrayPush } from 'redux-form';
import PropTypes from 'prop-types';
import { ResponseParent } from './ResponseParent';
import ShouldRender from '../basic/ShouldRender';
import CRITERIA_TYPES from '../../constants/CRITERIA_TYPES';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import uuid from 'uuid';
import { RenderSelect } from '../basic/RenderSelect';

const newSelector = formValueSelector('NewMonitor');

const responsestyle = {
    marginTop: '10px',
    marginBottom: '-13px',
    borderRadius: '0px',
    boxShadow: 'none',
};

export class ResponseComponent extends Component {
    handleAddCriterion = type => {
        let head, tagline;
        switch (type) {
            case CRITERIA_TYPES.DOWN.type:
                head = CRITERIA_TYPES.DOWN.head;
                tagline = CRITERIA_TYPES.DOWN.tagline;
                break;
            case CRITERIA_TYPES.UP.type:
                head = CRITERIA_TYPES.UP.head;
                tagline = CRITERIA_TYPES.UP.tagline;
                break;
            case CRITERIA_TYPES.DEGRADED.type:
                head = CRITERIA_TYPES.DEGRADED.head;
                tagline = CRITERIA_TYPES.DEGRADED.tagline;
                break;
        }
        if (head && tagline) {
            this.props.addCriterion({ head, tagline, type, id: uuid.v4() });
        }
    };
    render() {
        const { type, criterion } = this.props;
        const status = {
            display: 'inline-block',
            borderRadius: '2px',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
        };
        const { id: criterionId, type: criterionType } = this.props.criterion;
        const criterionFieldName = `${criterionType}_${criterionId}`;

        switch (criterionType) {
            case CRITERIA_TYPES.UP:
                status.backgroundColor = 'rgb(117, 211, 128)'; // "green-status";
                break;
            case CRITERIA_TYPES.DEGRADED:
                status.backgroundColor = 'rgb(255, 222, 36)'; // "yellow-status";
                break;
            case CRITERIA_TYPES.DOWN:
                status.backgroundColor = 'rgb(250, 117, 90)'; // "red-status";
                break;
        }

        return (
            <div
                className="bs-ContentSection Card-root Card-shadow--medium"
                style={responsestyle}
            >
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span style={status}></span>
                                <span>{criterion.head}</span>
                            </span>
                            <p>
                                <span style={{ marginLeft: '18px' }}>
                                    {criterion.tagline}
                                </span>
                            </p>
                        </div>

                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div>
                                <button
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                    // onClick={this.addValue}
                                    onClick={() =>
                                        this.handleAddCriterion(criterionType)
                                    }
                                >
                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Add Criteria</span>
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        <FieldArray
                                            name={criterionFieldName}
                                            component={ResponseParent}
                                            bodyfield={criterion.bodyField}
                                            level={1}
                                            type={type}
                                        />
                                    </div>
                                </fieldset>
                            </div>
                        </div>

                        <ShouldRender
                            if={
                                this.props.schedules &&
                                this.props.schedules.length > 0
                            }
                        >
                            <div className="bs-Fieldset-row Flex-alignItems--flexStart">
                                <label
                                    className="bs-Fieldset-label"
                                    style={{
                                        flex: '0 0 7rem',
                                        textAlign: 'start',
                                    }}
                                    htmlFor={`callSchedule_${criterionFieldName}`}
                                >
                                    Call Schedule
                                </label>
                                <div className="bs-Fieldset-fields">
                                    <span className="flex">
                                        <Field
                                            className="db-select-nw"
                                            component={RenderSelect}
                                            name={`callSchedule_${criterionFieldName}`}
                                            id={`callSchedule_${criterionFieldName}`}
                                            placeholder="Call Schedule"
                                            style={{
                                                height: '28px',
                                            }}
                                            onChange={(e, scheduleId) => {
                                                this.props.handleScheduleChangedForCriterion(
                                                    criterionId,
                                                    scheduleId
                                                );
                                            }}
                                            options={[
                                                {
                                                    value: '',
                                                    label:
                                                        'Select call schedule',
                                                },
                                                ...(this.props.schedules &&
                                                    this.props.schedules
                                                        .length &&
                                                    this.props.schedules.map(
                                                        schedule => ({
                                                            value: schedule._id,
                                                            label:
                                                                schedule.name,
                                                        })
                                                    )),
                                            ]}
                                        />
                                    </span>
                                </div>
                            </div>
                        </ShouldRender>
                        {criterion.bodyField && criterion.bodyField.length ? (
                            <div>
                                <div className="bs-Fieldset-row">
                                    <label
                                        className="Checkbox"
                                        htmlFor={`createAlert_${criterionFieldName}`}
                                    >
                                        <Field
                                            component="input"
                                            type="checkbox"
                                            name={`createAlert_${criterionFieldName}`}
                                            data-test="RetrySettings-failedPaymentsCheckbox"
                                            className="Checkbox-source"
                                            id={`createAlert_${criterionFieldName}`}
                                        />
                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                            <div className="Checkbox-target Box-root">
                                                <div className="Checkbox-color Box-root"></div>
                                            </div>
                                        </div>
                                        <div className="Checkbox-label Box-root Margin-left--8">
                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>Create an incident.</span>
                                            </span>
                                        </div>
                                    </label>
                                </div>

                                <ShouldRender
                                    if={
                                        this.props
                                            .incidentCreatedAlertEnabledForCriterion
                                    }
                                >
                                    <div className="Flex-flex Flex-direction--column">
                                        <div
                                            className="bs-Fieldset-row Flex-alignItems--flexStart"
                                            style={{ gap: '1rem' }}
                                        >
                                            <label
                                                style={{ flex: '0 0 6rem' }}
                                                htmlFor={`incidentTitle_${criterionFieldName}`}
                                            >
                                                Incident title
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                    component={RenderField}
                                                    name={`incidentTitle_${criterionFieldName}`}
                                                    onChange={() => {
                                                        this.props.handleIncidentTitleChangedForCriterion(
                                                            criterionId
                                                        );
                                                    }}
                                                    id={`incidentTitle_${criterionFieldName}`}
                                                    placeholder="Custom Incident title"
                                                />
                                            </div>
                                        </div>
                                        <div
                                            className="bs-Fieldset-row  Flex-alignItems--flexStart"
                                            style={{ gap: '1rem' }}
                                        >
                                            <label
                                                style={{ flex: '0 0 6rem' }}
                                                htmlFor={`incidentDescription_${criterionFieldName}`}
                                            >
                                                Description
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    name={`incidentDescription_${criterionFieldName}`}
                                                    id={`incidentDescription_${criterionFieldName}`}
                                                    onChange={() => {
                                                        this.props.handleIncidentDescriptionChangedForCriterion(
                                                            criterionId
                                                        );
                                                    }}
                                                    component={RenderCodeEditor}
                                                    height="100px"
                                                    width="100%"
                                                    placeholder="Custom Incident Description"
                                                    wrapEnabled={true}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                                <ShouldRender
                                    if={criterionType !== CRITERIA_TYPES.UP}
                                >
                                    <div className="bs-Fieldset-row">
                                        <label
                                            className="Checkbox"
                                            htmlFor={`autoAcknowledge_${criterionFieldName}`}
                                        >
                                            <Field
                                                component="input"
                                                type="checkbox"
                                                name={`autoAcknowledge_${criterionFieldName}`}
                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                className="Checkbox-source"
                                                id={`autoAcknowledge_${criterionFieldName}`}
                                            />
                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                <div className="Checkbox-target Box-root">
                                                    <div className="Checkbox-color Box-root"></div>
                                                </div>
                                            </div>
                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>
                                                        Automatically
                                                        acknowledge an incident
                                                        when monitor is back up.
                                                    </span>
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </ShouldRender>
                                <ShouldRender
                                    if={criterionType !== CRITERIA_TYPES.UP}
                                >
                                    <div className="bs-Fieldset-row">
                                        <label
                                            className="Checkbox"
                                            htmlFor={`autoResolve_${criterionFieldName}`}
                                        >
                                            <Field
                                                component="input"
                                                type="checkbox"
                                                name={`autoResolve_${criterionFieldName}`}
                                                defaultChecked={true}
                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                className="Checkbox-source"
                                                id={`autoResolve_${criterionFieldName}`}
                                            />
                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                <div className="Checkbox-target Box-root">
                                                    <div className="Checkbox-color Box-root"></div>
                                                </div>
                                            </div>
                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>
                                                        Automatically resolve an
                                                        incident when monitor is
                                                        back up.
                                                    </span>
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </ShouldRender>
                            </div>
                        ) : (
                            <div className="bs-Fieldset-row">
                                <div className="Box-root Margin-bottom--12">
                                    <div
                                        data-test="RetrySettings-failedPaymentsRow"
                                        className="Box-root"
                                    >
                                        <label
                                            className="Checkbox"
                                            htmlFor="smssmtpswitch"
                                            style={{ marginLeft: '150px' }}
                                        >
                                            currently you do not have any
                                            criteria saved.Please click the Add
                                            Criteria button above to add one.
                                        </label>
                                        <div className="Box-root Padding-left--24">
                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                <div className="Box-root">
                                                    <div className="Box-root"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}

ResponseComponent.displayName = 'ResponseComponent';

ResponseComponent.propTypes = {
    type: PropTypes.string,
    addCriterion: PropTypes.func.isRequired,
    criterion: PropTypes.shape({
        id: PropTypes.string.isRequired,
        type: PropTypes.string.isRequired,
        head: PropTypes.string.isRequired,
        tagline: PropTypes.string.isRequired,
        bodyField: PropTypes.arrayOf(PropTypes.objectOf(PropTypes.any))
            .isRequired,
    }).isRequired,
    incidentCreatedAlertEnabledForCriterion: PropTypes.bool.isRequired,
    schedules: PropTypes.arrayOf(PropTypes.objectOf(PropTypes.any)).isRequired,
    handleIncidentTitleChangedForCriterion: PropTypes.func.isRequired,
    handleIncidentDescriptionChangedForCriterion: PropTypes.func.isRequired,
    handleScheduleChangedForCriterion: PropTypes.func.isRequired,
};

const mapDispatchToProps = {
    pushArray: arrayPush,
};

function mapStateToProps(state, ownProps) {
    return {
        // defaultBodyField: newSelector(
        //     state,
        //     `${ownProps.defaultBodyFieldName}`
        // ),
        incidentCreatedAlertEnabledForCriterion: newSelector(
            state,
            `createAlert_${ownProps.criterion.type}_${ownProps.criterion.id}`
        ),
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(ResponseComponent);
