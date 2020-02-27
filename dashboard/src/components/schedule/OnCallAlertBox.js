import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, FieldArray, arrayPush } from 'redux-form';
import { withRouter } from 'react-router';
import { getEscalation, addEscalation } from '../../actions/schedule';
import { subProjectTeamLoading } from '../../actions/team';
import { RenderEscalation } from './RenderEscalation';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

//Client side validation
function validate(values) {
    const errors = {};
    const alertArrayErrors = [];

    if (values.OnCallAlertBox) {
        for (let i = 0; i < values.OnCallAlertBox.length; i++) {
            const repeatErrors = {};
            const escalationArrayErrors = [];
            if (values.OnCallAlertBox[i]) {
                if (values.OnCallAlertBox[i].callReminders === '') {
                    repeatErrors.callReminders =
                        'Please enter how many reminders to send';
                    alertArrayErrors[i] = repeatErrors;
                } else if (
                    !Validate.number(values.OnCallAlertBox[i].callReminders)
                ) {
                    repeatErrors.callReminders = 'This should be a number.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (values.OnCallAlertBox[i].callReminders <= 0) {
                    repeatErrors.callReminders =
                        'This should be greater than 0.';
                    alertArrayErrors[i] = repeatErrors;
                }

                if (values.OnCallAlertBox[i].smsReminders === '') {
                    repeatErrors.smsReminders =
                        'Please enter how many reminders to send';
                    alertArrayErrors[i] = repeatErrors;
                } else if (
                    !Validate.number(values.OnCallAlertBox[i].smsReminders)
                ) {
                    repeatErrors.smsReminders = 'This should be a number.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (values.OnCallAlertBox[i].smsReminders <= 0) {
                    repeatErrors.smsReminders = 'This should be greater than 0';
                    alertArrayErrors[i] = repeatErrors;
                }

                if (values.OnCallAlertBox[i].emailReminders === '') {
                    repeatErrors.emailReminders =
                        'Please enter how many reminders to send.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (
                    !Validate.number(values.OnCallAlertBox[i].emailReminders)
                ) {
                    repeatErrors.emailReminders = 'This should be a number.';
                    alertArrayErrors[i] = repeatErrors;
                } else if (values.OnCallAlertBox[i].emailReminders <= 0) {
                    repeatErrors.emailReminders =
                        'This should be greater than 0';
                    alertArrayErrors[i] = repeatErrors;
                }
            }
            values.OnCallAlertBox[i] &&
                values.OnCallAlertBox[i].teams &&
                values.OnCallAlertBox[i].teams.forEach((val, j) => {
                    const escalationErrors = {};
                    if (val) {
                        if (
                            val.teamMembers[0] &&
                            val.teamMembers[0].userId === ''
                        ) {
                            escalationErrors.userId = 'Please select a member.';
                            escalationArrayErrors[j] = escalationErrors;
                        }
                    }
                });
            repeatErrors.escalation = escalationArrayErrors;
            alertArrayErrors[i] = repeatErrors;
        }

        if (alertArrayErrors.length) {
            errors.OnCallAlertBox = alertArrayErrors;
        }
    }

    return errors;
}

export class OnCallAlertBox extends Component {
    componentDidMount() {
        const { subProjectId, scheduleId } = this.props;
        this.props.getEscalation(subProjectId, scheduleId);
        this.props.subProjectTeamLoading(subProjectId);
    }
    submitForm = async values => {
        const { subProjectId, scheduleId } = this.props;
        await this.props.addEscalation(subProjectId, scheduleId, values);
        if (this.props.afterSave) this.props.afterSave();
        if (!IS_DEV) {
            logEvent('Links Updated', values);
        }
    };

    render() {
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
                                            Call Schedule and Escalation Policy
                                        </span>
                                    </span>
                                    <p>
                                        Define your call schedule here. Alert
                                        your backup on-call team if your primary
                                        on-call team does not respond to alerts.
                                    </p>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                    <div className="Box-root">
                                        <button
                                            type="button"
                                            className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                            onClick={() =>
                                                this.props.pushArray(
                                                    'OnCallAlertBox',
                                                    'OnCallAlertBox',
                                                    {
                                                        callReminders: 3,
                                                        smsReminders: 3,
                                                        emailReminders: 3,
                                                        email: true,
                                                        sms: false,
                                                        call: false,
                                                        rotateBy: '',
                                                        rotationInterval: '',
                                                        firstRotationOn: '',
                                                        rotationTimezone: '',
                                                        teams: [
                                                            {
                                                                teamMembers: [],
                                                            },
                                                        ],
                                                    }
                                                )
                                            }
                                        >
                                            Add Escalation Policy
                                        </button>
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
                                                            .escalationPolicy
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>

                                <div>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            this.props.escalationPolicy
                                                .requesting
                                        }
                                        type="submit"
                                    >
                                        {!this.props.escalationPolicy
                                            .requesting && <span>Save</span>}
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

OnCallAlertBox.displayName = 'OnCallAlertBox';

OnCallAlertBox.propTypes = {
    getEscalation: PropTypes.func.isRequired,
    afterSave: PropTypes.func.isRequired,
    pushArray: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    addEscalation: PropTypes.func.isRequired,
    escalationPolicy: PropTypes.object.isRequired,
    scheduleId: PropTypes.string.isRequired,
    subProjectId: PropTypes.string.isRequired,
    subProjectTeamLoading: PropTypes.func.isRequired,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        // NOTE: pushArray / arrayPush MUST be aliased or it will not work. https://justinnoel.dev/2018/09/22/adding-to-redux-form-fieldarray/
        {
            getEscalation,
            addEscalation,
            subProjectTeamLoading,
            pushArray: arrayPush,
        },
        dispatch
    );

const mapStateToProps = (state, props) => {
    /* state.schedule.escalations && state.schedule.escalations.length ?
     state.schedule.escalations.map((value)=>{
         return {escalation: [value]};
     }) : */
    const { escalations } = state.schedule;

    const { projectId } = props.match.params;
    const { scheduleId } = props.match.params;
    const { subProjectId } = props.match.params;

    const OnCallAlertBox =
        escalations && escalations.length > 0
            ? escalations
            : [
                  {
                      callReminders: '3',
                      smsReminders: '3',
                      emailReminders: '3',
                      email: true,
                      sms: false,
                      call: false,
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

    return {
        initialValues: { OnCallAlertBox },
        escalationPolicy: state.schedule.escalation,
        projectId,
        scheduleId,
        subProjectId,
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
