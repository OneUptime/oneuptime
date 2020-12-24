import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import ScheduledEventBox from '../components/scheduledEvent/ScheduledEvent';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

class ScheduledEvent extends Component {
    render() {
        const {
            match,
            location: { pathname },
        } = this.props;
        const { projectId } = match.params;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={pathname}
                        name="Scheduled Maintenances"
                    />
                    <div id="scheduleEventsPage">
                        <ScheduledEventBox projectId={projectId} />
                    </div>
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
};

export default ScheduledEvent;
