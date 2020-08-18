import React from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import { withRouter } from 'react-router-dom';
import { capitalize } from '../../config';

function ScheduledEventDescription({ scheduledEvent, isOngoing, history }) {
    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                {isOngoing ? (
                                    <span>Ongoing Scheduled Event</span>
                                ) : (
                                    <span>Scheduled Event Description</span>
                                )}
                            </span>
                            <p>
                                <span>
                                    Here&#39;s a little more information about
                                    the scheduled event.
                                </span>
                            </p>
                        </div>
                        {isOngoing && (
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center">
                                <button
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    id="viewOngoingEvent"
                                    type="button"
                                    onClick={() =>
                                        history.push(
                                            `/dashboard/project/${scheduledEvent.projectId._id}/scheduledEvents/${scheduledEvent._id}`
                                        )
                                    }
                                >
                                    <span className="bs-Button">
                                        <span>View Event</span>
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label className="bs-Fieldset-label">
                                                Event Name
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '6px' }}
                                                >
                                                    {capitalize(
                                                        scheduledEvent.name
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label className="bs-Fieldset-label">
                                                Event Description
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '6px' }}
                                                >
                                                    {scheduledEvent.description}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label className="bs-Fieldset-label">
                                                Start Date
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '6px' }}
                                                >
                                                    {moment(
                                                        scheduledEvent.startDate
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm:ss a'
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label className="bs-Fieldset-label">
                                                End Date
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '6px' }}
                                                >
                                                    {moment(
                                                        scheduledEvent.endDate
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm:ss a'
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </fieldset>
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <span className="db-SettingsForm-footerMessage"></span>
                        <div></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

ScheduledEventDescription.displayName = 'ScheduledEventDescription';

ScheduledEventDescription.propTypes = {
    scheduledEvent: PropTypes.object,
    isOngoing: PropTypes.bool,
    history: PropTypes.object,
};

ScheduledEventDescription.defaultProps = {
    isOngoing: false,
};

export default withRouter(ScheduledEventDescription);
