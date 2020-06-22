import React, { Component } from 'react';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { fetchApplicationLogs } from '../actions/applicationLog';
import ApplicationLogDetail from '../components/application/ApplicationLogDetail';
import ApplicationLogViewDeleteBox from '../components/application/ApplicationLogViewDeleteBox';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';

class ApplicationLogView extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > APPLICATION LOGS > APPLICATION LOG DETAIL PAGE'
            );
        }
    }
    ready = () => {
        const componentId = this.props.match.params.componentId
            ? this.props.match.params.componentId
            : null;
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;

        this.props.fetchApplicationLogs(projectId, componentId);
    };
    render() {
        const {
            location: { pathname },
            component,
            componentId,
            applicationLog,
        } = this.props;

        const componentName = component.length > 0 ? component[0].name : null;
        const applicationLogName =
            applicationLog.length > 0 ? applicationLog[0].name : null;
        return (
            <Dashboard ready={this.ready}>
                <BreadCrumbItem route="#" name={componentName} />
                <BreadCrumbItem route={getParentRoute(pathname)} name="Logs" />
                <BreadCrumbItem route={pathname} name={applicationLogName} />
                <ShouldRender if={!this.props.applicationLog[0]}>
                    <LoadingState />
                </ShouldRender>
                <ShouldRender if={this.props.applicationLog[0]}>
                    <div>
                        <ApplicationLogDetail
                            componentId={componentId}
                            index={this.props.applicationLog[0]?._id}
                            isDetails={true}
                        />
                    </div>

                    <div className="Box-root Margin-bottom--12">
                        <ApplicationLogViewDeleteBox
                            componentId={this.props.componentId}
                            applicationLog={this.props.applicationLog[0]}
                        />
                    </div>
                </ShouldRender>
            </Dashboard>
        );
    }
}

ApplicationLogView.displayName = 'ApplicationLogView';

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ fetchApplicationLogs }, dispatch);
};
const mapStateToProps = (state, props) => {
    const { componentId, applicationLogId } = props.match.params;
    const component = state.component.componentList.components.map(item => {
        return item.components.find(component => component._id === componentId);
    });
    const applicationLog = state.applicationLog.applicationLogsList.applicationLogs.filter(
        applicationLog => applicationLog._id === applicationLogId
    );
    return {
        componentId,
        applicationLog,
        component,
        currentProject: state.project.currentProject,
    };
};

ApplicationLogView.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    componentId: PropTypes.string,
    match: PropTypes.object,
    fetchApplicationLogs: PropTypes.func,
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    applicationLog: PropTypes.arrayOf(
        PropTypes.shape({
            _id: PropTypes.string,
            name: PropTypes.string,
        })
    ),
};

export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLogView);
