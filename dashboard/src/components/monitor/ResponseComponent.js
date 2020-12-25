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
    addValue = () => {
        this.props.pushArray('NewMonitor', this.props.fieldname, {
            match: '',
            responseType: '',
            filter: '',
            field1: '',
            field2: '',
            field3: false,
        });
    };

    handleAddCriterion = type => {
        let head, tagline;
        switch (type) {
            case CRITERIA_TYPES.DOWN:
                head = 'Monitor down criteria';
                tagline =
                    'This is where you describe when your monitor is considered down';
                break;
            case CRITERIA_TYPES.UP:
                head = 'Monitor up criteria';
                tagline =
                    'This is where you describe when your monitor is considered up';
                break;
            case CRITERIA_TYPES.DEGRADED:
                head = 'Monitor degraded criteria';
                tagline =
                    'This is where you describe when your monitor is considered degraded';
                break;
        }
        if (head && tagline) {
            this.props.addCriterion({ head, tagline, type, id: uuid.v4() });
        }
    };
    render() {
        const { type } = this.props;
        const status = {
            display: 'inline-block',
            borderRadius: '2px',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
        };

        if (this.props.fieldname === `up_${this.props.index}`) {
            status.backgroundColor = 'rgb(117, 211, 128)'; // "green-status";
        } else if (this.props.fieldname === `down_${this.props.index}`) {
            status.backgroundColor = 'rgb(250, 117, 90)'; // "red-status";
        } else if (this.props.fieldname === `degraded_${this.props.index}`) {
            status.backgroundColor = 'rgb(255, 222, 36)'; // "yellow-status";
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
                                <span>{this.props.head}</span>
                            </span>
                            <p>
                                <span style={{ marginLeft: '18px' }}>
                                    {this.props.tagline}
                                </span>
                            </p>
                        </div>

                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div>
                                <button
                                    id={`${this.props.fieldname}_addCriteria`}
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                    // onClick={this.addValue}
                                    onClick={() =>
                                        this.handleAddCriterion(
                                            this.props.criterion.type
                                        )
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
                                            name={this.props.fieldname}
                                            component={ResponseParent}
                                            bodyfield={this.props.bodyfield}
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
                                >
                                    Call Schedule
                                </label>
                                <div className="bs-Fieldset-fields">
                                    <span className="flex">
                                        <Field
                                            className="db-select-nw"
                                            component={RenderSelect}
                                            name={`callSchedule_${
                                                this.props.criterion
                                                    ? this.props.criterion.id
                                                    : ''
                                            }`}
                                            id="callSchedule"
                                            placeholder="Call Schedule"
                                            style={{
                                                height: '28px',
                                            }}
                                            onChange={(e, scheduleId) => {
                                                this.props.handleScheduleChangedForCriterion(
                                                    this.props.criterion.id,
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
                        {this.props.bodyfield && this.props.bodyfield.length ? (
                            <div>
                                <div className="bs-Fieldset-row">
                                    <label
                                        className="Checkbox"
                                        htmlFor={`${
                                            this.props.criterion
                                                ? this.props.criterion.id
                                                : ''
                                        }_incidentCreatedAlert`}
                                    >
                                        <Field
                                            component="input"
                                            type="checkbox"
                                            name={`${
                                                this.props.criterion
                                                    ? this.props.criterion.id
                                                    : ''
                                            }_incidentCreatedAlert`}
                                            data-test="RetrySettings-failedPaymentsCheckbox"
                                            className="Checkbox-source"
                                            id={`${
                                                this.props.criterion
                                                    ? this.props.criterion.id
                                                    : ''
                                            }_incidentCreatedAlert`}
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
                                            <label style={{ flex: '0 0 6rem' }}>
                                                Incident title
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                    component={RenderField}
                                                    name={`incident_title_${
                                                        this.props.criterion
                                                            ? this.props
                                                                  .criterion.id
                                                            : ''
                                                    }`}
                                                    onChange={() => {
                                                        this.props.handleIncidentTitleChangedForCriterion(
                                                            this.props.criterion
                                                                .id
                                                        );
                                                    }}
                                                    id="title"
                                                    placeholder="Custom Incident title"
                                                />
                                            </div>
                                        </div>
                                        <div
                                            className="bs-Fieldset-row  Flex-alignItems--flexStart"
                                            style={{ gap: '1rem' }}
                                        >
                                            <label style={{ flex: '0 0 6rem' }}>
                                                Description
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    name={`incident_description_${
                                                        this.props.criterion
                                                            ? this.props
                                                                  .criterion.id
                                                            : ''
                                                    }`}
                                                    onChange={() => {
                                                        this.props.handleIncidentDescriptionChangedForCriterion(
                                                            this.props.criterion
                                                                .id
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
                                    if={
                                        this.props.fieldname !==
                                        `up_${this.props.index}`
                                    }
                                >
                                    <div className="bs-Fieldset-row">
                                        <label
                                            className="Checkbox"
                                            htmlFor={`${this.props.fieldname}_autoAcknowledge`}
                                        >
                                            <Field
                                                component="input"
                                                type="checkbox"
                                                name={`${this.props.fieldname}_autoAcknowledge`}
                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                className="Checkbox-source"
                                                id={`${this.props.fieldname}_autoAcknowledge`}
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
                                    if={
                                        this.props.fieldname !==
                                        `up_${this.props.index}`
                                    }
                                >
                                    <div className="bs-Fieldset-row">
                                        <label
                                            className="Checkbox"
                                            htmlFor={`${this.props.fieldname}_autoResolve`}
                                        >
                                            <Field
                                                component="input"
                                                type="checkbox"
                                                name={`${this.props.fieldname}_autoResolve`}
                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                className="Checkbox-source"
                                                id={`${this.props.fieldname}_autoResolve`}
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
    pushArray: PropTypes.func,
    bodyfield: PropTypes.array,
    fieldname: PropTypes.string,
    head: PropTypes.string,
    tagline: PropTypes.string,
    index: PropTypes.number,
    type: PropTypes.string,
    addCriterion: PropTypes.func.isRequired,
    criterion: PropTypes.shape({
        id: PropTypes.string.isRequired,
        type: PropTypes.string.isRequired,
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
        bodyfield: newSelector(state, `${ownProps.fieldname}`),
        incidentCreatedAlertEnabledForCriterion: newSelector(
            state,
            `${
                ownProps.criterion ? ownProps.criterion.id : ''
            }_incidentCreatedAlert`
        ),
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(ResponseComponent);
