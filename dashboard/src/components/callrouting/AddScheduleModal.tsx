import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
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
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            currentButton: this.props.initialValues.type || '',
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            currentBackupButton: this.props.initialValues.backup_type || '',
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            showAdvance: this.props.initialValues.showAdvance || false,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            fileName: this.props.initialValues.fileName || '',
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            fileUploaded: this.props.initialValues.fileUploaded || false,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            backupFileName: this.props.initialValues.backupFileName || '',
            backupFileUploaded:
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                this.props.initialValues.backupFileUploaded || false,
        };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = async (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCallRoutingSchedule' does not exist o... Remove this comment to see the full error message
            addCallRoutingSchedule,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'uploadCallRoutingAudio' does not exist o... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showAdvance' does not exist on type '{}'... Remove this comment to see the full error message
        postObj.showAdvance = this.state.showAdvance;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
        postObj.type = values.type || '';
        if (values.type && values.type === 'TeamMember') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMemberId' does not exist on type '{}... Remove this comment to see the full error message
            postObj.teamMemberId = values.teamMembers;
        } else if (values.type && values.type === 'Schedule') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduleId' does not exist on type '{}'.
            postObj.scheduleId = values.schedules;
        } else if (values.type && values.type === 'PhoneNumber') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'phoneNumber' does not exist on type '{}'... Remove this comment to see the full error message
            postObj.phoneNumber = values.PhoneNumber;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showAdvance' does not exist on type 'Rea... Remove this comment to see the full error message
        if (this.state.showAdvance) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'callDropText' does not exist on type '{}... Remove this comment to see the full error message
            postObj.callDropText = values.callDropText;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'introtext' does not exist on type '{}'.
            postObj.introtext = values.introtext;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'backup_introtext' does not exist on type... Remove this comment to see the full error message
            postObj.backup_introtext = values.backup_introtext;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'backup_type' does not exist on type '{}'... Remove this comment to see the full error message
            postObj.backup_type = values.backup_type;
            if (values.backup_type && values.backup_type === 'TeamMember') {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'backup_teamMemberId' does not exist on t... Remove this comment to see the full error message
                postObj.backup_teamMemberId = values.backup_teamMembers;
            } else if (
                values.backup_type &&
                values.backup_type === 'Schedule'
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'backup_scheduleId' does not exist on typ... Remove this comment to see the full error message
                postObj.backup_scheduleId = values.backup_schedules;
            } else if (
                values.backup_type &&
                values.backup_type === 'PhoneNumber'
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'backup_phoneNumber' does not exist on ty... Remove this comment to see the full error message
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
    changefile = (e: $TSFixMe) => {
        e.preventDefault();
        const file = e.target.files[0];
        const fileName = file.name;
        this.setState({ fileName: fileName, fileUploaded: true });
    };
    removeIntroAudio = (backup: $TSFixMe) => {
        const _this = this;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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
    changeBackupFile = (e: $TSFixMe) => {
        e.preventDefault();
        const file = e.target.files[0];
        const fileName = file.name;
        this.setState({ backupFileName: fileName, backupFileUploaded: true });
    };
    toggleShowAdvance = (e: $TSFixMe) => {
        this.setState({ showAdvance: e.target.checked });
    };
    changeButton = (event: $TSFixMe, value: $TSFixMe) => {
        this.setState({ currentButton: value });
    };
    changeBackupButton = (event: $TSFixMe, value: $TSFixMe) => {
        this.setState({ currentBackupButton: value });
    };
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                this.props.closeThisDialog();
                return true;
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    .getElementById(`btn_modal_${this.props.data.number}`)
                    .click();
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCallRoutingSchedules' does not exist ... Remove this comment to see the full error message
            addCallRoutingSchedules,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMembers' does not exist on type 'Rea... Remove this comment to see the full error message
            teamMembers,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'schedules' does not exist on type 'Reado... Remove this comment to see the full error message
            schedules,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'uploadIntroAudioState' does not exist on... Remove this comment to see the full error message
            uploadIntroAudioState,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'uploadBackupIntroAudioState' does not ex... Remove this comment to see the full error message
            uploadBackupIntroAudioState,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeIntroAudioState' does not exist on... Remove this comment to see the full error message
            removeIntroAudioState,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeBackupIntroAudioState' does not ex... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showAdvance' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showAdvance' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ teamMembers: any; schedules: any; data: an... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showAdvance' does not exist on type 'Rea... Remove this comment to see the full error message
                                            if={this.state.showAdvance}
                                        >
                                            <ScheduleComponent
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ teamMembers: any; schedules: any; data: an... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AddScheduleModal.displayName = 'AddScheduleModal';

const AddScheduleModalForm = reduxForm({
    form: 'AttachRoutingSchedule', // a unique identifier for this form
    destroyOnUnmount: true,
    enableReinitialize: true,
})(AddScheduleModal);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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

function mapStateToProps(state: $TSFixMe, props: $TSFixMe) {
    const callRoutingId = props.data.callRoutingId;
    const teamMembersAndSchedules = state.callRouting.teamMembersAndSchedules;
    let teamMembers = teamMembersAndSchedules.teamMembers;
    teamMembers =
        teamMembers && teamMembers.length
            ? teamMembers.map((t: $TSFixMe) => {
                  return { name: t.name, id: t.userId };
              })
            : teamMembers;
    let schedules = teamMembersAndSchedules.schedules;
    schedules =
        schedules && schedules.length
            ? schedules.map((s: $TSFixMe) => {
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
            ? allNumbers.find((n: $TSFixMe) => n._id === callRoutingId)
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
