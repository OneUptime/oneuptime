import React from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';

import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import Markdown from 'markdown-to-jsx';
import { openModal } from 'common-ui/actions/modal';
import { capitalize } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import EditSchedule from '../modals/EditSchedule';
import { Spinner } from '../basic/Loader';
import { resolveScheduledEvent } from '../../actions/scheduledEvent';

function ScheduledEventDescription({
    scheduledEvent,
    isOngoing,
    history,
    openModal,
    monitorList,
    resolveScheduledEvent,
    resolving,
    slug,
    projectId
}: $TSFixMe) {
    const handleMonitorListing = (event: $TSFixMe, monitorState: $TSFixMe) => {
        const affectedMonitors: $TSFixMe = [];
        const eventMonitors: $TSFixMe = [];
        // populate the ids of the event monitors in an array
        event.monitors.map((monitor: $TSFixMe) => {
            eventMonitors.push(String(monitor.monitorId._id));
            return monitor;
        });

        monitorState.map((monitor: $TSFixMe) => {
            if (eventMonitors.includes(String(monitor._id))) {
                affectedMonitors.push(monitor);
            }
            return monitor;
        });

        // if they are equal then all the resources are affected
        if (affectedMonitors.length === monitorState.length) {
            return 'All Resources are affected';
        } else {
            return affectedMonitors.length <= 3
                ? affectedMonitors

                    .map(monitor => capitalize(monitor.name))
                    .join(', ')
                    .replace(/, ([^,]*)$/, ' and $1')
                : affectedMonitors.length > 3 &&
                `${capitalize(affectedMonitors[0].name)}, ${capitalize(
                    affectedMonitors[1].name
                )} and ${affectedMonitors.length - 2} other monitors.`;
        }
    };

    const handleResolve = () => {
        const { _id } = scheduledEvent;
        resolveScheduledEvent(projectId, _id);
    };

    const startDate = moment(scheduledEvent.startDate).format();
    const currentDate = moment().format();
    const isFutureScheduledEvent = startDate > currentDate;
    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                {isOngoing ? (
                                    <span>
                                        Ongoing Scheduled Maintenance Event
                                    </span>
                                ) : (
                                    <span>
                                        Scheduled Maintenance Event Description
                                    </span>
                                )}
                            </span>
                            <p>
                                <span>
                                    Here&#39;s a little more information about
                                    the scheduled maintenance.
                                </span>
                            </p>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center">
                            {isOngoing && (
                                <button
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    id="viewOngoingEvent"
                                    type="button"
                                    onClick={() =>
                                        history.push(
                                            `/dashboard/project/${slug}/scheduledEvents/${scheduledEvent.slug}`
                                        )
                                    }
                                >
                                    <span className="bs-Button">
                                        <span>View maintenance</span>
                                    </span>
                                </button>
                            )}
                            <button
                                id={`editScheduledEvent-${scheduledEvent.name}`}
                                title="delete"
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                style={{
                                    marginLeft: 20,
                                }}
                                type="button"
                                onClick={() =>
                                    openModal({
                                        id: scheduledEvent._id,
                                        content: EditSchedule,
                                        event: scheduledEvent,
                                        projectId: scheduledEvent.projectId._id,
                                        switch: 'true',
                                    })
                                }
                            >
                                <span>Edit</span>
                            </button>
                        </div>
                    </div>
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label
                                                className="bs-Fieldset-label"
                                                style={{
                                                    width: '15rem',
                                                    flex: 'none',
                                                    textAlign: 'left',
                                                }}
                                            >
                                                Maintenance Name
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '2px' }}
                                                >
                                                    {capitalize(
                                                        scheduledEvent.name
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <ShouldRender
                                            if={scheduledEvent.description}
                                        >
                                            <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        width: '15rem',
                                                        flex: 'none',
                                                        textAlign: 'left',
                                                    }}
                                                >
                                                    Maintenance Description
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '2px',
                                                            whiteSpace:
                                                                'pre-wrap',
                                                        }}
                                                    >
                                                        {scheduledEvent.description
                                                            ? scheduledEvent.description
                                                                .split('\n')
                                                                .map(
                                                                    (
                                                                        elem: $TSFixMe,
                                                                        index: $TSFixMe
                                                                    ) => (
                                                                        <Markdown
                                                                            key={`${elem}-${index}`}
                                                                            options={{
                                                                                forceBlock: true,
                                                                            }}
                                                                        >
                                                                            {
                                                                                elem
                                                                            }
                                                                        </Markdown>
                                                                    )
                                                                )
                                                            : null}
                                                    </span>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label
                                                className="bs-Fieldset-label"
                                                style={{
                                                    width: '15rem',
                                                    flex: 'none',
                                                    textAlign: 'left',
                                                }}
                                            >
                                                Affected Resources
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '2px' }}
                                                >
                                                    {handleMonitorListing(
                                                        scheduledEvent,
                                                        monitorList
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label
                                                className="bs-Fieldset-label"
                                                style={{
                                                    width: '15rem',
                                                    flex: 'none',
                                                    textAlign: 'left',
                                                }}
                                            >
                                                Start Date
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '2px' }}
                                                >
                                                    {moment(
                                                        scheduledEvent.startDate
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm a'
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label
                                                className="bs-Fieldset-label"
                                                style={{
                                                    width: '15rem',
                                                    flex: 'none',
                                                    textAlign: 'left',
                                                }}
                                            >
                                                End Date
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <span
                                                    className="value"
                                                    style={{ marginTop: '2px' }}
                                                >
                                                    {moment(
                                                        scheduledEvent.endDate
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm a'
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                            <label
                                                className="bs-Fieldset-label"
                                                style={{
                                                    width: '15rem',
                                                    flex: 'none',
                                                    textAlign: 'left',
                                                }}
                                            >
                                                Mark Maintenance as resolved
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                {!scheduledEvent.resolved ? (
                                                    isFutureScheduledEvent ? (
                                                        <span
                                                            className="value"
                                                            style={{
                                                                marginTop:
                                                                    '2px',
                                                                color:
                                                                    '#6b7c93',
                                                            }}
                                                        >
                                                            You cannot resolve
                                                            events which are not
                                                            yet started.
                                                        </span>
                                                    ) : (
                                                        <div className="Box-root Flex-flex Flex-alignItems--center">
                                                            <div>
                                                                <ShouldRender
                                                                    if={
                                                                        !resolving &&
                                                                        !scheduledEvent.cancelled
                                                                    }
                                                                >
                                                                    <label
                                                                        className="bs-Button bs-DeprecatedButton bs-FileUploadButton bs-Button--icon bs-Button--check"

                                                                        type="button"
                                                                        onClick={
                                                                            handleResolve
                                                                        }
                                                                    >
                                                                        <span>
                                                                            Resolve
                                                                            this
                                                                            event
                                                                        </span>
                                                                    </label>
                                                                </ShouldRender>
                                                                <ShouldRender
                                                                    if={
                                                                        scheduledEvent.cancelled
                                                                    }
                                                                >
                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper">
                                                                            Event
                                                                            has
                                                                            been
                                                                            cancelled
                                                                        </span>
                                                                    </div>
                                                                </ShouldRender>
                                                                <ShouldRender
                                                                    if={
                                                                        resolving
                                                                    }
                                                                >
                                                                    <Spinner
                                                                        style={{
                                                                            stroke:
                                                                                '#000000',
                                                                        }}
                                                                    />
                                                                </ShouldRender>
                                                            </div>
                                                        </div>
                                                    )
                                                ) : (
                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper">
                                                            <span>
                                                                Resolved by{' '}
                                                                {
                                                                    scheduledEvent
                                                                        .resolvedBy
                                                                        .name
                                                                }{' '}
                                                                {moment(
                                                                    scheduledEvent.resolvedAt
                                                                ).fromNow() +
                                                                    '.'}
                                                            </span>
                                                        </span>
                                                    </div>
                                                )}
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
    openModal: PropTypes.func,
    monitorList: PropTypes.array,
    resolveScheduledEvent: PropTypes.func,
    resolving: PropTypes.bool,
    slug: PropTypes.string,
    projectId: PropTypes.string,
};

ScheduledEventDescription.defaultProps = {
    isOngoing: false,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ openModal, resolveScheduledEvent }, dispatch);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        resolving: state.scheduledEvent.resolveScheduledEvent.requesting,
        slug: state.project.currentProject && state.project.currentProject.slug,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(withRouter(ScheduledEventDescription));
