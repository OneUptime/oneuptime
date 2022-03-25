import React, { Component, Fragment } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { Field } from 'redux-form';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { ValidateField } from '../../config';
import { UploadFile } from '../basic/UploadFile';
import { FormLoader2 } from '../basic/Loader';

interface ScheduleComponentProps {
    backup?: any;
    changeBackupButton?: any;
    changeBackupFile?: any;
    changeButton?: any;
    changefile?: any;
    data?: {
        callRoutingId?: any,
        number?: any
    };
    disabled?: any;
    introAudioState?: {
        requesting?: any
    };
    removeBackupIntroAudioState?: {
        callRoutingId?: any,
        requesting?: any
    };
    removeIntroAudio?: Function;
    removeIntroAudioState?: {
        callRoutingId?: any,
        requesting?: any
    };
    schedules?: {
        map?: Function
    };
    stateData?: {
        backupFileName?: any,
        backupFileUploaded?: any,
        currentBackupButton?: string,
        currentButton?: string,
        fileName?: any,
        fileUploaded?: any,
        showAdvance?: any
    };
    teamMembers?: {
        map?: Function
    };
    uploadBackupIntroAudioState?: {
        callRoutingId?: any,
        requesting?: any
    };
    uploadIntroAudioState?: {
        callRoutingId?: any,
        requesting?: any
    };
}

