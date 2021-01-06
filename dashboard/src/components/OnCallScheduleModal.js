import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment-timezone';
import { history } from '../store';
class OnCallScheduleModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--default Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            You are currently on-call duty.
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <ul>
                                        {this.props.data.schedules.map(
                                            (schedule, i) => {
                                                return (
                                                    <li key={i}>
                                                        <b
                                                            onClick={() => {
                                                                history.push(
                                                                    `/dashboard/project/${this
                                                                        .props
                                                                        .data
                                                                        .currentProjectId
                                                                    }/sub-project/${schedule.projectId &&
                                                                    schedule
                                                                        .projectId
                                                                        ._id}/schedule/${schedule.scheduleId &&
                                                                        schedule
                                                                            .scheduleId
                                                                            ._id}`
                                                                );

                                                                this.props.closeThisDialog();
                                                            }}
                                                            style={{
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                        >
                                                            <span
                                                                style={{
                                                                    fontSize:
                                                                        '20px',
                                                                }}
                                                            >
                                                                &middot;
                                                            </span>{' '}
                                                            <span
                                                                style={{
                                                                    textDecoration:
                                                                        'underline',
                                                                }}
                                                            >
                                                                {schedule.scheduleId &&
                                                                    schedule
                                                                        .scheduleId
                                                                        .name}
                                                            </span>
                                                            :
                                                        </b>{' '}
                                                        {!schedule.isOnDutyAllTheTime ? (
                                                            <span>
                                                                {this.props.data
                                                                    .status ===
                                                                    'active' ? (
                                                                        <span>
                                                                            Your
                                                                            duty
                                                                        ends at{' '}
                                                                            <b>
                                                                                {moment(
                                                                                    schedule.endTime,
                                                                                    'HH:mm'
                                                                                ).format(
                                                                                    'hh:mm A'
                                                                                )}
                                                                                {schedule.timezone &&
                                                                                    ` (${schedule.timezone})`}
                                                                            </b>{' '}
                                                                        and your
                                                                        next
                                                                        duty
                                                                        begins
                                                                        at
                                                                        </span>
                                                                    ) : (
                                                                        <span>
                                                                            Your
                                                                            next
                                                                            duty
                                                                            begins
                                                                            at
                                                                        </span>
                                                                    )}{' '}
                                                                <b>
                                                                    {moment(
                                                                        schedule.startTime,
                                                                        'HH:mm'
                                                                    ).format(
                                                                        'hh:mm A'
                                                                    )}
                                                                    {schedule.timezone &&
                                                                        ` (${schedule.timezone})`}
                                                                </b>{' '}
                                                                and ends at{' '}
                                                                <b>
                                                                    {moment(
                                                                        schedule.endTime,
                                                                        'HH:mm'
                                                                    ).format(
                                                                        'hh:mm A'
                                                                    )}
                                                                    {schedule.timezone &&
                                                                        ` (${schedule.timezone})`}
                                                                    .
                                                                </b>
                                                            </span>
                                                        ) : (
                                                                <span>
                                                                    You&#39;re
                                                                    currently on
                                                                call duty for {" "}
                                                                    {
                                                                        schedule.scheduleId &&
                                                                        schedule
                                                                            .scheduleId
                                                                            .name
                                                                    }
                                                                </span>
                                                            )}
                                                    </li>
                                                );
                                            }
                                        )}
                                    </ul>
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                        type="button"
                                        onClick={this.props.closeThisDialog}
                                        autoFocus={true}
                                    >
                                        <span>Close</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

OnCallScheduleModal.displayName = 'OnCallScheduleModal';

OnCallScheduleModal.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    currentProjectId: PropTypes.string,
    data: PropTypes.object,
};

export default OnCallScheduleModal;
