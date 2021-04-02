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
    constructor(props) {
        super(props);
        this.limit = 10;
        this.state = {};
    }

    componentDidMount() {
        const {
            projectId,
            fetchMonitors,
            fetchSubProjectScheduledEvents,
        } = this.props;

        fetchSubProjectScheduledEvents(projectId);

        fetchMonitors(projectId);
    }
    componentDidUpdate(prevProps) {
        if (prevProps.projectId !== this.props.projectId) {
            this.props.fetchSubProjectScheduledEvents(this.props.projectId);

            this.props.fetchMonitors(this.props.projectId);
        }
    }
    prevClicked = (projectId, skip) => {
        const { fetchscheduledEvents } = this.props;
        fetchscheduledEvents(
            projectId,
            skip ? Number(skip) - this.limit : this.limit,
            this.limit
        );
        this.setState({
            [projectId]: this.state[projectId] - 1,
        });
        this.props.prevPage(projectId);
    };

    nextClicked = (projectId, skip) => {
        const { fetchscheduledEvents } = this.props;
        fetchscheduledEvents(
            projectId,
            skip ? Number(skip) + this.limit : this.limit,
            this.limit
        );
        this.props.nextPage(projectId);
        this.setState({
            [projectId]: this.state[projectId] ? this.state[projectId] + 1 : 2,
        });
    };

    render() {
        const {
            profileSettings,
            error,
            requesting,
            projectId,
            fetchingMonitors,
            currentProject,
            subProjects,
            subProjectScheduledEvents,
            modalList,
        } = this.props;

        const subProjectEvents =
            subProjects &&
            subProjects.length > 0 &&
            !fetchingMonitors &&
            subProjects.map(subProject => {
                const scheduledEvent = subProjectScheduledEvents.find(
                    event => String(subProject._id) === String(event.project)
                );
                let event = null;

                if (scheduledEvent) {
                    const {
                        project,
                        limit,
                        skip,
                        count,
                        scheduledEvents,
                    } = scheduledEvent;

                    event =
                        scheduledEvent && scheduledEvent.project ? (
                            <EventBox
                                key={project}
                                projectId={project}
                                prevClicked={this.prevClicked}
                                nextClicked={this.nextClicked}
                                scheduledEvents={scheduledEvents}
                                limit={limit}
                                count={count}
                                skip={skip}
                                profileSettings={profileSettings}
                                currentSubProject={subProject}
                                subProjects={subProjects}
                                error={error}
                                requesting={requesting}
                                fetchingMonitors={fetchingMonitors}
                                parentProjectId={subProject.parentProjectId._id}
                                modalList={modalList}
                                allScheduleEventLength={
                                    subProjectScheduledEvents.length
                                }
                                page={this.state[project]}
                            />
                        ) : null;
                }

                return event;
            });

        const projectEvent = subProjectScheduledEvents.find(
            event => String(event.project) === String(projectId)
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
                        page={this.state[projectId]}
                    />
                )}
                {subProjectEvents}
            </>
        );
    }
}

ScheduledEventBox.displayName = 'ScheduledEventBox';

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

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchscheduledEvents,
            fetchMonitors,
            fetchSubProjectScheduledEvents,
            nextPage,
            prevPage,
        },
        dispatch
    );

const mapStateToProps = state => {
    const monitors = [];
    state.monitor.monitorsList.monitors.map(data => {
        data.monitors.map(monitor => {
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
