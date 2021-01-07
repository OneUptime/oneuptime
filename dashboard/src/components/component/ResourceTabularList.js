import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { history } from '../../store';
import { ListLoader } from '../basic/Loader';
import { fetchComponentResources } from '../../actions/component';
import { getMonitorStatus, filterProbeData } from '../../config';
import { bindActionCreators } from 'redux';
import threatLevel from '../../utils/threatLevel';
import StatusIndicator from '../monitor/StatusIndicator';
import moment from 'moment';
import IssueIndicator from '../security/IssueIndicator';
import sortByName from '../../utils/sortByName';
import { animateSidebar } from '../../actions/animateSidebar';

class ResourceTabularList extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            startDate: moment().subtract(30, 'd'),
            endDate: moment(),
        };
    }
    generateUrlLink(componentResource) {
        const { currentProject, componentId } = this.props;
        const baseUrl = `/dashboard/project/${currentProject.slug}/${componentId}/`;
        let route = '';
        switch (componentResource.type) {
            case 'website monitor':
            case 'device monitor':
            case 'manual monitor':
            case 'api monitor':
            case 'server monitor':
            case 'script monitor':
            case 'incomingHttpRequest monitor':
                route = 'monitoring';
                break;
            case 'application security':
                route = 'security/application';
                break;
            case 'container security':
                route = 'security/container';
                break;
            case 'log container':
                route = 'application-logs';
                break;
            default:
                break;
        }
        return `${baseUrl}${route}/${componentResource._id}`;
    }
    generateResourceStatus(componentResource) {
        let statusColor = 'slate';
        let statusDescription = 'TBD';
        let indicator, monitor, logs, probe;
        let appSecurityStatus = 'currently scanning',
            containerSecurityStatus = 'currently scanning',
            monitorStatus = '';
        const { monitors, probes, activeProbe } = this.props;
        const { startDate, endDate } = this.state;
        let data = null;
        switch (componentResource.type) {
            case 'website monitor':
            case 'device monitor':
            case 'manual monitor':
            case 'api monitor':
            case 'server monitor':
            case 'script monitor':
            case 'incomingHttpRequest monitor':
                // get monitor status
                monitor = monitors.filter(
                    monitor => monitor._id === componentResource._id
                )[0];
                // Monitor already exists in the list of monitors
                if (monitor) {
                    if (monitor.disabled) {
                        // Get the latest status here if the monitor is changing status elsewheree
                        monitorStatus = 'disabled';
                    } else if (monitor.statuses && monitor.statuses[0]) {
                        // Get the latest status here if the monitor is changing status elsewheree
                        monitorStatus = monitor.statuses[0].statuses[0].status;
                    } else {
                        // Get the latest status here if the page is just loading
                        probe =
                            monitor && probes && probes.length > 0
                                ? probes[probes.length < 2 ? 0 : activeProbe]
                                : null;
                        logs = filterProbeData(
                            monitor,
                            probe,
                            startDate,
                            endDate
                        ).logs;
                        monitorStatus = getMonitorStatus(
                            monitor.incidents,
                            logs,
                            componentResource.type
                        );
                    }
                }

                indicator = (
                    <StatusIndicator
                        status={monitorStatus}
                        resourceName={componentResource.name}
                        monitorName={monitor && monitor.name}
                    />
                );
                statusDescription = monitorStatus;
                break;
            case 'application security':
                // get application security status
                data =
                    componentResource.securityLog &&
                    componentResource.securityLog.data
                        ? componentResource.securityLog.data
                        : null;
                if (data) {
                    appSecurityStatus = threatLevel(data.vulnerabilities);
                    statusDescription = `${appSecurityStatus} issues`;
                } else {
                    statusDescription = 'No Scan Yet';
                }
                indicator = (
                    <IssueIndicator
                        status={appSecurityStatus}
                        resourceName={componentResource.name}
                        count={
                            data && data.vulnerabilities
                                ? data.vulnerabilities[appSecurityStatus]
                                : ''
                        }
                    />
                );
                break;
            case 'container security':
                // get container security status
                data =
                    componentResource.securityLog &&
                    componentResource.securityLog.data &&
                    componentResource.securityLog.data.vulnerabilityInfo
                        ? componentResource.securityLog.data
                        : null;
                if (data) {
                    containerSecurityStatus = threatLevel(
                        data.vulnerabilityInfo
                    );
                    statusDescription = `${containerSecurityStatus} issues`;
                } else {
                    statusDescription = 'No Scan Yet';
                }
                indicator = (
                    <IssueIndicator
                        status={containerSecurityStatus}
                        resourceName={componentResource.name}
                        count={
                            data && data.vulnerabilityInfo
                                ? data.vulnerabilityInfo[
                                      containerSecurityStatus
                                  ]
                                : ''
                        }
                    />
                );
                break;
            case 'log container':
                // get log container status
                if (componentResource.status === 'Collecting Logs')
                    statusColor = 'green';

                statusDescription = componentResource.status;
                indicator = (
                    <div className="Flex-flex">
                        <div
                            className={`db-Badge Box-background--${statusColor}`}
                        ></div>

                        <span
                            id={`resource_status_${componentResource.name}`}
                            className={`Text-color--${statusColor}`}
                        >
                            {' '}
                            {` ${statusDescription}`}{' '}
                        </span>
                    </div>
                );
                break;
            default:
                break;
        }

        return <div>{indicator}</div>;
    }

    render() {
        const { componentResource, componentName } = this.props;
        const componentResources =
            componentResource && componentResource.componentResources
                ? sortByName(componentResource.componentResources)
                : [];

        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '210px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Resource Name</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '100px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Status</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Resource Type</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '100px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Action</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {componentResources &&
                            componentResources.length > 0 ? (
                                componentResources.map(
                                    (componentResource, i) => {
                                        return (
                                            <tr
                                                id={`componentResource_${i}`}
                                                key={componentResource._id}
                                                className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                                style={{
                                                    height: '50px',
                                                }}
                                                onClick={() => {
                                                    setTimeout(() => {
                                                        history.push(
                                                            this.generateUrlLink(
                                                                componentResource
                                                            )
                                                        );
                                                        this.props.animateSidebar(
                                                            false
                                                        );
                                                    }, 500);
                                                    this.props.animateSidebar(
                                                        true
                                                    );
                                                }}
                                            >
                                                <td
                                                    className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        minWidth: '210px',
                                                    }}
                                                >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Margin-right--16 Flex-flex Flex-direction--row resourceName-width">
                                                                <span
                                                                    className={`db-SideNav-icon db-SideNav-icon--${componentResource.icon} db-SideNav-icon--selected Margin-right--4`}
                                                                    style={{
                                                                        backgroundRepeat:
                                                                            'no-repeat',
                                                                        backgroundSize: `${
                                                                            componentResource.icon ===
                                                                                'appLog' ||
                                                                            componentResource.icon ===
                                                                                'security'
                                                                                ? '12px'
                                                                                : '15px'
                                                                        }`,
                                                                        backgroundPosition:
                                                                            'center',
                                                                        margin:
                                                                            '3px 3px',
                                                                    }}
                                                                />
                                                                <span>
                                                                    {
                                                                        componentResource.name
                                                                    }
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </td>
                                                <td
                                                    className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        minWidth: '100px',
                                                    }}
                                                >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Margin-right--16 Flex-flex Flex-direction--row">
                                                                <span
                                                                    className={`Badge-text Text-fontWeight--bold Text-lineHeight--16 Text-typeface--capitalize`}
                                                                >
                                                                    {this.generateResourceStatus(
                                                                        componentResource
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </td>
                                                <td
                                                    className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{ height: '1px' }}
                                                >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <div
                                                            className={` Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 resourceType-width`}
                                                        >
                                                            <span
                                                                id={`resource_type_${componentResource.name}`}
                                                                className={`Badge-text Text-lineHeight--16 Text-typeface--capitalize`}
                                                            >
                                                                {componentResource.type ===
                                                                'api monitor'
                                                                    ? 'API Monitor'
                                                                    : componentResource.type}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td
                                                    className="Table-cell Table-cell--align--right  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell Padding-right--20"
                                                    style={{
                                                        height: '1px',
                                                        minWidth: '100px',
                                                    }}
                                                >
                                                    <button
                                                        id={`view-resource-${componentResource.name}`}
                                                        className="bs-Button"
                                                        type="button"
                                                    >
                                                        <span>
                                                            View Resource
                                                        </span>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    }
                                )
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {!componentResource || componentResource?.requesting ? (
                    <ListLoader />
                ) : null}
                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {componentResource &&
                    (!componentResource.componentResources ||
                        !componentResource.componentResources.length) &&
                    !componentResource.requesting &&
                    !componentResource.error
                        ? "We don't have any resources added yet"
                        : null}
                    {componentResource && componentResource.error
                        ? componentResource.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span
                                    id={`count_${componentName}`}
                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                >
                                    {componentResource &&
                                    componentResource.componentResources
                                        ? componentResource.componentResources
                                              .length +
                                          (componentResource &&
                                          componentResource.componentResources
                                              .length > 1
                                              ? ' Resources'
                                              : ' Resource')
                                        : null}
                                </span>
                            </span>
                        </span>
                    </div>
                </div>
            </div>
        );
    }
}

ResourceTabularList.displayName = 'ResourceTabularList';
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchComponentResources,
            animateSidebar,
        },
        dispatch
    );
};
function mapStateToProps(state, props) {
    let componentResource,
        monitors = [];
    if (state.component.componentResourceList) {
        componentResource =
            state.component.componentResourceList[props.componentId];
    }

    state.monitor.monitorsList.monitors.map(monitor => {
        monitors = monitors.concat(...monitor.monitors);
        return monitor;
    });
    return {
        componentResource,
        monitors,
        probes: state.probe.probes.data,
        activeProbe: state.monitor.activeProbe,
    };
}

ResourceTabularList.propTypes = {
    componentResource: PropTypes.object,
    currentProject: PropTypes.object,
    componentId: PropTypes.string,
    monitors: PropTypes.array,
    probes: PropTypes.array,
    animateSidebar: PropTypes.func,
    activeProbe: PropTypes.number,
    componentName: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

ResourceTabularList.defaultProps = {
    componentName: 'default',
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ResourceTabularList);
