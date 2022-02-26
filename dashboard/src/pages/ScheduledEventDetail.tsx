import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import {
    fetchscheduledEvent,
    fetchScheduledEventNotesInternal,
    updateScheduledEventNoteInvestigationSuccess,
    updateScheduledEventNoteInternalSuccess,
    deleteScheduledEventNoteSuccess,
    createScheduledEventNoteSuccess,
    fetchScheduledEvent,
} from '../actions/scheduledEvent';
import getParentRoute from '../utils/getParentRoute';
import { LoadingState } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import ScheduledEventDescription from '../components/scheduledEvent/ScheduledEventDescription';
import ScheduledEventNote from '../components/scheduledEvent/ScheduledEventNote';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import ScheduleEventDeleteBox from '../components/scheduledEvent/ScheduleEventDeleteBox';
import { socket } from '../components/basic/Socket';

class ScheduledEventDetail extends Component {
    limit: $TSFixMe;
    type: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.limit = 10;
        this.type = 'internal';
    }
    componentWillMount() {
        resetIdCounter();

        // remove listeners
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventId' does not exist on type... Remove this comment to see the full error message
        const scheduledEventId = this.props.scheduledEventId;
        socket.removeListener(
            `addScheduledEventInternalNote-${scheduledEventId}`
        );
        socket.removeListener(
            `addScheduledEventInvestigationNote-${scheduledEventId}`
        );
        socket.removeListener(
            `updateScheduledEventInternalNote-${scheduledEventId}`
        );
        socket.removeListener(
            `updateScheduledEventInvestigationNote-${scheduledEventId}`
        );
        socket.removeListener(
            `deleteScheduledEventInternalNote-${scheduledEventId}`
        );
        socket.removeListener(
            `deleteScheduledEventInvestigationNote-${scheduledEventId}`
        );
    }
    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
    };

    componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            String(prevProps.scheduledEventId) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventId' does not exist on type... Remove this comment to see the full error message
            String(this.props.scheduledEventId)
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchScheduledEventNotesInternal' does n... Remove this comment to see the full error message
                fetchScheduledEventNotesInternal,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateScheduledEventNoteInvestigationSuc... Remove this comment to see the full error message
                updateScheduledEventNoteInvestigationSuccess,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateScheduledEventNoteInternalSuccess'... Remove this comment to see the full error message
                updateScheduledEventNoteInternalSuccess,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteScheduledEventNoteSuccess' does no... Remove this comment to see the full error message
                deleteScheduledEventNoteSuccess,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEventNoteSuccess' does no... Remove this comment to see the full error message
                createScheduledEventNoteSuccess,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventId' does not exist on type... Remove this comment to see the full error message
                scheduledEventId,
            } = this.props;
            // fetch scheduled event notes
            if (scheduledEventId) {
                // join the room
                socket.emit('schedule_switch', scheduledEventId);

                fetchScheduledEventNotesInternal(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                    this.props.projectId,
                    scheduledEventId,
                    this.limit,
                    0,
                    this.type
                );

                socket.on(
                    `addScheduledEventInternalNote-${scheduledEventId}`,
                    (event: $TSFixMe) => createScheduledEventNoteSuccess(event)
                );
                socket.on(
                    `addScheduledEventInvestigationNote-${scheduledEventId}`,
                    (event: $TSFixMe) => createScheduledEventNoteSuccess(event)
                );
                socket.on(
                    `updateScheduledEventInternalNote-${scheduledEventId}`,
                    (event: $TSFixMe) => updateScheduledEventNoteInternalSuccess(event)
                );
                socket.on(
                    `updateScheduledEventInvestigationNote-${scheduledEventId}`,
                    (event: $TSFixMe) => updateScheduledEventNoteInvestigationSuccess(event)
                );
                socket.on(
                    `deleteScheduledEventInternalNote-${scheduledEventId}`,
                    (event: $TSFixMe) => deleteScheduledEventNoteSuccess(event)
                );
                socket.on(
                    `deleteScheduledEventInvestigationNote-${scheduledEventId}`,
                    (event: $TSFixMe) => deleteScheduledEventNoteSuccess(event)
                );
            }
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (prevProps.activeProjectId !== this.props.activeProjectId) {
            // navigate back to main section
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.history.push(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                `/dashboard/project/${this.props.currentProject.slug}/scheduledEvents`
            );
        }
    }
    ready = () => {
        resetIdCounter();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventSlug' does not exist on ty... Remove this comment to see the full error message
        if (this.props.scheduledEventSlug) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchScheduledEvent' does not exist on t... Remove this comment to see the full error message
            const { fetchScheduledEvent } = this.props;

            //fetch scheduledEvent with slug
            fetchScheduledEvent(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventSlug' does not exist on ty... Remove this comment to see the full error message
                this.props.scheduledEventSlug
            );
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventId' does not exist on type... Remove this comment to see the full error message
        if (this.props.scheduledEventId) {
            fetchScheduledEventNotesInternal(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventId' does not exist on type... Remove this comment to see the full error message
                this.props.scheduledEventId,
                this.limit,
                0,
                this.type
            );
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvent' does not exist on type '... Remove this comment to see the full error message
            scheduledEvent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventId' does not exist on type... Remove this comment to see the full error message
            scheduledEventId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'internalNotesList' does not exist on typ... Remove this comment to see the full error message
            internalNotesList,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorList' does not exist on type 'Rea... Remove this comment to see the full error message
            monitorList,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;
        const eventName = scheduledEvent ? scheduledEvent.name : '';
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'scheduledEvents')}
                    name="Scheduled Maintenance Event"
                />
                <BreadCrumbItem
                    route={pathname}
                    name={eventName}
                    pageTitle="Scheduled Event Detail"
                    containerType="Scheduled Maintenance Event"
                />
                <ShouldRender if={requesting}>
                    <LoadingState />
                </ShouldRender>
                <ShouldRender if={!requesting}>
                    <Tabs
                        selectedTabClassName={'custom-tab-selected'}
                        onSelect={(tabIndex: $TSFixMe) => this.tabSelected(tabIndex)}
                    >
                        <div className="Flex-flex Flex-direction--columnReverse">
                            <TabList
                                id="customTabList"
                                className={'custom-tab-list'}
                            >
                                <Tab
                                    className={
                                        'custom-tab custom-tab-3 basic-tab'
                                    }
                                >
                                    Basic
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-3 timeline-tab'
                                    }
                                >
                                    Timeline
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-3 advanced-options-tab'
                                    }
                                >
                                    Advanced Options
                                </Tab>
                                <div
                                    id="tab-slider"
                                    className="custom-tab-3"
                                ></div>
                            </TabList>
                        </div>
                        <TabPanel>
                            <Fade>
                                <ShouldRender if={scheduledEvent}>
                                    <div>
                                        <div>
                                            <div className="db-BackboneViewContainer">
                                                <div className="react-settings-view react-view">
                                                    <span>
                                                        <div>
                                                            <ScheduledEventDescription
                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ scheduledEvent: any; monitorList: any; }' ... Remove this comment to see the full error message
                                                                scheduledEvent={
                                                                    scheduledEvent
                                                                }
                                                                monitorList={
                                                                    monitorList
                                                                }
                                                            />
                                                        </div>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <ShouldRender if={internalNotesList.requesting}>
                                    <LoadingState />
                                </ShouldRender>
                                <ShouldRender
                                    if={!internalNotesList.requesting}
                                >
                                    <div>
                                        <div>
                                            <div className="db-BackboneViewContainer">
                                                <div className="react-settings-view react-view">
                                                    <div className="Box-root Margin-bottom--12">
                                                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                                                            <ScheduledEventNote
                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: string; notes: any; count: any; proj... Remove this comment to see the full error message
                                                                type="Internal"
                                                                notes={
                                                                    internalNotesList.scheduledEventNotes
                                                                }
                                                                count={
                                                                    internalNotesList.count
                                                                }
                                                                projectId={
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                        .projectId
                                                                }
                                                                scheduledEventId={
                                                                    scheduledEventId
                                                                }
                                                                scheduledEvent={
                                                                    scheduledEvent
                                                                }
                                                                skip={
                                                                    internalNotesList.skip
                                                                }
                                                                limit={
                                                                    internalNotesList.limit
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <ShouldRender if={scheduledEvent}>
                                    <ScheduleEventDeleteBox
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; scheduledEventId: any; sch... Remove this comment to see the full error message
                                        projectId={this.props.projectId}
                                        scheduledEventId={scheduledEventId}
                                        scheduledEvent={scheduledEvent}
                                    />
                                </ShouldRender>
                            </Fade>
                        </TabPanel>
                    </Tabs>
                </ShouldRender>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ScheduledEventDetail.displayName = 'ScheduledEventDetail';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ScheduledEventDetail.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    scheduledEventId: PropTypes.string,
    fetchScheduledEvent: PropTypes.func,
    projectId: PropTypes.string,
    scheduledEventSlug: PropTypes.string,
    scheduledEvent: PropTypes.object,
    requesting: PropTypes.bool,
    fetchScheduledEventNotesInternal: PropTypes.func,
    internalNotesList: PropTypes.object,
    updateScheduledEventNoteInvestigationSuccess: PropTypes.func,
    updateScheduledEventNoteInternalSuccess: PropTypes.func,
    deleteScheduledEventNoteSuccess: PropTypes.func,
    createScheduledEventNoteSuccess: PropTypes.func,
    monitorList: PropTypes.array,
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
    activeProjectId: PropTypes.string,
    history: PropTypes.object,
};

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const { scheduledEventSlug } = props.match.params;
    const monitorList: $TSFixMe = [];
    state.monitor.monitorsList.monitors.map((data: $TSFixMe) => {
        data.monitors.map((monitor: $TSFixMe) => {
            monitorList.push(monitor);
            return monitor;
        });
        return data;
    });

    return {
        scheduledEvent:
            state.scheduledEvent.currentScheduledEvent &&
            state.scheduledEvent.currentScheduledEvent.scheduledEvent,
        requesting: state.scheduledEvent.newScheduledEvent.requesting,
        internalNotesList: state.scheduledEvent.scheduledEventInternalList,
        investigationNotesList:
            state.scheduledEvent.scheduledEventInvestigationList,
        monitorList,
        scheduledEventSlug,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        scheduledEventId:
            state.scheduledEvent.currentScheduledEvent.scheduledEvent &&
            state.scheduledEvent.currentScheduledEvent.scheduledEvent._id,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject.activeSubProject,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchscheduledEvent,
        fetchScheduledEventNotesInternal,
        updateScheduledEventNoteInvestigationSuccess,
        updateScheduledEventNoteInternalSuccess,
        deleteScheduledEventNoteSuccess,
        createScheduledEventNoteSuccess,
        fetchScheduledEvent,
    },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ScheduledEventDetail);
