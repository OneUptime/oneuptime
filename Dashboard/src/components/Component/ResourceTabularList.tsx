import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { history, RootState } from '../../store';
import { ListLoader } from '../basic/Loader';
import {
    fetchComponentResources,
    addCurrentComponent,
} from '../../actions/component';
import { bindActionCreators, Dispatch } from 'redux';
import threatLevel from '../../utils/threatLevel';
import StatusIndicator from '../monitor/StatusIndicator';
import IssueIndicator from '../security/IssueIndicator';
import sortByName from '../../utils/sortByName';
import { animateSidebar } from '../../actions/animateSidebar';

interface ResourceTabularListProps {
    componentResource?: object;
    currentProject?: object;
    componentSlug?: string;
    monitors?: unknown[];
    animateSidebar?: Function;
    addCurrentComponent?: Function;
    componentName?: string;
}

class ResourceTabularList extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
    }
    generateUrlLink(componentResource: $TSFixMe) {

        const { currentProject, componentSlug } = this.props;
        const baseUrl:string = `/dashboard/project/${currentProject.slug}/component/${componentSlug}/`;
        let route = '';
        switch (componentResource.type) {
            case 'website monitor':
            case 'device monitor':
            case 'manual monitor':
            case 'api monitor':
            case 'server monitor':
            case 'script monitor':
            case 'incomingHttpRequest monitor':
            case 'kubernetes monitor':
            case 'IP monitor':
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
            case 'error tracker':
                route = 'error-trackers';
                break;
            case 'performance tracker':
                route = 'performance-tracker';
                break;
            default:
                break;
        }
        return `${baseUrl}${route}/${componentResource.slug}`;
    }
    generateResourceStatus(componentResource: $TSFixMe) {
        let statusColor = 'slate';
        let statusDescription = 'TBD';
        let indicator, monitor, status;
        let appSecurityStatus = 'currently scanning',
            containerSecurityStatus = 'currently scanning';

        const { monitors } = this.props;

        let data = null;
        switch (componentResource.type) {
            case 'device monitor':
            case 'manual monitor':
            case 'script monitor':
            case 'website monitor':
            case 'api monitor':
            case 'server monitor':
            case 'IP monitor':
            case 'kubernetes monitor':
            case 'incomingHttpRequest monitor': {
                // get monitor status
                monitor = monitors.filter(
                    (monitor: $TSFixMe) => monitor._id === componentResource._id
                )[0];
                if (monitor) {
                    const incidents = monitor.incidents;
                    const lastMatchedCriterion =
                        monitor.lastMatchedCriterion &&
                        monitor.lastMatchedCriterion.name &&
                        monitor.lastMatchedCriterion.name.toLowerCase();
                    status = monitor.monitorStatus
                        ? monitor.monitorStatus
                        : lastMatchedCriterion
                            ? lastMatchedCriterion
                            : incidents && incidents[0]
                                ? incidents[0].incidentType === 'online' ||
                                    incidents[0].resolved
                                    ? 'online'
                                    : incidents[0].incidentType
                                : 'online';

                    indicator = (
                        <StatusIndicator
                            status={status}

                            resourceName={componentResource.name}
                            monitorName={monitor && monitor.name}
                        />
                    );
                    statusDescription = status;
                }

                break;
            }
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
            case 'error tracker':
                if (componentResource.status === 'Listening for Errors')
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
            case 'performance tracker':
                if (componentResource.status === 'Monitoring performance')
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

    override render() {

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
                                    style={{ height: '1px', width: '40%' }}
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
                                    (componentResource: $TSFixMe, i: $TSFixMe) => {
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

                                                    this.props.addCurrentComponent(
                                                        componentResource.component
                                                    );
                                                }}
                                            >
                                                <td
                                                    className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        width: '40%',
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
                                                                        backgroundSize: `${componentResource.icon ===
                                                                            'appLog' ||
                                                                            componentResource.icon ===
                                                                            'security' ||
                                                                            componentResource.icon ===
                                                                            'errorTracking'
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
                                                            <div
                                                                className={`Box-root ${componentResource.type ===
                                                                    'error tracker'
                                                                    ? ''
                                                                    : 'Margin-right--16 '
                                                                    } Flex-flex Flex-direction--row`}
                                                            >
                                                                <span
                                                                    className={`Badge-text Text-fontWeight--bold Text-lineHeight--16 Text-typeface--capitalize`}
                                                                    style={{
                                                                        whiteSpace:
                                                                            'normal',
                                                                    }}
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
                                                                    : componentResource.type ===
                                                                        'incomingHttpRequest monitor'
                                                                        ? 'incoming Http Request Monitor'
                                                                        : componentResource.type ===
                                                                            'ip'
                                                                            ? ' IP Monitor'
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
const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchComponentResources,
            addCurrentComponent,
            animateSidebar,
        },
        dispatch
    );
};
function mapStateToProps(state: RootState, props: $TSFixMe) {
    let componentResource,
        monitors: $TSFixMe = [];
    if (state.component.componentResourceList) {
        componentResource =
            state.component.componentResourceList[props.componentId];
    }

    state.monitor.monitorsList.monitors.map((monitor: $TSFixMe) => {
        monitors = monitors.concat(...monitor.monitors);
        return monitor;
    });
    return {
        componentResource,
        monitors,
        probes: state.probe.probes.data,
        activeProbe: state.monitor.activeProbe,
        monitorLogsRequest: state.monitor.monitorLogsRequest,
        monitorListRequesting: state.monitor.monitorsList.requesting,
    };
}


ResourceTabularList.propTypes = {
    componentResource: PropTypes.object,
    currentProject: PropTypes.object,
    componentSlug: PropTypes.string,
    monitors: PropTypes.array,
    animateSidebar: PropTypes.func,
    addCurrentComponent: PropTypes.func,
    componentName: PropTypes.string,
};


ResourceTabularList.defaultProps = {
    componentName: 'default',
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ResourceTabularList);
