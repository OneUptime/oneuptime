import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { history, RootState } from '../../store';

import ClickOutside from 'react-click-outside';
import { addScheduleEvent } from '../../actions/scheduledEvent';
import moment from 'moment';

interface ScheduleHeaderModalProps {
    closeThisDialog: Function;
    currentProjectSlug?: string;
    data?: object;
    addScheduleEvent?: Function;
}

class ScheduleHeaderModal extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':

                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    navigatToSchedule = (schedule: $TSFixMe) => {

        const { data } = this.props;

        history.push(
            `/dashboard/project/${data.currentProjectSlug}/scheduledEvents/${schedule.slug}`
        );

        this.props.addScheduleEvent(schedule);

        this.props.closeThisDialog();
    };

    override render() {

        const { closeThisDialog, data } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--default Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                These scheduled events are
                                                ongoing{' '}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <ul>
                                            {data.schedules.map((schedule: $TSFixMe) => <li key={schedule._id}>
                                                <span
                                                    style={{
                                                        fontWeight: '500',
                                                        cursor: 'pointer',
                                                        textDecoration:
                                                            'underline',
                                                    }}
                                                    onClick={() => {
                                                        this.navigatToSchedule(
                                                            schedule
                                                        );
                                                    }}
                                                >
                                                    {schedule.name}
                                                </span>
                                                <span>
                                                    {' '}
                                                    -{' '}
                                                    {moment(
                                                        schedule.startDate
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm a'
                                                    )}
                                                    &nbsp;&nbsp;-&nbsp;&nbsp;
                                                    {moment(
                                                        schedule.endDate
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm a'
                                                    )}
                                                </span>
                                            </li>)}
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
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


ScheduleHeaderModal.displayName = 'ScheduleHeaderModal';


ScheduleHeaderModal.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    currentProjectSlug: PropTypes.string,
    data: PropTypes.object,
    addScheduleEvent: PropTypes.func,
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            addScheduleEvent,
        },
        dispatch
    );
};
export default connect(null, mapDispatchToProps)(ScheduleHeaderModal);
