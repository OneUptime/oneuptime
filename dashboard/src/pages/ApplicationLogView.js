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
import LogList from '../components/application/LogList';
import ApplicationLogDetail from '../components/application/ApplicationLogDetail';

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

        this.props.fetchApplicationLogs(componentId);
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
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Application Logs"
                />
                <BreadCrumbItem route={pathname} name={applicationLogName} />
                <div
                    className="Box-root Card-shadow--medium"
                    style={{ marginTop: '10px', marginBottom: '10px' }}
                    tabIndex="0"
                >
                    <ApplicationLogDetail
                        componentId={componentId}
                        applicationLog={applicationLog[0]}
                        index={applicationLog._id}
                        isDetails={true}
                    />
                </div>
            </Dashboard>
        );
    }
}

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
    loadPage: PropTypes.func,
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    applicationLog: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLogView);
