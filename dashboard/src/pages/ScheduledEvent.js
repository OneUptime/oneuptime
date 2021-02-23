import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import ScheduledEventBox from '../components/scheduledEvent/ScheduledEvent';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

class ScheduledEvent extends Component {
    render() {
        const {
            location: { pathname },
        } = this.props;

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
                        <ScheduledEventBox projectId={this.props.projectId} />
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

ScheduledEvent.displayName = 'ScheduledEvent';

const mapStateToProps = state => {
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
    };
};

ScheduledEvent.propTypes = {
    projectId: PropTypes.string,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default connect(mapStateToProps)(ScheduledEvent);
