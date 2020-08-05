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
} from '../actions/scheduledEvent';
import getParentRoute from '../utils/getParentRoute';
import { LoadingState } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import ScheduledEventDescription from '../components/scheduledEvent/ScheduledEventDescription';
import ScheduledEventNote from '../components/scheduledEvent/ScheduledEventNote';

class ScheduledEvent extends Component {
    constructor(props) {
        super(props);
        this.limit = 10;
    }

    ready = () => {
        const {
            match,
            fetchscheduledEvent,
            fetchScheduledEventNotesInternal,
            fetchScheduledEventNotesInvestigation,
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
    };

    render() {
        const {
            location: { pathname },
            requesting,
            scheduledEvent,
            investigationNotesList,
            internalNotesList,
            match,
        } = this.props;
        const { projectId, scheduledEventId } = match.params;
        const eventName = scheduledEvent ? scheduledEvent.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Scheduled Events"
                    />
                    <BreadCrumbItem route={pathname} name={eventName} />
                    <ShouldRender if={requesting}>
                        <LoadingState />
                    </ShouldRender>
                    <ShouldRender if={!requesting && scheduledEvent}>
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
                                                />
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ShouldRender>
                    <ShouldRender if={investigationNotesList.requesting}>
                        <LoadingState />
                    </ShouldRender>
                    <ShouldRender if={!investigationNotesList.requesting}>
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
                                                    projectId={projectId}
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
                    <ShouldRender if={internalNotesList.requesting}>
                        <LoadingState />
                    </ShouldRender>
                    <ShouldRender if={!internalNotesList.requesting}>
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
                                                    projectId={projectId}
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
};

const mapStateToProps = state => {
    return {
        scheduledEvent:
            state.scheduledEvent.newScheduledEvent.scheduledEvent &&
            state.scheduledEvent.newScheduledEvent.scheduledEvent,
        requesting: state.scheduledEvent.newScheduledEvent.requesting,
        internalNotesList: state.scheduledEvent.scheduledEventInternalList,
        investigationNotesList:
            state.scheduledEvent.scheduledEventInvestigationList,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchscheduledEvent,
            fetchScheduledEventNotesInternal,
            fetchScheduledEventNotesInvestigation,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(ScheduledEvent);
