import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';
import ScheduledEventBox from '../components/scheduledEvent/ScheduledEvent';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';

interface ScheduledEventProps {
    projectId?: string;
    location?: {
        pathname?: string
    };
    requesting?: boolean;
    fetchingMonitors?: boolean;
    currentProject: object;
    switchToProjectViewerNav?: boolean;
}

class ScheduledEvent extends Component<ComponentProps> {
    override render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
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
                    route={pathname}
                    name="Scheduled Maintenance Event"
                    pageTitle="Scheduled Event Detail"
                // containerType="Scheduled Maintenance Event"
                />
                <div id="scheduleEventsPage">

                    <ScheduledEventBox projectId={this.props.projectId} />
                </div>
                <ShouldRender

                    if={this.props.requesting || this.props.fetchingMonitors}
                >
                    <LoadingState />
                </ShouldRender>
            </Fade>
        );
    }
}


ScheduledEvent.displayName = 'ScheduledEvent';

const mapStateToProps = (state: RootState) => {
    return {
        projectId: state.subProject.activeSubProject,
        requesting:
            state.scheduledEvent.subProjectScheduledEventList.requesting,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        fetchingMonitors: state.monitor.monitorsList.requesting,
    };
};


ScheduledEvent.propTypes = {
    projectId: PropTypes.string,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    requesting: PropTypes.bool,
    fetchingMonitors: PropTypes.bool,
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};

export default connect(mapStateToProps)(ScheduledEvent);
