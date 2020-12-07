import React, { Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import {
    fetchMonitorsIncidents,
    fetchMonitorsSubscribers,
    getMonitorLogs,
    fetchLighthouseLogs,
} from '../actions/monitor';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import MonitorViewHeader from '../components/monitor/MonitorViewHeader';
import MonitorViewIncidentBox from '../components/monitor/MonitorViewIncidentBox';
import MonitorViewLighthouseLogsBox from '../components/monitor/MonitorViewLighthouseLogsBox';
import MonitorViewSubscriberBox from '../components/monitor/MonitorViewSubscriberBox';
import MonitorViewDeleteBox from '../components/monitor/MonitorViewDeleteBox';
import NewMonitor from '../components/monitor/NewMonitor';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
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
import MSTeamsBox from '../components/webHooks/MSTeamsBox';
import SlackBox from '../components/webHooks/SlackBox';
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import { fetchBasicIncidentSettings } from '../actions/incidentBasicsSettings';
import { fetchCommunicationSlas } from '../actions/incidentCommunicationSla';
import { fetchMonitorSlas } from '../actions/monitorSla';

class MonitorView extends React.Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
        this.state = {
            tabIndex: 0,
        };
    }

    componentWillMount() {
        resetIdCounter();
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > MONITOR > MONITOR DETAIL PAGE'
            );
        }
    }

    componentDidUpdate(prevProps) {
        const { monitor } = this.props;
        if (!prevProps.monitor && monitor) {
            const subProjectId = monitor.projectId._id || monitor.projectId;
            this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
            if (monitor.type === 'url') {
                this.props.fetchLighthouseLogs(
                    monitor.projectId._id || monitor.projectId,
                    monitor._id,
                    0,
                    1,
                    monitor.data.url
                );
                this.props.fetchLighthouseLogs(subProjectId, monitor._id, 0, 5); //0 -> skip, 10-> limit.
            }
            this.props.fetchMonitorsIncidents(subProjectId, monitor._id, 0, 5); //0 -> skip, 5-> limit.
            this.props.fetchMonitorsSubscribers(
                subProjectId,
                monitor._id,
                0,
                5
            ); //0 -> skip, 5-> limit.
            this.props.getMonitorLogs(
                subProjectId,
                monitor._id,
                0,
                10,
                moment()
                    .subtract(1, 'd')
                    .utc(),
                moment().utc()
            ); //0 -> skip, 5-> limit.

            this.props.fetchMonitorSlas(subProjectId);
            this.props.fetchCommunicationSlas(subProjectId);
        }
    }
    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

    ready = () => {
        const { monitor } = this.props;
        this.props.fetchIncidentPriorities(this.props.currentProject._id, 0, 0);
        this.props.fetchBasicIncidentSettings(this.props.currentProject._id);
        const subProjectId = monitor.projectId._id || monitor.projectId;
        this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
        if (monitor.type === 'url') {
            this.props.fetchLighthouseLogs(
                monitor.projectId._id || monitor.projectId,
                monitor._id,
                0,
                1,
                monitor.data.url
            );
            this.props.fetchLighthouseLogs(subProjectId, monitor._id, 0, 5); //0 -> skip, 10-> limit.
        }
        this.props.fetchMonitorsIncidents(subProjectId, monitor._id, 0, 5); //0 -> skip, 5-> limit.
        this.props.fetchMonitorsSubscribers(subProjectId, monitor._id, 0, 5); //0 -> skip, 5-> limit.
        this.props.getMonitorLogs(
            subProjectId,
            monitor._id,
            0,
            10,
            moment()
                .subtract(1, 'd')
                .utc(),
            moment().utc()
        ); //0 -> skip, 5-> limit.

        this.props.fetchMonitorSlas(subProjectId);
        this.props.fetchCommunicationSlas(subProjectId);
    };

    isDefaultMonitorSlaSet = () => {
        const { monitorSlas } = this.props;
        return monitorSlas && monitorSlas.some(sla => sla.isDefault);
    };

    render() {
        const {
            initialValues,
            location: { pathname },
            component,
            monitor,
            monitorSlas,
        } = this.props;
        const subProjectId = this.props.monitor
            ? this.props.monitor.projectId._id || this.props.monitor.projectId
            : null;
        const componentName = component ? component.name : '';
        const monitorName = monitor ? monitor.name : '';
        const monitorType = monitor && monitor.type ? monitor.type : '';

        const componentMonitorsRoute = getParentRoute(pathname);
        const defaultMonitorSla = monitorSlas.find(sla => sla.isDefault);

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={componentMonitorsRoute}
                        name={componentName}
                    />
                    <BreadCrumbItem
                        route={`${componentMonitorsRoute}#`}
                        name="Monitors"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name={monitorName}
                        pageTitle="Monitor View"
                        type={monitor ? monitor.type : null}
                    />
                    <Tabs
                        selectedTabClassName={'custom-tab-selected'}
                        onSelect={tabIndex => this.tabSelected(tabIndex)}
                        selectedIndex={this.state.tabIndex}
                    >
                        <div className="Flex-flex Flex-direction--columnReverse">
                            <TabList
                                id="customTabList"
                                className={'custom-tab-list'}
                            >
                                <Tab className={'custom-tab custom-tab-4'}>
                                    Basic
                                </Tab>
                                <Tab className={'custom-tab custom-tab-4'}>
                                    Subscribers
                                </Tab>
                                <Tab className={'custom-tab custom-tab-4'}>
                                    Integrations
                                </Tab>
                                <Tab className={'custom-tab custom-tab-4'}>
                                    Advanced Options
                                </Tab>
                                <div
                                    id="tab-slider"
                                    className="custom-tab-4"
                                ></div>
                            </TabList>
                        </div>
                        {!this.props.requestingMonitorSla &&
                            this.props.monitor &&
                            (this.props.monitor.monitorSla ||
                                this.isDefaultMonitorSlaSet()) &&
                            !this.props.monitor.breachedMonitorSla && (
                                <div
                                    className="Box-root Margin-vertical--12"
                                    style={{ marginTop: 0, cursor: 'pointer' }}
                                    id="noMonitorSlaBreached"
                                >
                                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                        <div className="Box-root Box-background--green Card-shadow--medium Border-radius--4">
                                            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Padding-horizontal--20 Padding-vertical--12">
                                                <span
                                                    className="db-SideNav-icon db-SideNav-icon--tick db-SideNav-icon--selected"
                                                    style={{
                                                        filter:
                                                            'brightness(0) invert(1)',
                                                        marginTop: 1,
                                                        marginRight: 10,
                                                    }}
                                                ></span>
                                                <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                                    {this.props.monitor
                                                        .monitorSla ? (
                                                        <span>
                                                            For the past{' '}
                                                            {
                                                                this.props
                                                                    .monitor
                                                                    .monitorSla
                                                                    .frequency
                                                            }{' '}
                                                            days, this monitor
                                                            has not breached the
                                                            defined SLA
                                                        </span>
                                                    ) : (
                                                        <span>
                                                            For the past{' '}
                                                            {
                                                                defaultMonitorSla.frequency
                                                            }{' '}
                                                            days, this monitor
                                                            has not breached the
                                                            defined SLA
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        {!this.props.requestingMonitorSla &&
                            this.props.monitor &&
                            this.props.monitor.breachedMonitorSla &&
                            (this.props.monitor.monitorSla ||
                                this.isDefaultMonitorSlaSet()) && (
                                <div
                                    className="Box-root Margin-vertical--12"
                                    style={{ marginTop: 0 }}
                                    id="monitorSlaBreached"
                                >
                                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                        <div className="Box-root Box-background--red4 Card-shadow--medium Border-radius--4">
                                            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Padding-horizontal--20 Padding-vertical--12">
                                                <span
                                                    className="db-SideNav-icon db-SideNav-icon--info db-SideNav-icon--selected"
                                                    style={{
                                                        filter:
                                                            'brightness(0) invert(1)',
                                                        marginTop: 1,
                                                        marginRight: 10,
                                                    }}
                                                ></span>
                                                <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                                    {this.props.monitor
                                                        .monitorSla ? (
                                                        <span>
                                                            In the last{' '}
                                                            {
                                                                this.props
                                                                    .monitor
                                                                    .monitorSla
                                                                    .frequency
                                                            }{' '}
                                                            days, the SLA for
                                                            this monitor was
                                                            breached
                                                        </span>
                                                    ) : (
                                                        <span>
                                                            In the last{' '}
                                                            {
                                                                defaultMonitorSla.frequency
                                                            }{' '}
                                                            days, the SLA for
                                                            this monitor was
                                                            breached
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        <div className="Box-root">
                            <div>
                                <div>
                                    <div className="db-BackboneViewContainer">
                                        <div className="react-settings-view react-view">
                                            <span data-reactroot="">
                                                <div>
                                                    <div>
                                                        {this.props.monitor &&
                                                        this.props.monitor
                                                            ._id &&
                                                        this.props.monitor
                                                            .type &&
                                                        (((this.props.monitor
                                                            .type === 'url' ||
                                                            this.props.monitor
                                                                .type ===
                                                                'api') &&
                                                            !this.props
                                                                .probeList
                                                                .requesting) ||
                                                            (this.props.monitor
                                                                .type !==
                                                                'url' &&
                                                                this.props
                                                                    .monitor
                                                                    .type !==
                                                                    'api')) ? (
                                                            <Fragment>
                                                                <TabPanel>
                                                                    <Fade>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <ShouldRender
                                                                                if={
                                                                                    !this
                                                                                        .props
                                                                                        .edit
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
                                                                                    this
                                                                                        .props
                                                                                        .edit
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
                                                                                    edit={
                                                                                        true
                                                                                    }
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
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <MonitorViewIncidentBox
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
                                                                        <ShouldRender
                                                                            if={
                                                                                this
                                                                                    .props
                                                                                    .monitor &&
                                                                                this
                                                                                    .props
                                                                                    .monitor
                                                                                    .type &&
                                                                                this
                                                                                    .props
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
                                                                        <ShouldRender
                                                                            if={
                                                                                this
                                                                                    .props
                                                                                    .monitor &&
                                                                                this
                                                                                    .props
                                                                                    .monitor
                                                                                    .type &&
                                                                                (this
                                                                                    .props
                                                                                    .monitor
                                                                                    .type ===
                                                                                    'url' ||
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        .type ===
                                                                                        'api' ||
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        .type ===
                                                                                        'server-monitor' ||
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        .type ===
                                                                                        'incomingHttpRequest')
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
                                                                                    monitorType={
                                                                                        monitorType
                                                                                    }
                                                                                />
                                                                            </div>
                                                                        </ShouldRender>
                                                                    </Fade>
                                                                </TabPanel>
                                                                <TabPanel>
                                                                    <Fade>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <MonitorViewSubscriberBox
                                                                                monitorId={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </Fade>
                                                                </TabPanel>

                                                                <TabPanel>
                                                                    <Fade>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <MSTeamsBox
                                                                                monitorId={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                            />
                                                                        </div>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <SlackBox
                                                                                monitorId={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                            />
                                                                        </div>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <WebHookBox
                                                                                monitorId={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </Fade>
                                                                </TabPanel>

                                                                <TabPanel>
                                                                    <Fade>
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
                                                                    </Fade>
                                                                </TabPanel>
                                                            </Fragment>
                                                        ) : (
                                                            <LoadingState />
                                                        )}
                                                    </div>
                                                </div>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Tabs>
                </Fade>
            </Dashboard>
        );
    }
}

const mapStateToProps = (state, props) => {
    const { componentId, monitorId } = props.match.params;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
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
        initialValues[`resourceCategory_${monitor._id}`] =
            monitor.resourceCategory && monitor.resourceCategory._id;
        if (
            monitor.incidentCommunicationSla &&
            monitor.incidentCommunicationSla._id
        ) {
            initialValues.incidentCommunicationSla =
                monitor.incidentCommunicationSla._id;
        }
        if (monitor.monitorSla && monitor.monitorSla._id) {
            initialValues.monitorSla = monitor.monitorSla._id;
        }
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
        edit: state.monitor.monitorsList.editMode,
        initialValues,
        match: props.match,
        component,
        probeList: state.probe.probes,
        currentProject: state.project.currentProject,
        requestingIncidentSla:
            state.incidentSla.incidentCommunicationSlas.requesting,
        requestingMonitorSla: state.monitorSla.monitorSlas.requesting,
        monitorSlas: state.monitorSla.monitorSlas.slas,
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
            fetchIncidentPriorities,
            fetchBasicIncidentSettings,
            fetchCommunicationSlas,
            fetchMonitorSlas,
        },
        dispatch
    );
};

MonitorView.propTypes = {
    componentId: PropTypes.string,
    monitor: PropTypes.object,
    edit: PropTypes.bool,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    fetchMonitorsSubscribers: PropTypes.func.isRequired,
    initialValues: PropTypes.object.isRequired,
    getMonitorLogs: PropTypes.func.isRequired,
    fetchLighthouseLogs: PropTypes.func.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.shape({
        name: PropTypes.string,
    }),
    getProbes: PropTypes.func.isRequired,
    probeList: PropTypes.object,
    currentProject: PropTypes.object.isRequired,
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchBasicIncidentSettings: PropTypes.func.isRequired,
    fetchCommunicationSlas: PropTypes.func,
    fetchMonitorSlas: PropTypes.func,
    requestingIncidentSla: PropTypes.bool,
    requestingMonitorSla: PropTypes.bool,
    monitorSlas: PropTypes.array,
};

MonitorView.displayName = 'MonitorView';

export default connect(mapStateToProps, mapDispatchToProps)(MonitorView);
