import React from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { openModal, closeModal } from '../actions/modal';
import MonitorSla from '../components/monitorSla/MonitorSla';

class MonitorSettings extends React.Component {
    render() {
        const {
            location: { pathname },
            match,
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <div id="monitorSettingsPage">
                        <BreadCrumbItem route={pathname} name="Monitors" />

                        <MonitorSla projectId={match.params.projectId} />
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

MonitorSettings.displayName = 'MonitorSettings';
MonitorSettings.propTypes = {
    location: PropTypes.object.isRequired,
    match: PropTypes.object,
};
const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            closeModal,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(MonitorSettings);
