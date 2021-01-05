import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import ScheduledEventBox from '../components/scheduledEvent/ScheduledEvent';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { connect } from 'react-redux';
import { User } from '../config';

class ScheduledEvent extends Component {
    render() {
        const {
            match,
            location: { pathname },
        } = this.props;
        const projectId = User.getCurrentProjectId();
        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={pathname}
                        name="Scheduled Maintenance Event"
                        pageTitle="Scheduled Event Detail"
                        containerType="Scheduled Maintenance Event"
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
    currentProject: PropTypes.object,
};

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

export default connect(mapStateToProps)(ScheduledEvent);
