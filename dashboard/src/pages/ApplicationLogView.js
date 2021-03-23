import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import {
    fetchApplicationLogs,
    editApplicationLog,
} from '../actions/applicationLog';
import ApplicationLogDetail from '../components/application/ApplicationLogDetail';
import ApplicationLogViewDeleteBox from '../components/application/ApplicationLogViewDeleteBox';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import LibraryList from '../components/application/LibraryList';

class ApplicationLogView extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > LOG CONTAINERS > LOG CONTAINER DETAIL PAGE'
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

    handleCloseQuickStart = () => {
        const postObj = { showQuickStart: false };
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;
        const { applicationLog } = this.props;
        this.props.editApplicationLog(
            projectId,
            applicationLog[0].componentId._id,
            applicationLog[0]._id,
            postObj
        );
    };
    render() {
        const {
            location: { pathname },
            component,
            componentId,
            applicationLog,
        } = this.props;

        const componentName = component ? component.name : '';
        const applicationLogName =
            applicationLog.length > 0 ? applicationLog[0].name : null;
        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(
                            pathname,
                            null,
                            'application-log'
                        )}
                        name={componentName}
                    />
                    <BreadCrumbItem
                        route={getParentRoute(
                            pathname,
                            null,
                            'application-logs'
                        )}
                        name="Logs"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name={applicationLogName}
                        pageTitle="Logs"
                        containerType="Log Container"
                    />
                    <ShouldRender if={!this.props.applicationLog[0]}>
                        <LoadingState />
                    </ShouldRender>
                    <ShouldRender if={this.props.applicationLog[0]}>
                        {applicationLog[0] &&
                        applicationLog[0].showQuickStart ? (
                            <LibraryList
                                title="Log Container"
                                type="logs"
                                applicationLog={this.props.applicationLog[0]}
                                close={this.handleCloseQuickStart}
                            />
                        ) : null}
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
                </Fade>
            </Dashboard>
        );
    }
}

ApplicationLogView.displayName = 'ApplicationLogView';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { fetchApplicationLogs, editApplicationLog },
        dispatch
    );
};
const mapStateToProps = (state, props) => {
    const { componentId, applicationLogSlug } = props.match.params;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });
    const applicationLog = state.applicationLog.applicationLogsList.applicationLogs.filter(
        applicationLog => applicationLog.slug === applicationLogSlug
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
            showQuickStart: PropTypes.bool,
            componentId: PropTypes.object,
        })
    ),
    editApplicationLog: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLogView);