export class ScheduleComponent extends Component<ScheduleComponentProps> {
    override render() {
        const {

            data,

            teamMembers,

            schedules,

            changeButton,

            stateData,

            backup,

            changeBackupButton,

            disabled,

            uploadIntroAudioState,

            uploadBackupIntroAudioState,

            removeIntroAudioState,

            removeBackupIntroAudioState,

            changefile,

            removeIntroAudio,

            changeBackupFile,
        } = this.props;
        const introAudioLoading =
            (uploadIntroAudioState &&
                uploadIntroAudioState.requesting &&
                uploadIntroAudioState.callRoutingId === data.callRoutingId) ||
            (removeIntroAudioState &&
                removeIntroAudioState.requesting &&
                removeIntroAudioState.callRoutingId === data.callRoutingId);
        const backupIntroAudioLoading =
            (uploadBackupIntroAudioState &&
                uploadBackupIntroAudioState.requesting &&
                uploadBackupIntroAudioState.callRoutingId ===
                data.callRoutingId) ||
            (removeBackupIntroAudioState &&
                removeBackupIntroAudioState.requesting &&
                removeBackupIntroAudioState.callRoutingId ===
                data.callRoutingId);
        return (
            <Fragment>
                <ShouldRender if={stateData.showAdvance}>
                    <fieldset className="Margin-bottom--16">
                        <div className="bs-Fieldset-rows">
                            <div
                                className="bs-Fieldset-row"
                                style={{ padding: 0 }}
                            >
                                <label
                                    className="bs-Fieldset-label Text-align--left"
                                    htmlFor="introtext"
                                    style={{
                                        flexBasis: '20%',
                                    }}
                                >
                                    <span>
                                        {backup ? 'Backup ' : ''}Intro Text
                                    </span>
                                </label>
                                <div
                                    className="bs-Fieldset-fields"
                                    style={{
                                        flexBasis: '80%',
                                        maxWidth: '80%',
                                    }}
                                >
                                    <div
                                        className="bs-Fieldset-field"
                                        style={{
                                            width: '70%',
                                        }}
                                    >
                                        <Field
                                            component={RenderField}
                                            name={`${backup ? 'backup_' : ''
                                                }introtext`}
                                            type="input"
                                            placeholder="Hello Customer"
                                            id={`${backup ? 'backup_' : ''
                                                }introtext`}
                                            disabled={disabled}
                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                            style={{
                                                width: '100%',
                                                padding: '3px 5px',
                                            }}
                                            autoFocus={false}
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
                                style={{
                                    padding: 0,
                                }}
                            >
                                <label
                                    className="bs-Fieldset-label Text-align--left"
                                    style={{
                                        flexBasis: '20%',
                                    }}
                                >
                                    {backup ? 'Backup ' : ''}Intro Audio
                                </label>
                                <div className="bs-Fieldset-fields">
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--center"
                                        style={{
                                            flexWrap: 'wrap',
                                        }}
                                    >
                                        <div>
                                            <label
                                                className="bs-Button bs-DeprecatedButton bs-FileUploadButton"

                                                type="button"
                                            >
                                                <ShouldRender
                                                    if={
                                                        (!backup &&
                                                            !stateData.fileUploaded) ||
                                                        (backup &&
                                                            !stateData.backupFileUploaded)
                                                    }
                                                >
                                                    <span className="bs-Button--icon bs-Button--new"></span>
                                                    <span>
                                                        Upload{' '}
                                                        {backup
                                                            ? 'Backup '
                                                            : ''}
                                                        Intro Audio
                                                    </span>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        (!backup &&
                                                            stateData.fileUploaded) ||
                                                        (backup &&
                                                            stateData.backupFileUploaded)
                                                    }
                                                >
                                                    <span className="bs-Button--icon bs-Button--edit"></span>
                                                    <span>
                                                        Change{' '}
                                                        {backup
                                                            ? 'Backup '
                                                            : ''}
                                                        Intro Audio
                                                    </span>
                                                </ShouldRender>
                                                <div className="bs-FileUploadButton-inputWrap">
                                                    <Field
                                                        className="bs-FileUploadButton-input"
                                                        component={UploadFile}
                                                        name={`${backup
                                                            ? 'backup_'
                                                            : ''
                                                            }introAudio`}
                                                        id={`${backup
                                                            ? 'backup_'
                                                            : ''
                                                            }introAudio`}
                                                        accept="audio/mp3"
                                                        disabled={disabled}
                                                        onChange={
                                                            backup
                                                                ? changeBackupFile
                                                                : changefile
                                                        }
                                                        fileInputKey={''}
                                                    />
                                                </div>
                                            </label>
                                        </div>
                                        <ShouldRender
                                            if={
                                                (!backup &&
                                                    stateData.fileUploaded) ||
                                                (backup &&
                                                    stateData.backupFileUploaded)
                                            }
                                        >
                                            <div
                                                className="bs-Fieldset-fields"
                                                style={{
                                                    padding: '0',
                                                }}
                                            >
                                                <button
                                                    className="bs-Button bs-DeprecatedButton bs-FileUploadButton"
                                                    type="button"
                                                    onClick={() =>
                                                        removeIntroAudio(backup)
                                                    }
                                                    disabled={disabled}
                                                    style={{
                                                        margin: '10px 10px 0 0',
                                                    }}
                                                >
                                                    {(!backup &&
                                                        !introAudioLoading) ||
                                                        (backup &&
                                                            !backupIntroAudioLoading) ? (
                                                        <>
                                                            <span className="bs-Button--icon bs-Button--delete"></span>
                                                            <span>
                                                                Remove{' '}
                                                                {backup
                                                                    ? 'Backup '
                                                                    : ''}
                                                                Intro Audio
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <FormLoader2 />
                                                    )}
                                                </button>
                                            </div>
                                            <div
                                                className="bs-Fieldset-fields"
                                                style={{
                                                    padding: '0',
                                                }}
                                            >
                                                <label className="bs-Fieldset-explanation">
                                                    <span>
                                                        {backup
                                                            ? stateData.backupFileName
                                                            : stateData.fileName}
                                                    </span>
                                                </label>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </fieldset>
                </ShouldRender>
                <fieldset style={{ paddingTop: 0 }}>
                    <div className="bs-Fieldset-rows">
                        <div className="bs-Fieldset-row" style={{ padding: 0 }}>
                            <label
                                className="bs-Fieldset-label Text-align--left"
                                style={{
                                    flexBasis: '20%',
                                }}
                            ></label>
                            <div
                                className="bs-Fieldset-fields"
                                style={{
                                    flexBasis: '80%',
                                    maxWidth: '80%',
                                }}
                            >
                                <div
                                    className="bs-Fieldset-field"
                                    style={{
                                        width: '100%',
                                        fontWeight: 500,
                                    }}
                                >
                                    Who to forward call to
                                </div>
                            </div>
                        </div>
                    </div>
                </fieldset>
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
                                        htmlFor={`${backup ? 'backup_' : ''
                                            }Team_member_${data.number}`}
                                    >
                                        <Field
                                            component="input"
                                            type="radio"
                                            name={`${backup ? 'backup_' : ''
                                                }type`}
                                            className="bs-Radio-source"
                                            id={`${backup ? 'backup_' : ''
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
                                            name={`${backup ? 'backup_' : ''
                                                }teamMembers`}
                                            id={`${backup ? 'backup_' : ''
                                                }teamMembers`}
                                            disabled={disabled}
                                            placeholder="Select team member"
                                            options={
                                                teamMembers &&
                                                teamMembers.map((t: $TSFixMe) => {
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
                                        htmlFor={`${backup ? 'backup_' : ''
                                            }Schedule_${data.number}`}
                                    >
                                        <Field
                                            component="input"
                                            type="radio"
                                            name={`${backup ? 'backup_' : ''
                                                }type`}
                                            disabled={disabled}
                                            className="bs-Radio-source"
                                            id={`${backup ? 'backup_' : ''
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
                                            name={`${backup ? 'backup_' : ''
                                                }schedules`}
                                            id={`${backup ? 'backup_' : ''
                                                }schedules`}
                                            disabled={disabled}
                                            placeholder="Select a schedule"
                                            options={
                                                schedules &&
                                                schedules.map((s: $TSFixMe) => {
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
                                        htmlFor={`${backup ? 'backup_' : ''
                                            }Custom_number_${data.number}`}
                                    >
                                        <Field
                                            component="input"
                                            type="radio"
                                            name={`${backup ? 'backup_' : ''
                                                }type`}
                                            disabled={disabled}
                                            className="bs-Radio-source"
                                            id={`${backup ? 'backup_' : ''
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
                                            name={`${backup ? 'backup_' : ''
                                                }PhoneNumber`}
                                            disabled={disabled}
                                            id={`${backup ? 'backup_' : ''
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
const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({}, dispatch);
};

function mapStateToProps(state: $TSFixMe) {
    return {
        currentProject: state.project.currentProject,
        uploadIntroAudioState: state.callRouting.uploadIntroAudioState,
        uploadBackupIntroAudioState:
            state.callRouting.uploadBackupIntroAudioState,
        removeIntroAudioState: state.callRouting.removeIntroAudioState,
        removeBackupIntroAudioState:
            state.callRouting.removeBackupIntroAudioState,
    };
}


ScheduleComponent.propTypes = {
    backup: PropTypes.any,
    changeBackupButton: PropTypes.any,
    changeBackupFile: PropTypes.any,
    changeButton: PropTypes.any,
    changefile: PropTypes.any,
    data: PropTypes.shape({
        callRoutingId: PropTypes.any,
        number: PropTypes.any,
    }),
    disabled: PropTypes.any,
    introAudioState: PropTypes.shape({
        requesting: PropTypes.any,
    }),
    removeBackupIntroAudioState: PropTypes.shape({
        callRoutingId: PropTypes.any,
        requesting: PropTypes.any,
    }),
    removeIntroAudio: PropTypes.func,
    removeIntroAudioState: PropTypes.shape({
        callRoutingId: PropTypes.any,
        requesting: PropTypes.any,
    }),
    schedules: PropTypes.shape({
        map: PropTypes.func,
    }),
    stateData: PropTypes.shape({
        backupFileName: PropTypes.any,
        backupFileUploaded: PropTypes.any,
        currentBackupButton: PropTypes.string,
        currentButton: PropTypes.string,
        fileName: PropTypes.any,
        fileUploaded: PropTypes.any,
        showAdvance: PropTypes.any,
    }),
    teamMembers: PropTypes.shape({
        map: PropTypes.func,
    }),
    uploadBackupIntroAudioState: PropTypes.shape({
        callRoutingId: PropTypes.any,
        requesting: PropTypes.any,
    }),
    uploadIntroAudioState: PropTypes.shape({
        callRoutingId: PropTypes.any,
        requesting: PropTypes.any,
    }),
};

export default connect(mapStateToProps, mapDispatchToProps)(ScheduleComponent);
