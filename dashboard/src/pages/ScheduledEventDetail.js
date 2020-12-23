import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import {
    fetchscheduledEvent,
    fetchScheduledEventNotesInternal,
    fetchScheduledEventNotesInvestigation,
    updateScheduledEventNoteInvestigationSuccess,
    updateScheduledEventNoteInternalSuccess,
    deleteScheduledEventNoteSuccess,
    createScheduledEventNoteSuccess,
} from '../actions/scheduledEvent';
import getParentRoute from '../utils/getParentRoute';
import { LoadingState } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import ScheduledEventDescription from '../components/scheduledEvent/ScheduledEventDescription';
import ScheduledEventNote from '../components/scheduledEvent/ScheduledEventNote';
import { API_URL } from '../config';
import io from 'socket.io-client';
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import ScheduleEventDeleteBox from '../components/scheduledEvent/ScheduleEventDeleteBox';

// Important: Below `/api` is also needed because `io` constructor strips out the path from the url.
const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
});

class ScheduledEvent extends Component {
    constructor(props) {
        super(props);
        this.limit = 10;
    }
    componentWillMount() {
        resetIdCounter();
    }
    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
    };
    ready = () => {
        resetIdCounter();
        const {
            match,
            fetchscheduledEvent,
            fetchScheduledEventNotesInternal,
            fetchScheduledEventNotesInvestigation,
            updateScheduledEventNoteInvestigationSuccess,
            updateScheduledEventNoteInternalSuccess,
            deleteScheduledEventNoteSuccess,
            createScheduledEventNoteSuccess,
        } = this.props;
        const { projectId, scheduledEventId } = match.params;
        // fetch scheduled event
        fetchscheduledEvent(projectId, scheduledEventId);

        // fetch scheduled event notes
        fetchScheduledEventNotesInternal(
            projectId,
            scheduledEventId,
            this.limit,
            0
        );
        fetchScheduledEventNotesInvestigation(
            projectId,
            scheduledEventId,
            this.limit,
            0
        );

        socket.on(`addScheduledEventInternalNote-${scheduledEventId}`, event =>
            createScheduledEventNoteSuccess(event)
        );
        socket.on(
            `addScheduledEventInvestigationNote-${scheduledEventId}`,
            event => createScheduledEventNoteSuccess(event)
        );
        socket.on(
            `updateScheduledEventInternalNote-${scheduledEventId}`,
            event => updateScheduledEventNoteInternalSuccess(event)
        );
        socket.on(
            `updateScheduledEventInvestigationNote-${scheduledEventId}`,
            event => updateScheduledEventNoteInvestigationSuccess(event)
        );
        socket.on(
            `deleteScheduledEventInternalNote-${scheduledEventId}`,
            event => deleteScheduledEventNoteSuccess(event)
        );
        socket.on(
            `deleteScheduledEventInvestigationNote-${scheduledEventId}`,
            event => deleteScheduledEventNoteSuccess(event)
        );
    };

    render() {
        const {
            location: { pathname },
            requesting,
            scheduledEvent,
            investigationNotesList,
            internalNotesList,
            match,
            monitorList,
        } = this.props;
        const { projectId, scheduledEventId } = match.params;
        const eventName = scheduledEvent ? scheduledEvent.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Scheduled Maintenance"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name={eventName}
                        pageTitle="Scheduled Maintenance Detail"
                        containerType="Scheduled Maintenance"
                    />
                    <ShouldRender if={requesting}>
                        <LoadingState />
                    </ShouldRender>
                    <ShouldRender if={!requesting}>
                        <Tabs
                            selectedTabClassName={'custom-tab-selected'}
                            onSelect={tabIndex => this.tabSelected(tabIndex)}
                        >
                            <div className="Flex-flex Flex-direction--columnReverse">
                                <TabList
                                    id="customTabList"
                                    className={'custom-tab-list'}
                                >
                                    <Tab className={'custom-tab custom-tab-3'}>
                                        Basic
                                    </Tab>
                                    <Tab className={'custom-tab custom-tab-3'}>
                                        Notes
                                    </Tab>
                                    <Tab className={'custom-tab custom-tab-3'}>
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
                                    <ShouldRender
                                        if={investigationNotesList.requesting}
                                    >
                                        <LoadingState />
                                    </ShouldRender>
                                    <ShouldRender
                                        if={!investigationNotesList.requesting}
                                    >
                                        <div>
                                            <div>
                                                <div className="db-BackboneViewContainer">
                                                    <div className="react-settings-view react-view">
                                                        <div className="Box-root Margin-bottom--12">
                                                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                                                <ScheduledEventNote
                                                                    type="Investigation"
                                                                    notes={
                                                                        investigationNotesList.scheduledEventNotes
                                                                    }
                                                                    count={
                                                                        investigationNotesList.count
                                                                    }
                                                                    projectId={
                                                                        projectId
                                                                    }
                                                                    scheduledEventId={
                                                                        scheduledEventId
                                                                    }
                                                                    skip={
                                                                        investigationNotesList.skip
                                                                    }
                                                                    limit={
                                                                        investigationNotesList.limit
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={internalNotesList.requesting}
                                    >
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
                                                                        projectId
                                                                    }
                                                                    scheduledEventId={
                                                                        scheduledEventId
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
                                            projectId={projectId}
                                            scheduledEventId={scheduledEventId}
                                        />
                                    </ShouldRender>
                                </Fade>
                            </TabPanel>
                        </Tabs>
                    </ShouldRender>
                </Fade>
            </Dashboard>
        );
    }
}

ScheduledEvent.displayName = 'ScheduledEvent';

ScheduledEvent.propTypes = {
    match: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    fetchscheduledEvent: PropTypes.func,
    scheduledEvent: PropTypes.object,
    requesting: PropTypes.bool,
    fetchScheduledEventNotesInternal: PropTypes.func,
    fetchScheduledEventNotesInvestigation: PropTypes.func,
    internalNotesList: PropTypes.object,
    investigationNotesList: PropTypes.object,
    updateScheduledEventNoteInvestigationSuccess: PropTypes.func,
    updateScheduledEventNoteInternalSuccess: PropTypes.func,
    deleteScheduledEventNoteSuccess: PropTypes.func,
    createScheduledEventNoteSuccess: PropTypes.func,
    monitorList: PropTypes.array,
};

const mapStateToProps = state => {
    const monitorList = [];
    state.monitor.monitorsList.monitors.map(data => {
        data.monitors.map(monitor => {
            monitorList.push(monitor);
            return monitor;
        });
        return data;
    });

    return {
        scheduledEvent:
            state.scheduledEvent.newScheduledEvent.scheduledEvent &&
            state.scheduledEvent.newScheduledEvent.scheduledEvent,
        requesting: state.scheduledEvent.newScheduledEvent.requesting,
        internalNotesList: state.scheduledEvent.scheduledEventInternalList,
        investigationNotesList:
            state.scheduledEvent.scheduledEventInvestigationList,
        monitorList,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchscheduledEvent,
            fetchScheduledEventNotesInternal,
            fetchScheduledEventNotesInvestigation,
            updateScheduledEventNoteInvestigationSuccess,
            updateScheduledEventNoteInternalSuccess,
            deleteScheduledEventNoteSuccess,
            createScheduledEventNoteSuccess,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(ScheduledEvent);
