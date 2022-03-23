import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { Fade } from 'react-awesome-reveal';
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

import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import ScheduleEventDeleteBox from '../components/scheduledEvent/ScheduleEventDeleteBox';
import { socket } from '../components/basic/Socket';

interface ScheduledEventDetailProps {
    location?: {
        pathname?: string
    };
    scheduledEventId?: string;
    fetchScheduledEvent?: Function;
    projectId?: string;
    scheduledEventSlug?: string;
    scheduledEvent?: object;
    requesting?: boolean;
    fetchScheduledEventNotesInternal?: Function;
    internalNotesList?: object;
    updateScheduledEventNoteInvestigationSuccess?: Function;
    updateScheduledEventNoteInternalSuccess?: Function;
    deleteScheduledEventNoteSuccess?: Function;
    createScheduledEventNoteSuccess?: Function;
    monitorList?: unknown[];
    currentProject: object;
    switchToProjectViewerNav?: boolean;
    activeProjectId?: string;
    history?: object;
}

class ScheduledEventDetail extends Component<ScheduledEventDetailProps> {
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

        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
    };

    componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            String(prevProps.scheduledEventId) !==

            String(this.props.scheduledEventId)
        ) {
            const {

                fetchScheduledEventNotesInternal,

                updateScheduledEventNoteInvestigationSuccess,

                updateScheduledEventNoteInternalSuccess,

                deleteScheduledEventNoteSuccess,

                createScheduledEventNoteSuccess,

                scheduledEventId,
            } = this.props;
            // fetch scheduled event notes
            if (scheduledEventId) {
                // join the room
                socket.emit('schedule_switch', scheduledEventId);

                fetchScheduledEventNotesInternal(

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


        if (prevProps.activeProjectId !== this.props.activeProjectId) {
            // navigate back to main section

            this.props.history.push(

                `/dashboard/project/${this.props.currentProject.slug}/scheduledEvents`
            );
        }
    }
    ready = () => {
        resetIdCounter();

        if (this.props.scheduledEventSlug) {

            const { fetchScheduledEvent } = this.props;

            //fetch scheduledEvent with slug
            fetchScheduledEvent(

                this.props.projectId,

                this.props.scheduledEventSlug
            );
        }

        if (this.props.scheduledEventId) {
            fetchScheduledEventNotesInternal(

                this.props.projectId,

                this.props.scheduledEventId,
                this.limit,
                0,
                this.type
            );
        }
    };

    render() {
        const {

            location: { pathname },

            requesting,

            scheduledEvent,

            scheduledEventId,

            internalNotesList,

            monitorList,

            currentProject,

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

                                                                type="Internal"
                                                                notes={
                                                                    internalNotesList.scheduledEventNotes
                                                                }
                                                                count={
                                                                    internalNotesList.count
                                                                }
                                                                projectId={
                                                                    this.props

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


ScheduledEventDetail.displayName = 'ScheduledEventDetail';


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

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
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
