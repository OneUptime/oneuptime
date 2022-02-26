import React, { Component, createRef } from 'react';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import { RenderSearchField } from '../basic/RenderSearchField';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { history } from '../../store';
import { addCurrentComponent } from '../../actions/component';
import { animateSidebar } from '../../actions/animateSidebar';
import { resetSearch, search } from '../../actions/search';
import { IS_LOCALHOST, User } from '../../config';
import { switchStatusPage } from '../../actions/statusPage';
import isSubProjectViewer from '../../utils/isSubProjectViewer';
import { addScheduleEvent } from '../../actions/scheduledEvent';
import { markAsRead } from '../../actions/notification';
import Badge from '../common/Badge';
import { addIncident } from '../../actions/incident';
import { getProbes } from '../../actions/probe';
import {
    fetchMonitors,
    fetchMonitorsIncidents,
    fetchMonitorsSubscribers,
    getMonitorLogs,
    fetchLighthouseLogs,
} from '../../actions/monitor';
import { fetchCommunicationSlas } from '../../actions/incidentCommunicationSla';
import { fetchMonitorSlas } from '../../actions/monitorSla';
import moment from 'moment';
import { addPerformanceTracker } from '../../actions/performanceTracker';

class Search extends Component {
    activeRef: $TSFixMe;
    containerRef: $TSFixMe;
    constructor() {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
        super();
        this.activeRef = createRef();
        this.containerRef = createRef();
    }
    state = {
        scroll: 0,
        sectionActive: 0,
    };

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoardScroll);
    }
    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoardScroll);
    }
    scrollToViewPort() {
        const panel = this.containerRef.current;
        const node = this.activeRef.current;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
        const searchObj = this.props.searcResult;

        if (
            searchObj.length > 0 &&
            this.state.scroll ===
                searchObj[searchObj.length - 1].values.length - 1 &&
            this.state.sectionActive === searchObj.length - 1
        ) {
            panel.scrollTop = 0;
        } else {
            node && node.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }
    ArrowUp = () => {
        this.scrollToViewPort();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
        const searchObj = this.props.searcResult;
        for (let i = 0; i < searchObj.length; i++) {
            if (i === this.state.sectionActive) {
                if (this.state.scroll === 0) {
                    return this.setState({
                        sectionActive:
                            this.state.sectionActive === 0
                                ? 0
                                : this.state.sectionActive - 1,

                        scroll:
                            this.state.sectionActive !== 0
                                ? searchObj[this.state.sectionActive - 1].values
                                      .length - 1
                                : this.state.scroll === 0
                                ? 0
                                : this.state.scroll - 1,
                    });
                } else {
                    return this.setState({
                        scroll: this.state.scroll - 1,
                    });
                }
            }
        }
    };
    ArrowDown = () => {
        this.scrollToViewPort();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
        const searchObj = this.props.searcResult;
        for (let i = 0; i < searchObj.length; i++) {
            if (i === this.state.sectionActive) {
                //check if its the last section
                if (searchObj[i].values.length - 1 === this.state.scroll) {
                    return this.setState({
                        sectionActive:
                            searchObj.length - 1 === this.state.sectionActive &&
                            searchObj[i].values.length - 1 === this.state.scroll
                                ? 0
                                : this.state.sectionActive + 1,
                        scroll: 0,
                    });
                } else {
                    return this.setState({
                        scroll: this.state.scroll + 1,
                    });
                }
            }
        }
    };

    //generate monitor url
    generateUrlLink(searchObj: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject } = this.props;
        const baseUrl = `/dashboard/project/${currentProject.slug}/component/${searchObj.componentSlug}/`;
        let route = '';
        switch (searchObj.type) {
            case 'url':
            case 'device':
            case 'manual':
            case 'api':
            case 'server':
            case 'script':
            case 'incomingHttpRequest':
            case 'kubernetes':
            case 'IP':
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
            default:
                break;
        }
        return `${baseUrl}${route}/${searchObj.monitorSlug}`;
    }

    switchStatusPages = (searchObj: $TSFixMe, path: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchStatusPage' does not exist on type... Remove this comment to see the full error message
        this.props.switchStatusPage(searchObj);
        history.push(path);
    };
    loadComponent = (currentProject: $TSFixMe, searchObj: $TSFixMe) => {
        history.push(
            '/dashboard/project/' + currentProject.slug + '/' + searchObj.url
        );
    };
    loadMonitor = async (currentProject: $TSFixMe, searchObj: $TSFixMe) => {
        history.push(this.generateUrlLink(searchObj));
        //fetch monitor resources as this does not load on search
        const monitor = searchObj;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitors' does not exist on type 'R... Remove this comment to see the full error message
        await this.props.fetchMonitors(currentProject._id);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(monitor.projectId, 0, 10); //
        if (monitor.type === 'url') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLighthouseLogs' does not exist on t... Remove this comment to see the full error message
            this.props.fetchLighthouseLogs(
                monitor.projectId,
                monitor.monitorId,
                0,
                1,
                monitor.data.url
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLighthouseLogs' does not exist on t... Remove this comment to see the full error message
            this.props.fetchLighthouseLogs(
                monitor.projectId,
                monitor.monitorId,
                0,
                5
            ); //0 -> skip, 10-> limit.
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsIncidents' does not exist o... Remove this comment to see the full error message
        this.props.fetchMonitorsIncidents(
            monitor.projectId,
            monitor.monitorId,
            0,
            10
        ); //0 -> skip, 5-> limit.

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getMonitorLogs' does not exist on type '... Remove this comment to see the full error message
        this.props.getMonitorLogs(
            monitor.projectId,
            monitor.monitorId,
            0,
            10,
            moment()
                .subtract(1, 'd')
                .utc(),
            moment().utc(),
            null,
            null,
            monitor.type
        ); //0 -> skip, 5-> limit.

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorSlas' does not exist on type... Remove this comment to see the full error message
        this.props.fetchMonitorSlas(monitor.projectId);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchCommunicationSlas' does not exist o... Remove this comment to see the full error message
        this.props.fetchCommunicationSlas(monitor.projectId);
    };

    loadIncident = (currentProject: $TSFixMe, searchObj: $TSFixMe) => {
        setTimeout(() => {
            history.push(
                '/dashboard/project/' +
                    currentProject.slug +
                    '/incidents/' +
                    searchObj.incidentSlug
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addIncident' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.addIncident(searchObj.incident);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
            this.props.animateSidebar(false);
        }, 200);
        const notifications = [{ notificationId: searchObj.notificationId }];
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'markAsRead' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.markAsRead(this.props.currentProject._id, notifications);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
        this.props.animateSidebar(true);
    };
    loadErrorTracker = (currentProject: $TSFixMe, searchObj: $TSFixMe) => {
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/component/' +
                searchObj.componentSlug +
                '/error-trackers/' +
                searchObj.errorTrackerSlug
        );
    };
    loadLogContainer = (currentProject: $TSFixMe, searchObj: $TSFixMe) => {
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/component/' +
                searchObj.componentSlug +
                '/application-logs/' +
                searchObj.logContainerSlug
        );
    };

    loadPerformanceTracker = (currentProject: $TSFixMe, searchObj: $TSFixMe) => {
        history.push(
            `/dashboard/project/${currentProject.slug}/component/${searchObj.componentSlug}/performance-tracker/${searchObj.performanceTrackerSlug}`
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addPerformanceTracker' does not exist on... Remove this comment to see the full error message
        this.props.addPerformanceTracker(searchObj.performanceTracker);
    };

    navigate = (type: $TSFixMe, searchObj: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, componentList } = this.props;
        let component, publicStatusPageUrl, path, userId;
        switch (type) {
            case 'Monitors':
            case 'Components':
                component =
                    componentList &&
                    componentList.components
                        .filter(
                            (project: $TSFixMe) => project._id === searchObj.projectId
                        )[0]
                        .components.filter(
                            (component: $TSFixMe) => component._id === searchObj.componentId
                        )[0];
                setTimeout(
                    () => {
                        type === 'Monitors'
                            ? this.loadMonitor(currentProject, searchObj)
                            : this.loadComponent(currentProject, searchObj);

                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
                        this.props.animateSidebar(false);
                    },
                    type === 'Monitors' ? 500 : 200
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
                this.props.animateSidebar(true);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'addCurrentComponent' does not exist on t... Remove this comment to see the full error message
                this.props.addCurrentComponent(component);
                break;
            case 'Status Pages':
                path = `/dashboard/project/${currentProject.slug}/status-page/${searchObj.statusPageSlug}`;
                userId = User.getUserId();
                if (IS_LOCALHOST) {
                    publicStatusPageUrl = `http://${searchObj.statusPageSlug}.localhost:3006`;
                } else {
                    publicStatusPageUrl =
                        window.location.origin +
                        '/status-page/' +
                        searchObj.statusPageSlug;
                }

                isSubProjectViewer(userId, currentProject)
                    ? window.open(publicStatusPageUrl, '_blank')
                    : this.switchStatusPages(searchObj.statusPage, path);
                break;
            case 'Team Members':
                history.push('/dashboard/profile/' + searchObj.userId);
                break;
            case 'On-Call Duty':
                history.push(
                    `/dashboard/project/${currentProject.slug}/schedule/${searchObj.scheduleSlug}`
                );
                break;
            case 'Schedule Events':
                history.push(
                    `/dashboard/project/${currentProject.slug}/scheduledEvents/${searchObj.scheduleEventSlug}`
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'addScheduleEvent' does not exist on type... Remove this comment to see the full error message
                this.props.addScheduleEvent(searchObj.scheduleEvents);
                break;
            case 'Incidents':
                this.loadIncident(currentProject, searchObj);
                break;
            case 'Error Trackers':
                this.loadErrorTracker(currentProject, searchObj);
                break;
            case 'Log Containers':
                this.loadLogContainer(currentProject, searchObj);
                break;
            case 'Performance Tracker':
                this.loadPerformanceTracker(currentProject, searchObj);
                break;
            default:
                return null;
        }
    };
    handleEnter = () => {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.searcResult.length > 0 &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchValues' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.searchValues &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchValues' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.searchValues.search !== ''
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
            const searchObj = this.props.searcResult[this.state.sectionActive]
                .values[this.state.scroll];
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
            const type = this.props.searcResult[this.state.sectionActive].title;
            this.navigate(type, searchObj);
            this.handleBlur();
        }
    };
    handleSearchClick = (sectionActive: $TSFixMe, scroll: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
        const searchObj = this.props.searcResult[sectionActive].values[scroll];
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
        const type = this.props.searcResult[sectionActive].title;
        this.navigate(type, searchObj);
        this.handleBlur();
    };
    handleKeyBoardScroll = (e: $TSFixMe) => {
        switch (e.key) {
            case 'ArrowUp':
                return this.ArrowUp();
            case 'ArrowDown':
                return this.ArrowDown();
            case 'Enter':
                return this.handleEnter();
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetSearch' does not exist on type 'Rea... Remove this comment to see the full error message
                return this.props.resetSearch();
            default:
                return false;
        }
    };
    handleBlur = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetSearch' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.resetSearch();
    };
    handleSearch = (val: $TSFixMe) => {
        if (val) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'search' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.search(this.props.currentProject._id, { search: val });
        } else {
            this.setState({
                scroll: 0,
                sectionActive: 0,
            });
        }
    };
    categoryIconClassName = (type: $TSFixMe) => {
        switch (type) {
            case 'Components':
                return 'db-SideNav-icon--square';
            case 'Monitors':
                return 'db-SideNav-icon--monitor';
            case 'Team Members':
                return 'db-SideNav-icon--customers';
            case 'Status Pages':
                return 'db-SideNav-icon--radar';
            case 'On-Call Duty':
                return 'db-SideNav-icon--call';
            case 'Incidents':
                return 'db-SideNav-icon--info';
            case 'Schedule Events':
                return 'db-SideNav-icon--connect';
            case 'Error Trackers':
                return 'db-SideNav-icon--errorTracking';
            case 'Log Containers':
                return 'db-SideNav-icon--appLog';
            case 'Performance Tracker':
                return 'db-SideNav-icon--performanceTracker';
            case 'Home':
                return 'db-SideNav-icon--home';
            case 'Report':
                return 'db-SideNav-icon--report';
            case 'Back':
                return 'db-SideNav-icon--back';
            case 'Security':
                return 'db-SideNav-icon--security';
            case 'businessSettings':
                return 'db-SideNav-icon--businessSettings';
            case 'consulting':
                return 'db-SideNav-icon--consulting';
            case 'email':
                return 'db-SideNav-icon--email';
            case 'sms':
                return 'db-SideNav-icon--sms';
            case 'callrouting':
                return 'db-SideNav-icon--callrouting';
            case 'integration':
                return 'db-SideNav-icon--integration';
            case 'probes':
                return 'db-SideNav-icon--probes';
            case 'git':
                return 'db-SideNav-icon--git';
            case 'docker':
                return 'db-SideNav-icon--docker';
            case 'apis':
                return 'db-SideNav-icon--apis';
            case 'user':
                return 'db-SideNav-icon--user';
            case 'password':
                return 'db-SideNav-icon--password';
            case 'play':
                return 'db-SideNav-icon--play';
            case 'receipt':
                return 'db-SideNav-icon--receipt';
            default:
                return '';
        }
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searcResult' does not exist on type 'Rea... Remove this comment to see the full error message
        const searchObj = this.props.searcResult;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'searchValues' does not exist on type 'Re... Remove this comment to see the full error message
        const searchValues = this.props.searchValues;
        return <>
            <Field
                className="db-BusinessSettings-input TextInput bs-TextInput search-input2 bs-padding-l-30"
                style={{
                    height: '100%',
                    width: '100%',
                    marginLeft: 'auto',
                    marginRight: 'auto',
                    paddingLeft: '40px',
                    backgroundColor: 'rgba(0, 21, 41, 0.97)',
                    borderRadius: 'inherit',
                    fontSize: '20px',
                }}
                component={RenderSearchField}
                type="text"
                name="search"
                id="search"
                iconLeftStyle={{
                    width: '25px',
                    bottom: '15px',
                }}
                placeholder="Search"
                autofilled={'off'}
                parentStyle={{
                    boxShadow:
                        '0 2px 5px 0 rgb(50 50 93 / 10%), 0 1px 1px 0 rgb(0 0 0 / 7%)',
                    height: '100%',
                    borderRadius: 'inherit',
                }}
                onChange={(e: $TSFixMe, newValue: $TSFixMe) => this.handleSearch(newValue)}
                iconLeft={true}
            />
            <div
                className="search-list-li"
                style={{
                    maxHeight: '30rem',
                    overflowY: 'auto',
                    boxShadow:
                        '0 2px 5px 0 rgb(50 50 93 / 10%), 0 1px 1px 0 rgb(0 0 0 / 7%)',
                }}
                ref={this.containerRef}
            >
                <ul
                    style={{
                        backgroundColor: '#fff',
                        boxShadow: '0 2px 15px rgb(84 96 103 / 25%)',
                        borderRadius: '4px',
                    }}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeSearchBar' does not exist on type '... Remove this comment to see the full error message
                    onClick={this.props.closeSearchBar}
                >
                    {searchValues &&
                        searchValues.search &&
                        searchObj.length > 0 &&
                        searchObj.map((result: $TSFixMe, j: $TSFixMe) => (
                            <>
                                <h3
                                    style={{
                                        paddingLeft: '10px',
                                        paddingTop: '7px',
                                    }}
                                    key={result.title}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <div
                                            className={`${this.categoryIconClassName(
                                                result.title
                                            )} db-SideNav-icon`}
                                        ></div>
                                        <span
                                            style={{
                                                paddingLeft: '10px',
                                            }}
                                        >
                                            {result.title}
                                        </span>
                                    </div>
                                </h3>
                                {result.values.map((val: $TSFixMe, i: $TSFixMe) => {
                                    return (
                                        <li
                                            key={val.name + i}
                                            style={{
                                                padding: '5px 10px',

                                                background:
                                                    this.state.scroll ===
                                                        i &&
                                                    j ===
                                                        this.state
                                                            .sectionActive
                                                        ? '#eee'
                                                        : '',
                                            }}
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                                            tabIndex="-1"
                                            ref={
                                                this.state.scroll === i &&
                                                j ===
                                                    this.state.sectionActive
                                                    ? this.activeRef
                                                    : null
                                            }
                                            onClick={() =>
                                                this.handleSearchClick(j, i)
                                            }
                                        >
                                            {result.title ===
                                            'Team Members' ? (
                                                <span>
                                                    <img
                                                        src="/dashboard/assets/img/profile-user.svg"
                                                        className="userIcon"
                                                        alt=""
                                                    />
                                                </span>
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProject' does not exist on type 'Read... Remove this comment to see the full error message
                                            ) : this.props.subProject
                                                  .count > 0 ? (
                                                <Badge
                                                    color={
                                                        val.parentProject
                                                            ? 'red Badge-border-radius'
                                                            : 'blue Badge-border-radius'
                                                    }
                                                >
                                                    {val.parentProject
                                                        ? 'project'
                                                        : val.projectName}
                                                </Badge>
                                            ) : null}
                                            <span
                                                style={{
                                                    paddingLeft:
                                                        result.title ===
                                                            'Team Members' ||
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProject' does not exist on type 'Read... Remove this comment to see the full error message
                                                            .subProject
                                                            .count === 0
                                                            ? '0'
                                                            : '10px',
                                                }}
                                            >
                                                {val.name}
                                            </span>
                                        </li>
                                    );
                                })}
                                <div
                                    style={{
                                        backgroundColor: '#dbdbdb',
                                        width: '100%',
                                        height: '1px',
                                        marginTop: '8px',
                                    }}
                                ></div>
                            </>
                        ))}
                </ul>
            </div>
        </>;
    }
}
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Search.displayName = 'Search';

