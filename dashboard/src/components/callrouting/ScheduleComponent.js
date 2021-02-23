import React, { Component, Fragment } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field } from 'redux-form';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { ValidateField } from '../../config';

export class ScheduleComponent extends Component {
    render() {
        const {
            data,
            teamMembers,
            schedules,
            changeButton,
            stateData,
            backup,
            changeBackupButton,
            disabled,
        } = this.props;
        return (
            <Fragment>
                <fieldset>
                    <div className="bs-Fieldset-rows">
                        <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                            <label
                                className="bs-Fieldset-label Text-align--left"
                                htmlFor="createIncident"
                                style={{
                                    flexBasis: '20%',
                                }}
                            >
                                <span></span>
                            </label>
                            <div
                                className="bs-Fieldset-fields"
                                style={{
                                    paddingTop: '6px',
                                    flexBasis: '80%',
                                    maxWidth: '80%',
                                }}
                            >
                                <div className="bs-Fieldset-field">
                                    <label
                                        className="bs-Radio"
                                        style={{
                                            marginRight: '12px',
                                        }}
                                        htmlFor={`${
                                            backup ? 'backup_' : ''
                                        }Team_member_${data.number}`}
                                    >
                                        <Field
                                            component="input"
                                            type="radio"
                                            name={`${
                                                backup ? 'backup_' : ''
                                            }type`}
                                            className="bs-Radio-source"
                                            id={`${
                                                backup ? 'backup_' : ''
                                            }Team_member_${data.number}`}
                                            value="TeamMember"
                                            style={{
                                                width: 0,
                                            }}
                                            disabled={disabled}
                                            onChange={
                                                backup
                                                    ? changeBackupButton
                                                    : changeButton
                                            }
                                        />
                                        <span className="bs-Radio-button"></span>
                                        <div
                                            className="Box-root"
                                            style={{
                                                paddingLeft: '5px',
                                            }}
                                        >
                                            <span>
                                                {backup ? 'Backup ' : ''}
                                                Team Member
                                            </span>
                                        </div>
                                    </label>
                                </div>
                                <label
                                    className="bs-Fieldset-explanation"
                                    style={{ margin: '0px 0px 0px 22px' }}
                                >
                                    <span>
                                        Attach Individual team members to route
                                        calls to them.
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </fieldset>
                <ShouldRender
                    if={
                        (!backup && stateData.currentButton === 'TeamMember') ||
                        (backup &&
                            stateData.currentBackupButton === 'TeamMember')
                    }
                >
                    <fieldset
                        style={{
                            marginLeft: '150px',
                        }}
                    >
                        <div className="bs-Fieldset-rows">
                            <div
                                className="bs-Fieldset-row"
                                style={{
                                    padding: 0,
                                }}
                            >
                                <label className="bs-Fieldset-label Text-align--left">
                                    <span>
                                        {backup ? 'Backup ' : ''}Team Members
                                    </span>
                                </label>
                                <div className="bs-Fieldset-fields">
                                    <div
                                        className="bs-Fieldset-field"
                                        style={{
                                            width: '250px',
                                        }}
                                    >
                                        <Field
                                            component={RenderSelect}
                                            name={`${
                                                backup ? 'backup_' : ''
                                            }teamMembers`}
                                            id={`${
                                                backup ? 'backup_' : ''
                                            }teamMembers`}
                                            disabled={disabled}
                                            placeholder="Select team member"
                                            options={
                                                teamMembers &&
                                                teamMembers.map(t => {
                                                    return {
                                                        value: t.id,
                                                        label: t.name,
                                                    };
                                                })
                                            }
                                            validate={ValidateField.select}
                                            className="db-select-nw db-MultiSelect-input"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </fieldset>
                </ShouldRender>
                <fieldset>
                    <div className="bs-Fieldset-rows">
                        <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                            <label
                                className="bs-Fieldset-label Text-align--left"
                                htmlFor="createIncident"
                                style={{
                                    flexBasis: '20%',
                                }}
                            >
                                <span></span>
                            </label>
                            <div
                                className="bs-Fieldset-fields"
                                style={{
                                    paddingTop: '6px',
                                    flexBasis: '80%',
                                    maxWidth: '80%',
                                }}
                            >
                                <div className="bs-Fieldset-field">
                                    <label
                                        className="bs-Radio"
                                        style={{
                                            marginRight: '12px',
                                        }}
                                        htmlFor={`${
                                            backup ? 'backup_' : ''
                                        }Schedule_${data.number}`}
                                    >
                                        <Field
                                            component="input"
                                            type="radio"
                                            name={`${
                                                backup ? 'backup_' : ''
                                            }type`}
                                            disabled={disabled}
                                            className="bs-Radio-source"
                                            id={`${
                                                backup ? 'backup_' : ''
                                            }Schedule_${data.number}`}
                                            value="Schedule"
                                            style={{
                                                width: 0,
                                            }}
                                            onChange={
                                                backup
                                                    ? changeBackupButton
                                                    : changeButton
                                            }
                                        />
                                        <span className="bs-Radio-button"></span>
                                        <div
                                            className="Box-root"
                                            style={{
                                                paddingLeft: '5px',
                                            }}
                                        >
                                            <span>
                                                {backup ? 'Backup ' : ''}
                                                On-Call Schedule
                                            </span>
                                        </div>
                                    </label>
                                </div>
                                <label
                                    className="bs-Fieldset-explanation"
                                    style={{ margin: '0px 0px 0px 22px' }}
                                >
                                    <span>
                                        Attach On-call schedule to route calls
                                        to members on call duty as specified by
                                        escalation policy.
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </fieldset>
                <ShouldRender
                    if={
                        (!backup && stateData.currentButton === 'Schedule') ||
                        (backup && stateData.currentBackupButton === 'Schedule')
                    }
                >
                    <fieldset
                        style={{
                            marginLeft: '150px',
                        }}
                    >
                        <div className="bs-Fieldset-rows">
                            <div
                                className="bs-Fieldset-row"
                                style={{
                                    padding: 0,
                                }}
                            >
                                <label className="bs-Fieldset-label Text-align--left">
                                    <span>
                                        {backup ? 'Backup ' : ''}On-Call
                                        Schedules
                                    </span>
                                </label>
                                <div className="bs-Fieldset-fields">
                                    <div
                                        className="bs-Fieldset-field"
                                        style={{
                                            width: '250px',
                                        }}
                                    >
                                        <Field
                                            component={RenderSelect}
                                            name={`${
                                                backup ? 'backup_' : ''
                                            }schedules`}
                                            id={`${
                                                backup ? 'backup_' : ''
                                            }schedules`}
                                            disabled={disabled}
                                            placeholder="Select a schedule"
                                            options={
                                                schedules &&
                                                schedules.map(s => {
                                                    return {
                                                        value: s.id,
                                                        label: s.name,
                                                    };
                                                })
                                            }
                                            validate={ValidateField.select}
                                            className="db-select-nw db-MultiSelect-input"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </fieldset>
                </ShouldRender>
                <fieldset>
                    <div className="bs-Fieldset-rows">
                        <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                            <label
                                className="bs-Fieldset-label Text-align--left"
                                htmlFor="createIncident"
                                style={{
                                    flexBasis: '20%',
                                }}
                            >
                                <span></span>
                            </label>
                            <div
                                className="bs-Fieldset-fields"
                                style={{
                                    paddingTop: '6px',
                                    flexBasis: '80%',
                                    maxWidth: '80%',
                                }}
                            >
                                <div className="bs-Fieldset-field">
                                    <label
                                        className="bs-Radio"
                                        style={{
                                            marginRight: '12px',
                                        }}
                                        htmlFor={`${
                                            backup ? 'backup_' : ''
                                        }Custom_number_${data.number}`}
                                    >
                                        <Field
                                            component="input"
                                            type="radio"
                                            name={`${
                                                backup ? 'backup_' : ''
                                            }type`}
                                            disabled={disabled}
                                            className="bs-Radio-source"
                                            id={`${
                                                backup ? 'backup_' : ''
                                            }Custom_number_${data.number}`}
                                            value="PhoneNumber"
                                            style={{
                                                width: 0,
                                            }}
                                            onChange={
                                                backup
                                                    ? changeBackupButton
                                                    : changeButton
                                            }
                                        />
                                        <span className="bs-Radio-button"></span>
                                        <div
                                            className="Box-root"
                                            style={{
                                                paddingLeft: '5px',
                                            }}
                                        >
                                            <span>
                                                {backup ? 'Backup ' : ''}
                                                Phone Number
                                            </span>
                                        </div>
                                    </label>
                                </div>
                                <label
                                    className="bs-Fieldset-explanation"
                                    style={{ margin: '0px 0px 0px 22px' }}
                                >
                                    <span>
                                        Attach custom phone numbers to route
                                        calls to them.
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </fieldset>
                <ShouldRender
                    if={
                        (!backup &&
                            stateData.currentButton === 'PhoneNumber') ||
                        (backup &&
                            stateData.currentBackupButton === 'PhoneNumber')
                    }
                >
                    <fieldset
                        className="Margin-bottom--16"
                        style={{
                            marginLeft: '150px',
                        }}
                    >
                        <div className="bs-Fieldset-rows">
                            <div
                                className="bs-Fieldset-row"
                                style={{
                                    padding: 0,
                                }}
                            >
                                <label className="bs-Fieldset-label Text-align--left">
                                    <span>
                                        {backup ? 'backup ' : ''}Phone Number
                                    </span>
                                </label>
                                <div className="bs-Fieldset-fields">
                                    <div
                                        className="bs-Fieldset-field"
                                        style={{
                                            width: '250px',
                                        }}
                                    >
                                        <Field
                                            component={RenderField}
                                            name={`${
                                                backup ? 'backup_' : ''
                                            }PhoneNumber`}
                                            disabled={disabled}
                                            id={`${
                                                backup ? 'backup_' : ''
                                            }PhoneNumber`}
                                            type="text"
                                            placeholder="Enter a phone number"
                                            validate={ValidateField.text}
                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </fieldset>
                </ShouldRender>
            </Fragment>
        );
    }
}

ScheduleComponent.displayName = 'ScheduleComponent';
const mapDispatchToProps = dispatch => {
    return bindActionCreators({}, dispatch);
};

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
    };
}

ScheduleComponent.propTypes = {
    backup: PropTypes.any,
    changeBackupButton: PropTypes.any,
    changeButton: PropTypes.any,
    data: PropTypes.shape({
        number: PropTypes.any,
    }),
    disabled: PropTypes.any,
    schedules: PropTypes.shape({
        map: PropTypes.func,
    }),
    stateData: PropTypes.shape({
        currentBackupButton: PropTypes.string,
        currentButton: PropTypes.string,
    }),
    teamMembers: PropTypes.shape({
        map: PropTypes.func,
    }),
};

export default connect(mapStateToProps, mapDispatchToProps)(ScheduleComponent);
