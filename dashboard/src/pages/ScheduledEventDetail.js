import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { fetchscheduledEvent } from '../actions/scheduledEvent';
import getParentRoute from '../utils/getParentRoute';

class ScheduledEvent extends Component {
    ready = () => {
        const { match, fetchscheduledEvent } = this.props;
        const { projectId, scheduledEventId } = match.params;

        // fetch scheduled event
        fetchscheduledEvent(projectId, scheduledEventId);
    };

    render() {
        const {
            location: { pathname },
            requesting,
            scheduledEvent,
        } = this.props;
        const eventName = scheduledEvent ? scheduledEvent.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Scheduled Events"
                    />
                    <BreadCrumbItem route={pathname} name={eventName} />
                    <div>Scheduled Event Details page</div>
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
};

const mapStateToProps = state => {
    return {
        scheduledEvent:
            state.scheduledEvent.newScheduledEvent.scheduledEvent &&
            state.scheduledEvent.newScheduledEvent.scheduledEvent,
        requesting: state.scheduledEvent.newScheduledEvent.requesting,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ fetchscheduledEvent }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(ScheduledEvent);
