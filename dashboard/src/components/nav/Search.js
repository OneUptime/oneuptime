import React, { Component, createRef } from 'react';
import { bindActionCreators } from 'redux';
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
    constructor() {
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
    generateUrlLink(searchObj) {
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

    switchStatusPages = (searchObj, path) => {
        this.props.switchStatusPage(searchObj);
        history.push(path);
    };
    loadComponent = (currentProject, searchObj) => {
        history.push(
            '/dashboard/project/' + currentProject.slug + '/' + searchObj.url
        );
    };
    loadMonitor = async (currentProject, searchObj) => {
        history.push(this.generateUrlLink(searchObj));
        //fetch monitor resources as this does not load on search
        const monitor = searchObj;
        await this.props.fetchMonitors(currentProject._id);
        this.props.getProbes(monitor.projectId, 0, 10); //
        if (monitor.type === 'url') {
            this.props.fetchLighthouseLogs(
                monitor.projectId,
                monitor.monitorId,
                0,
                1,
                monitor.data.url
            );
            this.props.fetchLighthouseLogs(
                monitor.projectId,
                monitor.monitorId,
                0,
                5
            ); //0 -> skip, 10-> limit.
        }
        this.props.fetchMonitorsIncidents(
            monitor.projectId,
            monitor.monitorId,
            0,
            10
        ); //0 -> skip, 5-> limit.

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

        this.props.fetchMonitorSlas(monitor.projectId);
        this.props.fetchCommunicationSlas(monitor.projectId);
    };

    loadIncident = (currentProject, searchObj) => {
        setTimeout(() => {
            history.push(
                '/dashboard/project/' +
                    currentProject.slug +
                    '/incidents/' +
                    searchObj.incidentSlug
            );
            this.props.addIncident(searchObj.incident);
            this.props.animateSidebar(false);
        }, 200);
        const notifications = [{ notificationId: searchObj.notificationId }];
        this.props.markAsRead(this.props.currentProject._id, notifications);
        this.props.animateSidebar(true);
    };
    loadErrorTracker = (currentProject, searchObj) => {
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/component/' +
                searchObj.componentSlug +
                '/error-trackers/' +
                searchObj.errorTrackerSlug
        );
    };
    loadLogContainer = (currentProject, searchObj) => {
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/component/' +
                searchObj.componentSlug +
                '/application-logs/' +
                searchObj.logContainerSlug
        );
    };

    loadPerformanceTracker = (currentProject, searchObj) => {
        history.push(
            `/dashboard/project/${currentProject.slug}/component/${searchObj.componentSlug}/performance-tracker/${searchObj.performanceTrackerSlug}`
        );
        this.props.addPerformanceTracker(searchObj.performanceTracker);
    };

    navigate = (type, searchObj) => {
        const { currentProject, componentList } = this.props;
        let component, publicStatusPageUrl, path, userId;
        switch (type) {
            case 'Monitors':
            case 'Components':
                component =
                    componentList &&
                    componentList.components
                        .filter(
                            project => project._id === searchObj.projectId
                        )[0]
                        .components.filter(
                            component => component._id === searchObj.componentId
                        )[0];
                setTimeout(
                    () => {
                        type === 'Monitors'
                            ? this.loadMonitor(currentProject, searchObj)
                            : this.loadComponent(currentProject, searchObj);

                        this.props.animateSidebar(false);
                    },
                    type === 'Monitors' ? 500 : 200
                );
                this.props.animateSidebar(true);
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
            this.props.searcResult.length > 0 &&
            this.props.searchValues &&
            this.props.searchValues.search !== ''
        ) {
            const searchObj = this.props.searcResult[this.state.sectionActive]
                .values[this.state.scroll];
            const type = this.props.searcResult[this.state.sectionActive].title;
            this.navigate(type, searchObj);
            this.handleBlur();
        }
    };
    handleSearchClick = (sectionActive, scroll) => {
        const searchObj = this.props.searcResult[sectionActive].values[scroll];
        const type = this.props.searcResult[sectionActive].title;
        this.navigate(type, searchObj);
        this.handleBlur();
    };
    handleKeyBoardScroll = e => {
        switch (e.key) {
            case 'ArrowUp':
                return this.ArrowUp();
            case 'ArrowDown':
                return this.ArrowDown();
            case 'Enter':
                return this.handleEnter();
            case 'Escape':
                return this.props.resetSearch();
            default:
                return false;
        }
    };
    handleBlur = () => {
        this.props.resetSearch();
    };
    handleSearch = val => {
        if (val) {
            this.props.search(this.props.currentProject._id, { search: val });
        } else {
            this.setState({
                scroll: 0,
                sectionActive: 0,
            });
        }
    };
    categoryIconClassName = type => {
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
        const searchObj = this.props.searcResult;
        const searchValues = this.props.searchValues;
        return (
            <>
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
                    onChange={(e, newValue) => this.handleSearch(newValue)}
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
                        onClick={this.props.closeSearchBar}
                    >
                        {searchValues &&
                            searchValues.search &&
                            searchObj.length > 0 &&
                            searchObj.map((result, j) => (
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
                                    {result.values.map((val, i) => {
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
            </>
        );
    }
}
Search.displayName = 'Search';

const SearchBox = new reduxForm({
    form: 'search',
    enableReinitialize: true,
})(Search);

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

const mapDispatchToProps = dispatch => {
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

function mapStateToProps(state) {
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
