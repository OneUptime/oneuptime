import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import ClickOutside from 'react-click-outside';
import {
    addCallRoutingSchedule,
    removeIntroAudio,
    uploadCallRoutingAudio,
} from '../../actions/callRouting';
import { RenderField } from '../basic/RenderField';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import ScheduleComponent from './ScheduleComponent';
import PropTypes from 'prop-types';
import { openModal, closeModal } from '../../actions/modal';



export class AddScheduleModal extends Component {
    constructor(props) {
        super(props);
        this.state = {
            currentButton: this.props.initialValues.type || '',
            currentBackupButton: this.props.initialValues.backup_type || '',
            showAdvance: this.props.initialValues.showAdvance || false,
            fileName: this.props.initialValues.fileName || '',
            fileUploaded: this.props.initialValues.fileUploaded || false,
            backupFileName: this.props.initialValues.backupFileName || '',
            backupFileUploaded:
                this.props.initialValues.backupFileUploaded || false,
        };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = async values => {
        const {
            closeThisDialog,
            data,
            currentProject,
            addCallRoutingSchedule,
            uploadCallRoutingAudio,
        } = this.props;
        if (values.introAudio && values.introAudio !== 'null') {
            const postAudio = new FormData();
            if (values.introAudio && typeof values.introAudio !== 'object') {
                postAudio.append('introAudio', values.introAudio);
            } else {
                postAudio.append(
                    'introAudio',
                    values.introAudio[0],
                    values.introAudio[0].name
                );
            }
            await uploadCallRoutingAudio(
                currentProject._id,
                data.callRoutingId,
                postAudio,
                'introAudio'
            );
        }

        if (values.backup_introAudio && values.backup_introAudio !== 'null') {
            const backupPostAudio = new FormData();
            if (
                values.backup_introAudio &&
                typeof values.backup_introAudio !== 'object'
            ) {
                backupPostAudio.append(
                    'backup_introAudio',
                    values.backup_introAudio
                );
            } else {
                backupPostAudio.append(
                    'backup_introAudio',
                    values.backup_introAudio[0],
                    values.backup_introAudio[0].name
                );
            }
            await uploadCallRoutingAudio(
                currentProject._id,
                data.callRoutingId,
                backupPostAudio,
                'backup_introAudio'
            );
        }

        const postObj = {};
        postObj.showAdvance = this.state.showAdvance;
        postObj.type = values.type || '';
        if (values.type && values.type === 'TeamMember') {
            postObj.teamMemberId = values.teamMembers;
        } else if (values.type && values.type === 'Schedule') {
            postObj.scheduleId = values.schedules;
        } else if (values.type && values.type === 'PhoneNumber') {
            postObj.phoneNumber = values.PhoneNumber;
        }
        if (this.state.showAdvance) {
            postObj.callDropText = values.callDropText;
            postObj.introtext = values.introtext;
            postObj.backup_introtext = values.backup_introtext;
            postObj.backup_type = values.backup_type;
            if (values.backup_type && values.backup_type === 'TeamMember') {
                postObj.backup_teamMemberId = values.backup_teamMembers;
            } else if (
                values.backup_type &&
                values.backup_type === 'Schedule'
            ) {
                postObj.backup_scheduleId = values.backup_schedules;
            } else if (
                values.backup_type &&
                values.backup_type === 'PhoneNumber'
            ) {
                postObj.backup_phoneNumber = values.backup_PhoneNumber;
            }
        }
        addCallRoutingSchedule(
            currentProject._id,
            data.callRoutingId,
            postObj
        ).then(
            function() {
                closeThisDialog();
            },
            function() {
                //do nothing.
            }
        );
       
    };
    changefile = e => {
        e.preventDefault();
        const file = e.target.files[0];
        const fileName = file.name;
        this.setState({ fileName: fileName, fileUploaded: true });
    };
    removeIntroAudio = backup => {
        const _this = this;
        const { currentProject, data, removeIntroAudio } = this.props;
        removeIntroAudio(currentProject._id, data.callRoutingId, backup).then(
            function() {
                if (backup) {
                    _this.setState({
                        backupFileName: '',
                        backupFileUploaded: false,
                    });
                    return;
                } else {
                    _this.setState({ fileName: '', fileUploaded: false });
                    return;
                }
            },
            function() {
                //do nothing.
            }
        );
    };
    changeBackupFile = e => {
        e.preventDefault();
        const file = e.target.files[0];
        const fileName = file.name;
        this.setState({ backupFileName: fileName, backupFileUploaded: true });
    };
    toggleShowAdvance = e => {
        this.setState({ showAdvance: e.target.checked });
    };
    changeButton = (event, value) => {
        this.setState({ currentButton: value });
    };
    changeBackupButton = (event, value) => {
        this.setState({ currentBackupButton: value });
    };
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.props.closeThisDialog();
                return true;
            case 'Enter':
                return document
                    .getElementById(`btn_modal_${this.props.data.number}`)
                    .click();
            default:
                return false;
        }
    };

    render() {
        const {
            handleSubmit,
            closeThisDialog,
            data,
            addCallRoutingSchedules,
            teamMembers,
            schedules,
            uploadIntroAudioState,
            uploadBackupIntroAudioState,
            removeIntroAudioState,
            removeBackupIntroAudioState,
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
        const disabled =
            introAudioLoading ||
            backupIntroAudioLoading ||
            (addCallRoutingSchedules && addCallRoutingSchedules.requesting);
        const error =
            (uploadIntroAudioState &&
                uploadIntroAudioState.error &&
                uploadIntroAudioState.callRoutingId === data.callRoutingId) ||
            (removeIntroAudioState &&
                removeIntroAudioState.error &&
                removeIntroAudioState.callRoutingId === data.callRoutingId) ||
            (uploadBackupIntroAudioState &&
                uploadBackupIntroAudioState.error &&
                uploadBackupIntroAudioState.callRoutingId ===
                    data.callRoutingId) ||
            (removeBackupIntroAudioState &&
                removeBackupIntroAudioState.error &&
                removeBackupIntroAudioState.callRoutingId ===
                    data.callRoutingId) ||
            (addCallRoutingSchedules && addCallRoutingSchedules.error);
        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 700 }}>
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20">
                                    <div
                                        className="bs-Modal-header-copy"
                                        style={{
                                            marginBottom: '10px',
                                            marginTop: '10px',
                                        }}
                                    >
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Add Routing Schedule</span>
                                        </span>
                                    </div>
                                    <div
                                        className="bs-Fieldset-row"
                                        style={{
                                            padding: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <label style={{ marginRight: 10 }}>
                                            Advanced Options
                                        </label>
                                        <div>
                                            <label className="Toggler-wrap">
                                                <input
                                                    className="btn-toggler"
                                                    type="checkbox"
                                                    onChange={
                                                        this.toggleShowAdvance
                                                    }
                                                    disabled={disabled}
                                                    name="moreOptions"
                                                    id="moreOptions"
                                                    checked={
                                                        this.state.showAdvance
                                                    }
                                                />
                                                <span className="TogglerBtn-slider round"></span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <form
                                id={`form_${data.number}`}
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <ShouldRender
                                            if={this.state.showAdvance}
                                        >
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
                                                                flexBasis:
                                                                    '20%',
                                                            }}
                                                        >
                                                            <span>
                                                                Call Drop Text
                                                            </span>
                                                        </label>
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                flexBasis:
                                                                    '80%',
                                                                maxWidth: '80%',
                                                            }}
                                                        >
                                                            <div
                                                                className="bs-Fieldset-field"
                                                                style={{
                                                                    width:
                                                                        '70%',
                                                                }}
                                                            >
                                                                <Field
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    name="callDropText"
                                                                    type="input"
                                                                    placeholder="Sorry could not find anyone on duty"
                                                                    id="callDropText"
                                                                    disabled={
                                                                        disabled
                                                                    }
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                        padding:
                                                                            '3px 5px',
                                                                    }}
                                                                    autoFocus={
                                                                        false
                                                                    }
                                                                />
                                                            </div>
                                                            <label className="bs-Fieldset-explanation">
                                                                <span>
                                                                    Message for
                                                                    the caller
                                                                    if there is
                                                                    no one
                                                                    available to
                                                                    take the
                                                                    call.
                                                                </span>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                        </ShouldRender>
                                        <ScheduleComponent
                                            teamMembers={teamMembers}
                                            schedules={schedules}
                                            data={data}
                                            changeButton={this.changeButton}
                                            stateData={{ ...this.state }}
                                            backup={false}
                                            disabled={disabled}
                                            changeBackupButton={
                                                this.changeBackupButton
                                            }
                                            changefile={this.changefile}
                                            removeIntroAudio={
                                                this.removeIntroAudio
                                            }
                                            changeBackupFile={
                                                this.changeBackupFile
                                            }
                                        />
                                        <ShouldRender
                                            if={this.state.showAdvance}
                                        >
                                            <ScheduleComponent
                                                teamMembers={teamMembers}
                                                schedules={schedules}
                                                data={data}
                                                changeButton={this.changeButton}
                                                stateData={this.state}
                                                backup={true}
                                                disabled={disabled}
                                                changeBackupButton={
                                                    this.changeBackupButton
                                                }
                                                changefile={this.changefile}
                                                removeIntroAudio={
                                                    this.removeIntroAudio
                                                }
                                                changeBackupFile={
                                                    this.changeBackupFile
                                                }
                                            />
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={error}>
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
                                                            {error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            disabled={disabled}
                                            onClick={closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id={`btn_modal_${data.number}`}
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={disabled}
                                            type="submit"
                                        >
                                            {!disabled && (
                                                <>
                                                    <span>ADD</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {disabled && <FormLoader />}
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

AddScheduleModal.displayName = 'AddScheduleModal';

const AddScheduleModalForm = reduxForm({
    form: 'AttachRoutingSchedule', // a unique identifier for this form
    destroyOnUnmount: true,
    enableReinitialize: true,
})(AddScheduleModal);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            addCallRoutingSchedule,
            openModal,
            closeModal,
            removeIntroAudio,
            uploadCallRoutingAudio,
        },
        dispatch
    );
};

function mapStateToProps(state, props) {
    const callRoutingId = props.data.callRoutingId;
    const teamMembersAndSchedules = state.callRouting.teamMembersAndSchedules;
    let teamMembers = teamMembersAndSchedules.teamMembers;
    teamMembers =
        teamMembers && teamMembers.length
            ? teamMembers.map(t => {
                  return { name: t.name, id: t.userId };
              })
            : teamMembers;
    let schedules = teamMembersAndSchedules.schedules;
    schedules =
        schedules && schedules.length
            ? schedules.map(s => {
                  return { name: s.name, id: s._id };
              })
            : schedules;
    const allNumbers =
        state.callRouting.allNumbers &&
        state.callRouting.allNumbers.numbers &&
        state.callRouting.allNumbers.numbers.length
            ? state.callRouting.allNumbers.numbers
            : [];
    const currentNumber =
        allNumbers && allNumbers.length
            ? allNumbers.find(n => n._id === callRoutingId)
            : null;
    const routingSchema =
        currentNumber &&
        currentNumber.routingSchema &&
        currentNumber.routingSchema.type
            ? currentNumber.routingSchema
            : {};
    const type =
        routingSchema.type && routingSchema.type.length
            ? routingSchema.type
            : '';
    const id =
        routingSchema.id && routingSchema.id.length ? routingSchema.id : null;
    const phoneNumber =
        routingSchema.phoneNumber && routingSchema.phoneNumber.length
            ? routingSchema.phoneNumber
            : null;
    const backup_phoneNumber =
        routingSchema.backup_phoneNumber &&
        routingSchema.backup_phoneNumber.length
            ? routingSchema.backup_phoneNumber
            : null;
    const backup_type =
        routingSchema.backup_type && routingSchema.backup_type.length
            ? routingSchema.backup_type
            : '';
    const backup_id =
        routingSchema.backup_id && routingSchema.backup_id.length
            ? routingSchema.backup_id
            : null;
    const showAdvance =
        routingSchema && routingSchema.type ? routingSchema.showAdvance : null;
    const fileName =
        routingSchema &&
        routingSchema.introAudioName &&
        routingSchema.introAudioName.length
            ? routingSchema.introAudioName
            : '';
    const fileUploaded = fileName && fileName.length ? true : false;
    const backupFileName =
        routingSchema &&
        routingSchema.backup_introAudioName &&
        routingSchema.backup_introAudioName.length
            ? routingSchema.backup_introAudioName
            : '';
    const backupFileUploaded =
        backupFileName && backupFileName.length ? true : false;
    const initialValues =
        type && id
            ? {
                  type: type,
                  teamMembers: type && type === 'TeamMember' && id ? id : '',
                  schedules: type && type === 'Schedule' && id ? id : '',
                  phoneNumber:
                      phoneNumber && phoneNumber.length ? phoneNumber : '',
                  showAdvance: showAdvance,
                  backup_type: backup_type,
                  backup_teamMembers:
                      backup_type && backup_type === 'TeamMember' && backup_id
                          ? backup_id
                          : '',
                  backup_schedules:
                      backup_type && backup_type === 'Schedule' && backup_id
                          ? backup_id
                          : '',
                  backup_PhoneNumber:
                      backup_phoneNumber && backup_phoneNumber.length
                          ? backup_phoneNumber
                          : '',
                  fileName: fileName,
                  fileUploaded: fileUploaded,
                  backupFileName: backupFileName,
                  backupFileUploaded: backupFileUploaded,
                  introtext:
                      routingSchema && routingSchema.introtext
                          ? routingSchema.introtext
                          : '',
                  backup_introtext:
                      routingSchema && routingSchema.backup_introtext
                          ? routingSchema.backup_introtext
                          : '',
                  callDropText:
                      routingSchema && routingSchema.callDropText
                          ? routingSchema.callDropText
                          : '',
              }
            : {};
    return {
        team: state.team,
        teamMembers,
        schedules,
        initialValues,
        currentNumber,
        addCallRoutingSchedules: state.callRouting.addCallRoutingSchedule,
        currentProject: state.project.currentProject,
        subProjects: state.subProject.subProjects.subProjects,
        uploadIntroAudioState: state.callRouting.uploadIntroAudioState,
        uploadBackupIntroAudioState:
            state.callRouting.uploadBackupIntroAudioState,
        removeIntroAudioState: state.callRouting.removeIntroAudioState,
        removeBackupIntroAudioState:
            state.callRouting.removeBackupIntroAudioState,
    };
}

AddScheduleModal.propTypes = {
    addCallRoutingSchedule: PropTypes.func,
    addCallRoutingSchedules: PropTypes.shape({
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    closeThisDialog: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    data: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    initialValues: PropTypes.shape({
        backupFileName: PropTypes.string,
        backupFileUploaded: PropTypes.bool,
        backup_type: PropTypes.string,
        fileName: PropTypes.string,
        fileUploaded: PropTypes.bool,
        showAdvance: PropTypes.bool,
        type: PropTypes.string,
    }),
    introAudioState: PropTypes.shape({
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    removeBackupIntroAudioState: PropTypes.shape({
        callRoutingId: PropTypes.any,
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    removeIntroAudio: PropTypes.func,
    removeIntroAudioState: PropTypes.shape({
        callRoutingId: PropTypes.any,
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    schedules: PropTypes.shape({
        map: PropTypes.func,
    }),
    teamMembers: PropTypes.shape({
        map: PropTypes.func,
    }),
    uploadBackupIntroAudioState: PropTypes.shape({
        callRoutingId: PropTypes.any,
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    uploadCallRoutingAudio: PropTypes.func,
    uploadIntroAudioState: PropTypes.shape({
        callRoutingId: PropTypes.any,
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(AddScheduleModalForm);
