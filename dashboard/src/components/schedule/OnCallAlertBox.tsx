import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, FieldArray, arrayPush } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { getEscalation, addEscalation } from '../../actions/schedule';
import { getProjectGroups } from '../../actions/group';
import { subProjectTeamLoading } from '../../actions/team';
import { RenderEscalation } from './RenderEscalation';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

//Client side validation
function validate(values: $TSFixMe) {
    const errors = {};
    const alertArrayErrors = [];

    if (values.OnCallAlertBox) {
        for (let i = 0; i < values.OnCallAlertBox.length; i++) {
            const repeatErrors = {};
            const escalationArrayErrors: $TSFixMe = [];
            if (values.OnCallAlertBox[i]) {
                if (values.OnCallAlertBox[i].callReminders === '') {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'callReminders' does not exist on type '{... Remove this comment to see the full error message
                    repeatErrors.callReminders =
                        'Please enter how many reminders to send';
                    alertArrayErrors[i] = repeatErrors;
                } else if (
                    !Validate.number(values.OnCallAlertBox[i].callReminders)
                ) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'callReminders' does not exist on type '{... Remove this comment to see the full error message
                    repeatErrors.callReminders = 'This should be a number.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (values.OnCallAlertBox[i].callReminders <= 0) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'callReminders' does not exist on type '{... Remove this comment to see the full error message
                    repeatErrors.callReminders =
                        'This should be greater than 0.';
                    alertArrayErrors[i] = repeatErrors;
                }

                if (values.OnCallAlertBox[i].smsReminders === '') {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsReminders' does not exist on type '{}... Remove this comment to see the full error message
                    repeatErrors.smsReminders =
                        'Please enter how many reminders to send';
                    alertArrayErrors[i] = repeatErrors;
                } else if (
                    !Validate.number(values.OnCallAlertBox[i].smsReminders)
                ) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsReminders' does not exist on type '{}... Remove this comment to see the full error message
                    repeatErrors.smsReminders = 'This should be a number.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (values.OnCallAlertBox[i].smsReminders <= 0) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsReminders' does not exist on type '{}... Remove this comment to see the full error message
                    repeatErrors.smsReminders = 'This should be greater than 0';
                    alertArrayErrors[i] = repeatErrors;
                }

                if (values.OnCallAlertBox[i].emailReminders === '') {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailReminders' does not exist on type '... Remove this comment to see the full error message
                    repeatErrors.emailReminders =
                        'Please enter how many reminders to send.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (
                    !Validate.number(values.OnCallAlertBox[i].emailReminders)
                ) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailReminders' does not exist on type '... Remove this comment to see the full error message
                    repeatErrors.emailReminders = 'This should be a number.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (values.OnCallAlertBox[i].emailReminders <= 0) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailReminders' does not exist on type '... Remove this comment to see the full error message
                    repeatErrors.emailReminders =
                        'This should be greater than 0';
                    alertArrayErrors[i] = repeatErrors;
                }

                if (values.OnCallAlertBox[i].pushReminders === '') {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pushReminders' does not exist on type '{... Remove this comment to see the full error message
                    repeatErrors.pushReminders =
                        'Please enter how many reminders to send.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (
                    !Validate.number(values.OnCallAlertBox[i].pushReminders)
                ) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pushReminders' does not exist on type '{... Remove this comment to see the full error message
                    repeatErrors.pushReminders = 'This should be a number.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (values.OnCallAlertBox[i].pushReminders <= 0) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pushReminders' does not exist on type '{... Remove this comment to see the full error message
                    repeatErrors.pushReminders =
                        'This should be greater than 0';
                    alertArrayErrors[i] = repeatErrors;
                }
            }
            values.OnCallAlertBox[i] &&
                values.OnCallAlertBox[i].teams &&
                values.OnCallAlertBox[i].teams.forEach((val: $TSFixMe, j: $TSFixMe) => {
                    const escalationErrors = {};
                    if (val) {
                        if (
                            val.teamMembers[0] &&
                            val.teamMembers[0].userId === ''
                        ) {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type '{}'.
                            escalationErrors.userId = 'Please select a member.';
                            escalationArrayErrors[j] = escalationErrors;
                        }
                    }
                });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalation' does not exist on type '{}'.
            repeatErrors.escalation = escalationArrayErrors;
            alertArrayErrors[i] = repeatErrors;
        }

        if (alertArrayErrors.length) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'OnCallAlertBox' does not exist on type '... Remove this comment to see the full error message
            errors.OnCallAlertBox = alertArrayErrors;
        }
    }

    return errors;
}

