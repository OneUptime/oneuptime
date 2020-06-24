import React, { Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    fetchMonitorsIncidents,
    fetchMonitorsSubscribers,
    getMonitorLogs,
    fetchLighthouseLogs,
} from '../actions/monitor';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import MonitorViewHeader from '../components/monitor/MonitorViewHeader';
import MonitorViewIncidentBox from '../components/monitor/MonitorViewIncidentBox';
import MonitorViewLighthouseLogsBox from '../components/monitor/MonitorViewLighthouseLogsBox';
import MonitorViewSubscriberBox from '../components/monitor/MonitorViewSubscriberBox';
import MonitorAddScheduleBox from '../components/monitor/MonitorAddScheduleBox';
import MonitorViewDeleteBox from '../components/monitor/MonitorViewDeleteBox';
import NewMonitor from '../components/monitor/NewMonitor';
import ShouldRender from '../components/basic/ShouldRender';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import { mapCriteria } from '../config';
import WebHookBox from '../components/webHooks/WebHookBox';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import MonitorViewLogsBox from '../components/monitor/MonitorViewLogsBox';
import moment from 'moment';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { getProbes } from '../actions/probe';

class MonitorView extends React.Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > MONITOR > MONITOR DETAIL PAGE'
            );
        }
    }

    componentDidUpdate(prevProps) {
        if (!prevProps.monitor && this.props.monitor) {
            const subProjectId =
                this.props.monitor.projectId._id ||
                this.props.monitor.projectId;
            this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
            if (this.props.monitor.type === 'url') {
                this.props.fetchLighthouseLogs(
                    subProjectId,
                    this.props.monitor._id,
                    0,
                    5
                ); //0 -> skip, 10-> limit.
            }
            this.props.fetchMonitorsIncidents(
                subProjectId,
                this.props.monitor._id,
                0,
                5
            ); //0 -> skip, 5-> limit.
            this.props.fetchMonitorsSubscribers(
                subProjectId,
                this.props.monitor._id,
                0,
                5
            ); //0 -> skip, 5-> limit.
            this.props.getMonitorLogs(
                subProjectId,
                this.props.monitor._id,
                0,
                10,
                moment()
                    .subtract(1, 'd')
                    .utc(),
                moment().utc()
            ); //0 -> skip, 5-> limit.
        }
    }

    ready = () => {
        const subProjectId =
            this.props.monitor.projectId._id || this.props.monitor.projectId;
        this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
        if (this.props.monitor.type === 'url') {
            this.props.fetchLighthouseLogs(
                subProjectId,
                this.props.monitor._id,
                0,
                5
            ); //0 -> skip, 10-> limit.
        }
        this.props.fetchMonitorsIncidents(
            subProjectId,
            this.props.monitor._id,
            0,
            5
        ); //0 -> skip, 5-> limit.
        this.props.fetchMonitorsSubscribers(
            subProjectId,
            this.props.monitor._id,
            0,
            5
        ); //0 -> skip, 5-> limit.
        this.props.getMonitorLogs(
            subProjectId,
            this.props.monitor._id,
            0,
            10,
            moment()
                .subtract(1, 'd')
                .utc(),
            moment().utc()
        ); //0 -> skip, 5-> limit.
    };

    render() {
        const {
            initialValues,
            location: { pathname },
            component,
            monitor,
        } = this.props;
        const subProjectId = this.props.monitor
            ? this.props.monitor.projectId._id || this.props.monitor.projectId
            : null;
        const componentName =
            component.length > 0 ? (component[0] ? component[0].name : '') : '';
        const monitorName = monitor ? monitor.name : '';

        const componentMonitorsRoute = getParentRoute(pathname);

        return (
            <Dashboard ready={this.ready}>
                <BreadCrumbItem
                    route={componentMonitorsRoute}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={`${componentMonitorsRoute}#`}
                    name="Monitors"
                />
                <BreadCrumbItem route={pathname} name={monitorName} />
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span data-reactroot="">
                                        <div>
                                            <div>
                                                {this.props.monitor &&
                                                this.props.monitor._id ? (
                                                    <Fragment>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <ShouldRender
                                                                if={
                                                                    !this.props
                                                                        .monitor
                                                                        .editMode
                                                                }
                                                            >
                                                                <MonitorViewHeader
                                                                    componentId={
                                                                        this
                                                                            .props
                                                                            .componentId
                                                                    }
                                                                    monitor={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                    }
                                                                    index={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                            ._id
                                                                    }
                                                                />
                                                            </ShouldRender>
                                                            <ShouldRender
                                                                if={
                                                                    this.props
                                                                        .monitor
                                                                        .editMode
                                                                }
                                                            >
                                                                <NewMonitor
                                                                    {...this
                                                                        .props}
                                                                    editMonitorProp={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                    }
                                                                    index={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                            ._id
                                                                    }
                                                                    edit={true}
                                                                    key={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                            ._id
                                                                    }
                                                                    formKey={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                            ._id
                                                                    }
                                                                    initialValues={
                                                                        initialValues
                                                                    }
                                                                />
                                                            </ShouldRender>
                                                        </div>
                                                        <ShouldRender
                                                            if={
                                                                this.props
                                                                    .monitor &&
                                                                this.props
                                                                    .monitor
                                                                    .type &&
                                                                this.props
                                                                    .monitor
                                                                    .type ===
                                                                    'url'
                                                            }
                                                        >
                                                            <div className="Box-root Margin-bottom--12">
                                                                <MonitorViewLighthouseLogsBox
                                                                    componentId={
                                                                        this
                                                                            .props
                                                                            .componentId
                                                                    }
                                                                    monitor={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                    }
                                                                />
                                                            </div>
                                                        </ShouldRender>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <MonitorViewIncidentBox
                                                                componentId={
                                                                    this.props
                                                                        .componentId
                                                                }
                                                                monitor={
                                                                    this.props
                                                                        .monitor
                                                                }
                                                            />
                                                        </div>
                                                        <ShouldRender
                                                            if={
                                                                this.props
                                                                    .monitor &&
                                                                this.props
                                                                    .monitor
                                                                    .type &&
                                                                (this.props
                                                                    .monitor
                                                                    .type ===
                                                                    'url' ||
                                                                    this.props
                                                                        .monitor
                                                                        .type ===
                                                                        'api')
                                                            }
                                                        >
                                                            <div className="Box-root Margin-bottom--12">
                                                                <MonitorViewLogsBox
                                                                    monitorId={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                            ._id
                                                                    }
                                                                    monitorName={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                            .name
                                                                    }
                                                                />
                                                            </div>
                                                        </ShouldRender>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <MonitorAddScheduleBox
                                                                monitor={
                                                                    this.props
                                                                        .monitor
                                                                }
                                                            />
                                                        </div>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <MonitorViewSubscriberBox
                                                                monitorId={
                                                                    this.props
                                                                        .monitor
                                                                        ._id
                                                                }
                                                            />
                                                        </div>
                                                        <div className="Box-root Margin-bottom--12">
                                                            <WebHookBox
                                                                monitorId={
                                                                    this.props
                                                                        .monitor
                                                                        ._id
                                                                }
                                                            />
                                                        </div>
                                                        <RenderIfSubProjectAdmin
                                                            subProjectId={
                                                                subProjectId
                                                            }
                                                        >
                                                            <div className="Box-root Margin-bottom--12">
                                                                <MonitorViewDeleteBox
                                                                    componentId={
                                                                        this
                                                                            .props
                                                                            .componentId
                                                                    }
                                                                    monitor={
                                                                        this
                                                                            .props
                                                                            .monitor
                                                                    }
                                                                />
                                                            </div>
                                                        </RenderIfSubProjectAdmin>
                                                    </Fragment>
                                                ) : (
                                                    ''
                                                )}
                                            </div>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

const mapStateToProps = (state, props) => {
    const { componentId, monitorId } = props.match.params;
    const component = state.component.componentList.components.map(item => {
        return item.components.find(component => component._id === componentId);
    });
    const monitor = state.monitor.monitorsList.monitors
        .map(monitor =>
            monitor.monitors.find(monitor => monitor._id === monitorId)
        )
        .filter(monitor => monitor)[0];
    const initialValues = {};
    if (monitor) {
        initialValues[`name_${monitor._id}`] = monitor.name;
        initialValues[`url_${monitor._id}`] = monitor.data && monitor.data.url;
        initialValues[`deviceId_${monitor._id}`] =
            monitor.data && monitor.data.deviceId;
        initialValues[`description_${monitor._id}`] =
            monitor.data && monitor.data.description;
        initialValues[`subProject_${monitor._id}`] = monitor.projectId._id;
        initialValues[`monitorCategoryId_${monitor._id}`] =
            monitor.monitorCategoryId && monitor.monitorCategoryId._id;
        if (
            monitor.type === 'url' ||
            monitor.type === 'api' ||
            monitor.type === 'server-monitor'
        ) {
            if (monitor.criteria && monitor.criteria.up) {
                initialValues[`up_${monitor._id}`] = mapCriteria(
                    monitor.criteria.up
                );
                initialValues[`up_${monitor._id}_createAlert`] =
                    monitor.criteria &&
                    monitor.criteria.up &&
                    monitor.criteria.up.createAlert;
                initialValues[`up_${monitor._id}_autoAcknowledge`] =
                    monitor.criteria &&
                    monitor.criteria.up &&
                    monitor.criteria.up.autoAcknowledge;
                initialValues[`up_${monitor._id}_autoResolve`] =
                    monitor.criteria &&
                    monitor.criteria.up &&
                    monitor.criteria.up.autoResolve;
            }
            if (monitor.criteria && monitor.criteria.degraded) {
                initialValues[`degraded_${monitor._id}`] = mapCriteria(
                    monitor.criteria.degraded
                );
                initialValues[`degraded_${monitor._id}_createAlert`] =
                    monitor.criteria &&
                    monitor.criteria.degraded &&
                    monitor.criteria.degraded.createAlert;
                initialValues[`degraded_${monitor._id}_autoAcknowledge`] =
                    monitor.criteria &&
                    monitor.criteria.degraded &&
                    monitor.criteria.degraded.autoAcknowledge;
                initialValues[`degraded_${monitor._id}_autoResolve`] =
                    monitor.criteria &&
                    monitor.criteria.degraded &&
                    monitor.criteria.degraded.autoResolve;
            }
            if (monitor.criteria && monitor.criteria.down) {
                initialValues[`down_${monitor._id}`] = mapCriteria(
                    monitor.criteria.down
                );
                initialValues[`down_${monitor._id}_createAlert`] =
                    monitor.criteria &&
                    monitor.criteria.down &&
                    monitor.criteria.down.createAlert;
                initialValues[`down_${monitor._id}_autoAcknowledge`] =
                    monitor.criteria &&
                    monitor.criteria.down &&
                    monitor.criteria.down.autoAcknowledge;
                initialValues[`down_${monitor._id}_autoResolve`] =
                    monitor.criteria &&
                    monitor.criteria.down &&
                    monitor.criteria.down.autoResolve;
            }
        }
        if (monitor.type === 'api') {
            if (monitor.method && monitor.method.length)
                initialValues[`method_${monitor._id}`] = monitor.method;
            if (monitor.bodyType && monitor.bodyType.length)
                initialValues[`bodyType_${monitor._id}`] = monitor.bodyType;
            if (monitor.text && monitor.text.length)
                initialValues[`text_${monitor._id}`] = monitor.text;
            if (monitor.formData && monitor.formData.length)
                initialValues[`formData_${monitor._id}`] = monitor.formData;
            if (monitor.headers && monitor.headers.length)
                initialValues[`headers_${monitor._id}`] = monitor.headers;
        }
    }
    return {
        componentId,
        monitor,
        initialValues,
        match: props.match,
        component,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchMonitorsIncidents,
            fetchMonitorsSubscribers,
            getMonitorLogs,
            fetchLighthouseLogs,
            getProbes,
        },
        dispatch
    );
};

MonitorView.propTypes = {
    componentId: PropTypes.string,
    monitor: PropTypes.object,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    fetchMonitorsSubscribers: PropTypes.func.isRequired,
    initialValues: PropTypes.object.isRequired,
    getMonitorLogs: PropTypes.func.isRequired,
    fetchLighthouseLogs: PropTypes.func.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    getProbes: PropTypes.func.isRequired,
};

MonitorView.displayName = 'MonitorView';

export default connect(mapStateToProps, mapDispatchToProps)(MonitorView);