const SearchBox = new reduxForm({
    form: 'search',
    enableReinitialize: true,
})(Search);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Search.propTypes = {
    searcResult: PropTypes.array,
    searchValues: PropTypes.object,
    addCurrentComponent: PropTypes.func,
    animateSidebar: PropTypes.func,
    componentList: PropTypes.object,
    resetSearch: PropTypes.func,
    search: PropTypes.func,
    currentProject: PropTypes.object,
    switchStatusPage: PropTypes.func,
    addScheduleEvent: PropTypes.func,
    fetchMonitors: PropTypes.func,
    markAsRead: PropTypes.func,
    addIncident: PropTypes.func,
    fetchMonitorsIncidents: PropTypes.func,
    getMonitorLogs: PropTypes.func,
    fetchLighthouseLogs: PropTypes.func,
    getProbes: PropTypes.func,
    fetchCommunicationSlas: PropTypes.func,
    fetchMonitorSlas: PropTypes.func,
    addPerformanceTracker: PropTypes.func,
    subProject: PropTypes.object,
    closeSearchBar: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            addCurrentComponent,
            animateSidebar,
            resetSearch,
            search,
            fetchMonitors,
            switchStatusPage,
            addScheduleEvent,
            markAsRead,
            addIncident,
            fetchMonitorsIncidents,
            fetchMonitorsSubscribers,
            getMonitorLogs,
            fetchLighthouseLogs,
            getProbes,
            fetchCommunicationSlas,
            fetchMonitorSlas,
            addPerformanceTracker,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    const searcResult = state.search.search;
    const subProject = state.subProject.subProjects;
    return {
        initialValues: { search: '' },
        searcResult,
        searchValues: state.form.search && state.form.search.values,
        currentProject: state.project.currentProject,
        componentList: state.component.componentList,
        subProject,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(SearchBox);