export class OnCallAlertBox extends Component {
    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProjectGroups' does not exist on type... Remove this comment to see the full error message
            getProjectGroups,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
            subProjectTeamLoading,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduleId' does not exist on type 'Read... Remove this comment to see the full error message
            scheduleId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getEscalation' does not exist on type 'R... Remove this comment to see the full error message
            getEscalation,
        } = this.props;
        if (subProjectId) {
            subProjectTeamLoading(subProjectId);
            getProjectGroups(subProjectId, 0, 0, true);
            if (scheduleId) {
                getEscalation(subProjectId, scheduleId);
            }
        }
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            prevProps.subProjectId !== this.props.subProjectId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'schedule' does not exist on type 'Readon... Remove this comment to see the full error message
            prevProps.schedule !== this.props.schedule
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                subProjectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProjectGroups' does not exist on type... Remove this comment to see the full error message
                getProjectGroups,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
                subProjectTeamLoading,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduleId' does not exist on type 'Read... Remove this comment to see the full error message
                scheduleId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getEscalation' does not exist on type 'R... Remove this comment to see the full error message
                getEscalation,
            } = this.props;
            if (subProjectId) {
                subProjectTeamLoading(subProjectId);
                getProjectGroups(subProjectId, 0, 0, true);
                if (scheduleId) {
                    getEscalation(subProjectId, scheduleId);
                }
            }
        }
    }
    submitForm = async (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
        const { subProjectId, scheduleId } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addEscalation' does not exist on type 'R... Remove this comment to see the full error message
        await this.props.addEscalation(subProjectId, scheduleId, values);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'afterSave' does not exist on type 'Reado... Remove this comment to see the full error message
        if (this.props.afterSave) this.props.afterSave();
    };

    renderAddEscalationPolicyButton = () => (
        <button
            type="button"
            className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
            onClick={() =>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pushArray' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.pushArray('OnCallAlertBox', 'OnCallAlertBox', {
                    callReminders: 3,
                    smsReminders: 3,
                    emailReminders: 3,
                    pushReminders: 3,
                    email: true,
                    sms: false,
                    call: false,
                    push: false,
                    rotateBy: '',
                    rotationInterval: '',
                    firstRotationOn: '',
                    rotationTimezone: '',
                    teams: [
                        {
                            teamMembers: [],
                        },
                    ],
                })
            }
        >
            Add Escalation Policy
        </button>
    );

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            {' '}
                                            Call Duty and Escalation Policy
                                        </span>
                                    </span>
                                    <p>
                                        Define your call duty here. Alert your
                                        backup on-call team if your primary
                                        on-call team does not respond to alerts.
                                    </p>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                    <div className="Box-root">
                                        {this.renderAddEscalationPolicyButton()}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit(this.submitForm)}>
                            <div className="bs-ContentSection-content Box-root">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root">
                                        <fieldset
                                            className="bs-Fieldset"
                                            style={{ paddingTop: '0px' }}
                                        >
                                            <div className="bs-Fieldset-rows">
                                                <FieldArray
                                                    name="OnCallAlertBox"
                                                    component={RenderEscalation}
                                                    subProjectId={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                        this.props.subProjectId
                                                    }
                                                />
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <div className="bs-Tail-copy">
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                        style={{ marginTop: '10px' }}
                                    >
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalationPolicy' does not exist on type... Remove this comment to see the full error message
                                                this.props.escalationPolicy
                                                    .error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalationPolicy' does not exist on type... Remove this comment to see the full error message
                                                            .escalationPolicy
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>

                                <div>
                                    {this.renderAddEscalationPolicyButton()}
                                    <button
                                        id="saveSchedulePolicy"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalationPolicy' does not exist on type... Remove this comment to see the full error message
                                            this.props.escalationPolicy
                                                .requesting
                                        }
                                        type="submit"
                                    >
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalationPolicy' does not exist on type... Remove this comment to see the full error message
                                        {!this.props.escalationPolicy
                                            .requesting && <span>Save</span>}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalationPolicy' does not exist on type... Remove this comment to see the full error message
                                        {this.props.escalationPolicy
                                            .requesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
OnCallAlertBox.displayName = 'OnCallAlertBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
OnCallAlertBox.propTypes = {
    getEscalation: PropTypes.func.isRequired,
    afterSave: PropTypes.func.isRequired,
    pushArray: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    addEscalation: PropTypes.func.isRequired,
    escalationPolicy: PropTypes.object.isRequired,
    scheduleId: PropTypes.string.isRequired,
    schedule: PropTypes.string.isRequired,
    subProjectId: PropTypes.string.isRequired,
    subProjectTeamLoading: PropTypes.func.isRequired,
    getProjectGroups: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    // NOTE: pushArray / arrayPush MUST be aliased or it will not work. https://justinnoel.dev/2018/09/22/adding-to-redux-form-fieldarray/
    {
        getEscalation,
        addEscalation,
        subProjectTeamLoading,
        pushArray: arrayPush,
        getProjectGroups,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    /* state.schedule.escalations && state.schedule.escalations.length ?
     state.schedule.escalations.map((value)=>{
         return {escalation: [value]};
     }) : */
    const { escalations } = state.schedule;

    const { scheduleSlug } = props.match.params;

    const OnCallAlertBox =
        escalations && escalations.length > 0
            ? escalations
            : [
                  {
                      callReminders: '3',
                      smsReminders: '3',
                      emailReminders: '3',
                      pushReminders: '3',
                      email: true,
                      sms: false,
                      call: false,
                      push: false,
                      teams: [
                          {
                              teamMembers: [
                                  {
                                      member: '',
                                      timezone: '',
                                      startTime: '',
                                      endTime: '',
                                  },
                              ],
                          },
                      ],
                  },
              ];
    let schedule = state.schedule.subProjectSchedules.map(
        (subProjectSchedule: $TSFixMe) => {
            return subProjectSchedule.schedules.find(
                (schedule: $TSFixMe) => schedule.slug === scheduleSlug
            );
        }
    );

    schedule = schedule.find(
        (schedule: $TSFixMe) => schedule && schedule.slug === scheduleSlug
    );
    return {
        initialValues: { OnCallAlertBox },
        escalationPolicy: state.schedule.escalation,
        schedule,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        scheduleId: schedule && schedule._id,
        subProjectId: schedule && schedule.projectId._id,
    };
};

const OnCallAlertForm = reduxForm({
    form: 'OnCallAlertBox', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
    enableReinitialize: true,
})(OnCallAlertBox);

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(OnCallAlertForm)
);
