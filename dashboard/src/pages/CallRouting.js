import React, { Component } from 'react';
import { PropTypes } from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import RoutingNumberBox from '../components/callrouting/RoutingNumberBox';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import {
    getCallRoutingNumbers,
    getTeamAndSchedules,
} from '../actions/callRouting';

class CallRouting extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        const { match, currentProject } = this.props;
        const projectId =
            match.params.projectId && match.params.projectId.length
                ? match.params.projectId
                : currentProject && currentProject._id
                ? currentProject._id
                : null;
        this.props.getCallRoutingNumbers(projectId);
        this.props.getTeamAndSchedules(projectId);
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS > CALLROUTING');
        }
    }

    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="Call Routing" />
                    <RoutingNumberBox />
                </Fade>
            </Dashboard>
        );
    }
}

CallRouting.propTypes = {
    currentProject: PropTypes.shape({
        _id: PropTypes.any,
    }),
    getCallRoutingNumbers: PropTypes.func,
    getTeamAndSchedules: PropTypes.func,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    match: PropTypes.shape({
        params: PropTypes.shape({
            projectId: PropTypes.shape({
                length: PropTypes.any,
            }),
        }),
    }),
};

CallRouting.displayName = 'CallRouting';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { getCallRoutingNumbers, getTeamAndSchedules },
        dispatch
    );

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(CallRouting);
