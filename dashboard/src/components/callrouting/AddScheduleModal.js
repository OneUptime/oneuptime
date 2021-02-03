import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import ClickOutside from 'react-click-outside';
import { addCallRoutingSchedule } from '../../actions/callRouting';
import { RenderSelect } from '../basic/RenderSelect';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { openModal, closeModal } from '../../actions/modal';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS, ValidateField } from '../../config';

export class AddScheduleModal extends Component {
    constructor(props) {
        super(props);
        this.state = {
            currentButton: this.props.initialValues.type || '',
        };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const {
            closeThisDialog,
            data,
            currentProject,
            addCallRoutingSchedule,
        } = this.props;
        const postObj = {};
        if (values.type && values.type.length) {
            postObj.type = values.type;
        }
        if (values.type && values.type === 'TeamMember') {
            postObj.teamMemberId = values.teamMembers;
        }
        if (values.type && values.type === 'Schedule') {
            postObj.scheduleId = values.schedules;
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
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > CALL ROUTING > ADD SCHEDULE',
                values
            );
        }
    };
    changeButton = (event, value) => {
        this.setState({ currentButton: value });
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
        } = this.props;
        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM db-InviteSetting">
                    <div className="bs-Modal bs-Modal--large">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <form
                                id={`form_${data.number}`}
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div
                                    className="bs-Modal-header"
                                    style={{ paddingBottom: '1px' }}
                                >
                                    <div className="bs-Modal-header-copy">
                                        <div className="db-InviteSetting-header">
                                            <h2>
                                                <span>
                                                    Add Routing Schedule
                                                </span>
                                            </h2>
                                            <p className="db-InviteSetting-headerDescription">
                                                <span>
                                                    Attach a team member or a
                                                    call schedule to route the
                                                    call on selected phone
                                                    number.
                                                </span>
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bs-Modal-content bs-u-paddingless">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="db-RoleRadioList">
                                            <div className="db-RoleRadioList-row">
                                                <label className="bs-Radio">
                                                    <Field
                                                        id={`Team_member_${data.number}`}
                                                        className="bs-Radio-source"
                                                        name="type"
                                                        component="input"
                                                        type="radio"
                                                        value="TeamMember"
                                                        onChange={
                                                            this.changeButton
                                                        }
                                                    />
                                                    <span className="bs-Radio-button"></span>
                                                    <span className="bs-Radio-label">
                                                        <div className="db-RoleRadioListLabel">
                                                            <div className="db-RoleRadioListLabel-name">
                                                                <span>
                                                                    Team Member
                                                                </span>
                                                            </div>
                                                            <div className="db-RoleRadioListLabel-description">
                                                                <span>
                                                                    Attach
                                                                    Individual
                                                                    team members
                                                                    to route
                                                                    calls to
                                                                    them.
                                                                </span>
                                                            </div>
                                                            <div className="db-RoleRadioListLabel-info">
                                                                <div className="Box-root Flex-inlineFlex">
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="Box-root Flex-flex"></div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </span>
                                                </label>
                                            </div>
                                            <div className="db-RoleRadioList-row">
                                                <label className="bs-Radio">
                                                    <Field
                                                        id={`Schedule_${data.number}`}
                                                        className="bs-Radio-source"
                                                        name="type"
                                                        component="input"
                                                        type="radio"
                                                        value="Schedule"
                                                        onChange={
                                                            this.changeButton
                                                        }
                                                    />
                                                    <span className="bs-Radio-button"></span>
                                                    <span className="bs-Radio-label">
                                                        <div className="db-RoleRadioListLabel">
                                                            <div className="db-RoleRadioListLabel-name">
                                                                <span>
                                                                    On-Call
                                                                    Schedule
                                                                </span>
                                                            </div>
                                                            <div className="db-RoleRadioListLabel-description">
                                                                <span>
                                                                    Attach
                                                                    On-call
                                                                    schedule to
                                                                    route calls
                                                                    to members
                                                                    on call duty
                                                                    as specified
                                                                    by
                                                                    escalation
                                                                    policy.
                                                                </span>
                                                            </div>
                                                            <div className="db-RoleRadioListLabel-info">
                                                                <div className="Box-root Flex-inlineFlex">
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="Box-root Flex-flex"></div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <ShouldRender
                                    if={
                                        this.state.currentButton ===
                                        'TeamMember'
                                    }
                                >
                                    <fieldset
                                        className="Margin-bottom--16"
                                        style={{
                                            paddingLeft: '75px',
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
                                                    <span>Team Members</span>
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <div
                                                        className="bs-Fieldset-field"
                                                        style={{
                                                            width: '250px',
                                                        }}
                                                    >
                                                        <Field
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name="teamMembers"
                                                            id="teamMembers"
                                                            placeholder="Select team member"
                                                            options={
                                                                teamMembers &&
                                                                teamMembers.map(
                                                                    t => {
                                                                        return {
                                                                            value:
                                                                                t.id,
                                                                            label:
                                                                                t.name,
                                                                        };
                                                                    }
                                                                )
                                                            }
                                                            validate={
                                                                ValidateField.select
                                                            }
                                                            className="db-select-nw db-MultiSelect-input"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </ShouldRender>
                                <ShouldRender
                                    if={this.state.currentButton === 'Schedule'}
                                >
                                    <fieldset
                                        className="Margin-bottom--16"
                                        style={{
                                            paddingLeft: '75px',
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
                                                        On-Call Schedules
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
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name="schedules"
                                                            id="schedules"
                                                            placeholder="Select a schedule"
                                                            options={
                                                                schedules &&
                                                                schedules.map(
                                                                    s => {
                                                                        return {
                                                                            value:
                                                                                s.id,
                                                                            label:
                                                                                s.name,
                                                                        };
                                                                    }
                                                                )
                                                            }
                                                            validate={
                                                                ValidateField.select
                                                            }
                                                            className="db-select-nw db-MultiSelect-input"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </ShouldRender>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={addCallRoutingSchedules.error}
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
                                                            {
                                                                addCallRoutingSchedules.error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
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
                                            disabled={
                                                addCallRoutingSchedules.requesting
                                            }
                                            type="submit"
                                        >
                                            {!addCallRoutingSchedules.requesting && (
                                                <>
                                                    <span>ADD</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {addCallRoutingSchedules.requesting && (
                                                <FormLoader />
                                            )}
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
    const type =
        currentNumber &&
        currentNumber.routingSchema &&
        currentNumber.routingSchema.type &&
        currentNumber.routingSchema.type.length
            ? currentNumber.routingSchema.type
            : '';
    const id =
        currentNumber &&
        currentNumber.routingSchema &&
        currentNumber.routingSchema.id &&
        currentNumber.routingSchema.id.length
            ? currentNumber.routingSchema.id
            : null;
    let schedule, teamMember;
    if (type && type === 'TeamMember' && id) {
        teamMember = teamMembers.find(t => t.id === id);
    } else if (type && type === 'Schedule' && id) {
        schedule = schedules.find(s => s.id === id);
    }
    const initialValues =
        type && id
            ? {
                  type: type,
                  teamMembers:
                      teamMember && teamMember.id && teamMember.id.length
                          ? teamMember.id
                          : '',
                  schedules:
                      schedule && schedule.id && schedule.id.length
                          ? schedule.id
                          : '',
              }
            : { type: '', teamMembers: '', schedules: '' };
    return {
        team: state.team,
        teamMembers,
        schedules,
        currentNumber,
        initialValues,
        addCallRoutingSchedules: state.callRouting.addCallRoutingSchedule,
        currentProject: state.project.currentProject,
        subProjects: state.subProject.subProjects.subProjects,
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
        type: PropTypes.string,
    }),
    schedules: PropTypes.shape({
        map: PropTypes.func,
    }),
    teamMembers: PropTypes.shape({
        map: PropTypes.func,
    }),
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(AddScheduleModalForm);
