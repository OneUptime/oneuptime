import React from 'react';
import { connect } from 'react-redux';
import { Component } from 'react';
import {
    Field,
    FieldArray,
    formValueSelector,
    change,
    arrayPush,
} from 'redux-form';
import PropTypes from 'prop-types';
import { ResponseParent } from './ResponseParent';
import ShouldRender from '../basic/ShouldRender';
import CRITERIA_TYPES from '../../constants/CRITERIA_TYPES';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import uuid from 'uuid';
import ScheduleInput from '../schedule/ScheduleInput';

const newSelector = formValueSelector('NewMonitor');

const responsestyle = {
    marginTop: '10px',
    marginBottom: '-13px',
    borderRadius: '0px',
    boxShadow: 'none',
};

export class ResponseComponent extends Component {
    handleAddFilterCriteria() {
        const criterionFieldName = `${this.props.criterion.type}_${this.props.criterion.id}`;

        this.props.arrayPush('NewMonitor', criterionFieldName, {
            match: '',
            responseType: '',
            filter: '',
            field1: '',
            field2: '',
            field3: false,
        });
    }

    /**
     * calls removeCriterion on parent component
     *
     * @param {string} id id of the criterion to remove
     * @memberof ResponseComponent
     */
    handleRemoveCriterion(id) {
        this.props.removeCriterion(id);
    }

    /**
     * calls addCriterion on parent component
     *
     * @param {*} type
     * @memberof ResponseComponent
     */
    handleAddCriterion(type) {
        this.props.addCriterion({ type, id: uuid.v4() });
    }

    render() {
        const {
            type,
            criterion,
            schedules,
            currentProject,
            criterionBodyField,
        } = this.props;

        const status = {
            display: 'inline-block',
            borderRadius: '2px',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
        };

        const { id: criterionId, type: criterionType } = criterion;
        const criterionFieldName = `${criterionType}_${criterionId}`;
        let head;
        let tagline;

        switch (criterionType) {
            case CRITERIA_TYPES.UP.type:
                status.backgroundColor = 'rgb(117, 211, 128)'; // "green-status";
                head = CRITERIA_TYPES.UP.head;
                tagline = CRITERIA_TYPES.UP.tagline;
                break;
            case CRITERIA_TYPES.DEGRADED.type:
                status.backgroundColor = 'rgb(255, 222, 36)'; // "yellow-status";
                head = CRITERIA_TYPES.DEGRADED.head;
                tagline = CRITERIA_TYPES.DEGRADED.tagline;
                break;
            case CRITERIA_TYPES.DOWN.type:
                status.backgroundColor = 'rgb(250, 117, 90)'; // "red-status";
                head = CRITERIA_TYPES.DOWN.head;
                tagline = CRITERIA_TYPES.DOWN.tagline;
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
                                <span>
                                    {criterion.default
                                        ? 'Default Criteria'
                                        : head}
                                </span>
                            </span>
                            <p>
                                <span style={{ marginLeft: '18px' }}>
                                    {criterion.default
                                        ? 'This criteria will be executed when no other criteria is met'
                                        : tagline}
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
                            {!criterion.default && (
                                <div className="Margin-left--16">
                                    <button
                                        className="bs-Button bs-Button--red Box-background--red"
                                        type="button"
                                        // onClick={this.addValue}
                                        onClick={() =>
                                            this.handleRemoveCriterion(
                                                criterionId
                                            )
                                        }
                                    >
                                        <span>
                                            <span>Remove This Criteria</span>
                                        </span>
                                    </button>
                                </div>
                            )}
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
                                            bodyfield={criterionBodyField}
                                            level={1}
                                            type={type}
                                        />
                                    </div>
                                </fieldset>
                            </div>
                        </div>

                        <ShouldRender
                            if={
                                criterion.default ||
                                (criterionBodyField &&
                                    criterionBodyField.length &&
                                    schedules &&
                                    schedules.length > 0)
                            }
                        >
                            <div className="bs-Fieldset-row Flex-alignContent--start">
                                <label className="Padding-right--12">
                                    <span>Call Schedules</span>
                                </label>
                                <FieldArray
                                    name={`criterion_${criterionId}_schedules`}
                                    schedules={schedules}
                                    currentProject={currentProject}
                                    component={ScheduleInput}
                                />
                            </div>
                        </ShouldRender>

                        {criterion.default ||
                        (criterionBodyField && criterionBodyField.length) ? (
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
                                                        Create an incident.
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
                                                <div className="Checkbox-label Box-root Margin-left--8">
                                                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>
                                                            Automatically
                                                            acknowledge an
                                                            incident when
                                                            monitor is back up.
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        </label>
                                    </div>
                                </ShouldRender>
                            </div>
                        ) : (
                            <div className="bs-Fieldset-row">
                                <div className="Flex-flex Flex-direction--column Margin-all--32 Flex-alignItems--start">
                                    <span>
                                        Currently you do not have any filter
                                        criteria saved
                                    </span>

                                    <button
                                        className="Button bs-ButtonLegacy ActionIconParent Margin-bottom--16"
                                        type="button"
                                        // onClick={this.addValue}
                                        onClick={() =>
                                            this.handleAddFilterCriteria(
                                                criterionType
                                            )
                                        }
                                    >
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>Add Filter Criteria</span>
                                        </span>
                                    </button>
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
    removeCriterion: PropTypes.func.isRequired,
    criterion: PropTypes.shape({
        id: PropTypes.string.isRequired,
        type: PropTypes.string.isRequired,
        default: PropTypes.bool,
    }).isRequired,
    incidentCreatedAlertEnabledForCriterion: PropTypes.bool.isRequired,
    schedules: PropTypes.arrayOf(
        PropTypes.shape({
            _id: PropTypes.string.isRequired,
            name: PropTypes.string.isRequired,
        })
    ).isRequired,
    criterionBodyField: PropTypes.objectOf(
        PropTypes.shape({
            match: PropTypes.string,
            responseType: PropTypes.string.isRequired,
            filter: PropTypes.string.isRequired,
            field1: PropTypes.string.isRequired,
            field2: PropTypes.string.isRequired,
            field3: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
        })
    ).isRequired,
    currentProject: PropTypes.shape({
        _id: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired,
    }).isRequired,
    arrayPush: PropTypes.func.isRequired,
};

function mapStateToProps(state, ownProps) {
    return {
        incidentCreatedAlertEnabledForCriterion: newSelector(
            state,
            `createAlert_${ownProps.criterion.type}_${ownProps.criterion.id}`
        ),
        currentProject: state.project.currentProject,
        criterionBodyField: newSelector(
            state,
            `${ownProps.criterion.type}_${ownProps.criterion.id}`
        ),
    };
}

const mapDispatchToProps = {
    change,
    arrayPush,
};

export default connect(mapStateToProps, mapDispatchToProps)(ResponseComponent);
