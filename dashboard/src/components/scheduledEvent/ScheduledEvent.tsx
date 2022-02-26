import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import {
    fetchscheduledEvents,
    fetchSubProjectScheduledEvents,
    nextPage,
    prevPage,
} from '../../actions/scheduledEvent';
import { fetchMonitors } from '../../actions/monitor';
import EventBox from './EventBox';

class ScheduledEventBox extends Component {
    limit: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.limit = 10;
        this.state = {};
    }

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitors' does not exist on type 'R... Remove this comment to see the full error message
            fetchMonitors,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectScheduledEvents' does not... Remove this comment to see the full error message
            fetchSubProjectScheduledEvents,
        } = this.props;

        if (projectId) {
            fetchSubProjectScheduledEvents(projectId);

            fetchMonitors(projectId);
        }
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        if (prevProps.projectId !== this.props.projectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectScheduledEvents' does not... Remove this comment to see the full error message
            this.props.fetchSubProjectScheduledEvents(this.props.projectId);

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitors' does not exist on type 'R... Remove this comment to see the full error message
            this.props.fetchMonitors(this.props.projectId);
        }
    }
    prevClicked = (projectId: $TSFixMe, skip: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchscheduledEvents' does not exist on ... Remove this comment to see the full error message
        const { fetchscheduledEvents } = this.props;
        fetchscheduledEvents(
            projectId,
            skip ? Number(skip) - this.limit : this.limit,
            this.limit
        );
        this.setState({
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            [projectId]: this.state[projectId] - 1,
        });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'prevPage' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.prevPage(projectId);
    };

    nextClicked = (projectId: $TSFixMe, skip: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchscheduledEvents' does not exist on ... Remove this comment to see the full error message
        const { fetchscheduledEvents } = this.props;
        fetchscheduledEvents(
            projectId,
            skip ? Number(skip) + this.limit : this.limit,
            this.limit
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextPage' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.nextPage(projectId);
        this.setState({
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            [projectId]: this.state[projectId] ? this.state[projectId] + 1 : 2,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profileSettings' does not exist on type ... Remove this comment to see the full error message
            profileSettings,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
            error,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchingMonitors' does not exist on type... Remove this comment to see the full error message
            fetchingMonitors,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            subProjects,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectScheduledEvents' does not exis... Remove this comment to see the full error message
            subProjectScheduledEvents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalList' does not exist on type 'Reado... Remove this comment to see the full error message
            modalList,
        } = this.props;

        const projectEvent = subProjectScheduledEvents.find(
            (event: $TSFixMe) => String(event.project) === String(projectId)
        );

        return (
            <>
                {projectEvent && !fetchingMonitors && (
                    <EventBox
                        projectId={projectId}
                        prevClicked={this.prevClicked}
                        nextClicked={this.nextClicked}
                        scheduledEvents={projectEvent.scheduledEvents}
                        limit={projectEvent.limit}
                        count={projectEvent.count}
                        skip={projectEvent.skip}
                        profileSettings={profileSettings}
                        currentProject={currentProject}
                        subProjects={subProjects}
                        error={error}
                        requesting={requesting}
                        fetchingMonitors={fetchingMonitors}
                        modalList={modalList}
                        allScheduleEventLength={
                            subProjectScheduledEvents.length
                        }
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        page={this.state[projectId]}
                    />
                )}
                {/* {subProjectEvents} */}
            </>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ScheduledEventBox.displayName = 'ScheduledEventBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ScheduledEventBox.propTypes = {
    fetchscheduledEvents: PropTypes.func.isRequired,
    profileSettings: PropTypes.object,
    error: PropTypes.object,
    requesting: PropTypes.bool,
    projectId: PropTypes.string,
    fetchMonitors: PropTypes.func,
    fetchingMonitors: PropTypes.bool,
    currentProject: PropTypes.object,
    fetchSubProjectScheduledEvents: PropTypes.func,
    subProjects: PropTypes.array,
    subProjectScheduledEvents: PropTypes.array,
    modalList: PropTypes.array,
    nextPage: PropTypes.func,
    prevPage: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchscheduledEvents,
        fetchMonitors,
        fetchSubProjectScheduledEvents,
        nextPage,
        prevPage,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const monitors: $TSFixMe = [];
    state.monitor.monitorsList.monitors.map((data: $TSFixMe) => {
        data.monitors.map((monitor: $TSFixMe) => {
            monitors.push(monitor);
            return monitor;
        });
        return data;
    });

    const subProjects = state.subProject.subProjects.subProjects;
    const subProjectScheduledEvents =
        state.scheduledEvent.subProjectScheduledEventList.scheduledEvents;

    return {
        currentProject: state.project.currentProject,
        scheduledEvents:
            state.scheduledEvent.scheduledEventList.scheduledEvents,
        requesting: state.scheduledEvent.scheduledEventList.requesting,
        count: state.scheduledEvent.scheduledEventList.count,
        limit: state.scheduledEvent.scheduledEventList.limit,
        skip: state.scheduledEvent.scheduledEventList.skip,
        error: state.scheduledEvent.scheduledEventList.error,
        profileSettings: state.profileSettings.profileSetting.data,
        fetchingMonitors: state.monitor.monitorsList.requesting,
        monitors,
        subProjects,
        subProjectScheduledEvents,
        modalList: state.modal.modals,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(ScheduledEventBox);
