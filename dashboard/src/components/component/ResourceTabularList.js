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
        const baseUrl = `/dashboard/project/${currentProject._id}/${componentId}/`;
        let route = '';
        switch (componentResource.type) {
            case 'url monitor':
            case 'device monitor':
            case 'manual monitor':
            case 'api monitor':
            case 'server-monitor monitor':
            case 'script monitor':
                route = 'monitoring';
                break;
            case 'application security':
                route = 'security/application';
                break;
            case 'container security':
                route = 'security/container';
                break;
            case 'application logs':
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
        let appSecurityStatus = 'no data yet',
            monitorStatus;
        const { monitors, probes, activeProbe } = this.props;
        const { startDate, endDate } = this.state;
        switch (componentResource.type) {
            case 'url monitor':
            case 'device monitor':
            case 'manual monitor':
            case 'api monitor':
            case 'server-monitor monitor':
            case 'script monitor':
                // get monitor status
                monitor = monitors.filter(
                    monitor => monitor._id === componentResource._id
                )[0];
                if (monitor.statuses) {
                    // Get the latest status here if the monitor is changing status elsewheree
                    monitorStatus = monitor.statuses[0].statuses[0].status;
                } else {
                    // Get the latest status here if the page is just loading
                    probe =
                        monitor && probes && probes.length > 0
                            ? probes[probes.length < 2 ? 0 : activeProbe]
                            : null;
                    logs = filterProbeData(monitor, probe, startDate, endDate)
                        .logs;
                    monitorStatus = getMonitorStatus(monitor.incidents, logs);
                }

                indicator = (
                    <StatusIndicator
                        status={monitorStatus}
                        resourceName={componentResource.name}
                    />
                );
                statusDescription = monitorStatus;
                break;
            case 'application security':
            case 'container security':
                // get application security status
                if (componentResource.securityLog.data) {
                    appSecurityStatus = threatLevel(
                        componentResource.securityLog.data.vulnerabilities
                    );
                    statusDescription = `${appSecurityStatus} issues`;
                } else {
                    statusDescription = 'No Scan Yet';
                }
                indicator = (
                    <IssueIndicator
                        status={appSecurityStatus}
                        resourceName={componentResource.name}
                        count={
                            componentResource.securityLog.data.vulnerabilities[
                                appSecurityStatus
                            ]
                        }
                    />
                );
                break;
            case 'application logs':
                // get application log status
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
        const { componentResource } = this.props;

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
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                            {componentResource &&
                            componentResource.componentResources &&
                            componentResource.componentResources.length > 0 ? (
                                componentResource.componentResources.map(
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
                                                    history.push(
                                                        this.generateUrlLink(
                                                            componentResource
                                                        )
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
                                                            <div className="Box-root Margin-right--16 Flex-flex Flex-direction--row">
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
                                                        <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Margin-right--16 Flex-flex Flex-direction--row">
                                                                <span
                                                                    className={`Badge-text Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--capitalize`}
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
                                                    <div className="db-ListViewItem-link">
                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                            <div
                                                                className={` Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                            >
                                                                <span
                                                                    id={`resource_type_${componentResource.name}`}
                                                                    className={`Badge-text Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--capitalize`}
                                                                >
                                                                    {
                                                                        componentResource.type
                                                                    }
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td
                                                    className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        minWidth: '100px',
                                                    }}
                                                >
                                                    <button
                                                        id={`view-resource-${componentResource.name}`}
                                                        className="bs-Button"
                                                        type="button"
                                                        onClick={() => {
                                                            history.push(
                                                                this.generateUrlLink(
                                                                    componentResource
                                                                )
                                                            );
                                                        }}
                                                    >
                                                        <span>View</span>
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
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
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
        },
        dispatch
    );
};
function mapStateToProps(state, props) {
    let componentResource,
        monitors = null;
    if (state.component.componentResourceList) {
        componentResource =
            state.component.componentResourceList[props.componentId];
    }

    monitors = state.monitor.monitorsList.monitors[0]
        ? state.monitor.monitorsList.monitors[0].monitors
        : null;

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
    activeProbe: PropTypes.number,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ResourceTabularList);
