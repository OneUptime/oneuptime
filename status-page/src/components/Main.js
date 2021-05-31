import React, { Component } from 'react';
import PropTypes from 'prop-types';
import UptimeLegend from './UptimeLegend';
import NoMonitor from './NoMonitor';
import MonitorInfo from './MonitorInfo';
import ShouldRender from './ShouldRender';
import Footer from './Footer';
import NotesMain from './NotesMain';
import EventsMain from './EventsMain';
import {
    API_URL,
    ACCOUNTS_URL,
    getServiceStatus,
    filterProbeData,
    getMonitorStatus,
} from '../config';
import moment from 'moment';
import { Helmet } from 'react-helmet';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    getStatusPage,
    selectedProbe,
    getScheduledEvent,
    getOngoingScheduledEvent,
} from '../actions/status';
import { getProbes } from '../actions/probe';
import LineChartsContainer from './LineChartsContainer';
import NewThemeEvent from './NewThemeEvent';
import NewThemeSubscriber from './NewThemeSubscriber';
import Announcement from './Announcement';
import AnnouncementLogs from './AnnouncementLogs';
import PastEvent from './PastEvent';
import { fetchFutureEvents, fetchPastEvents } from '../actions/status';
import OngoingSchedule from './OngoingSchedule';
import Collapsible from './Collapsible/Collapsible';

const greenBackground = {
    display: 'inline-block',
    borderRadius: '100px',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(117, 211, 128)',
};
const yellowBackground = {
    display: 'inline-block',
    borderRadius: '100px',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(255, 222, 36)',
};
const redBackground = {
    display: 'inline-block',
    borderRadius: '100px',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(250, 117, 90)',
};
const greyBackground = {
    display: 'inline-block',
    borderRadius: '100px',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgba(107, 124, 147, 0.2)',
};

class Main extends Component {
    constructor(props) {
        super(props);

        this.state = {
            now: Date.now(),
            nowHandler: null,
        };
    }

    componentDidUpdate(prevProps) {
        const fetchData = (skip = 0, theme = false, limit = 5) => {
            this.props.getOngoingScheduledEvent(
                this.props.statusData.projectId._id,
                this.props.statusData.slug,
                skip,
                theme,
                limit
            );
            this.props.fetchFutureEvents(
                this.props.statusData.projectId._id,
                this.props.statusData.slug,
                skip,
                theme,
                limit
            );
            this.props.fetchPastEvents(
                this.props.statusData.slug,
                this.props.statusData.slug,
                skip,
                theme,
                limit
            );
        };
        if (prevProps.probes !== this.props.probes) {
            if (this.state.nowHandler) {
                clearTimeout(this.state.nowHandler);
            }

            this.setLastAlive();
        }
        if (prevProps.statusData !== this.props.statusData) {
            this.props.getProbes(this.props.statusData._id, 0, 10).then(() => {
                this.selectbutton(this.props.activeProbe);
            });
        }
        if (
            prevProps.statusData.customJS !== this.props.statusData.customJS &&
            this.props.statusData.customJS
        ) {
            const javascript = document
                .createRange()
                .createContextualFragment(this.props.statusData.customJS);
            document.body.appendChild(javascript);
        }
        if (
            prevProps.statusData.projectId !== this.props.statusData.projectId
        ) {
            if (this.props.statusData.theme === 'Clean Theme') {
                fetchData(0, true, this.props.scheduleHistoryDays || 14);
            }
            if (this.props.statusData.theme === 'Classic Theme') {
                fetchData(0, false, 5);
            }
        }
    }

    setLastAlive = () => {
        this.setState({ now: Date.now() });

        const nowHandler = setTimeout(() => {
            this.setState({ now: Date.now() });
        }, 300000);

        this.setState({ nowHandler });
    };

    componentDidMount() {
        if (
            window.location.search.substring(1) &&
            window.location.search.substring(1) === 'embedded=true'
        ) {
            document.getElementsByTagName('html')[0].style.background =
                'none transparent';
        }

        let statusPageSlug, url;

        if (
            window.location.pathname.includes('/status-page/') &&
            window.location.pathname.split('/').length >= 3
        ) {
            statusPageSlug = window.location.pathname.split('/')[2];
            url = 'null';
        } else if (
            window.location.href.indexOf('localhost') > -1 ||
            window.location.href.indexOf('fyipeapp.com') > 0
        ) {
            statusPageSlug = window.location.host.split('.')[0];
            url = 'null';
        } else {
            statusPageSlug = 'null';
            url = window.location.host;
        }
        if (this.props.statusData._id) {
            this.props.getProbes(this.props.statusData._id, 0, 10).then(() => {
                this.selectbutton(this.props.activeProbe);
            });
        }

        this.props.getStatusPage(statusPageSlug, url).catch(err => {
            if (err.message === 'Request failed with status code 401') {
                const { loginRequired } = this.props.login;
                if (loginRequired) {
                    window.location = `${ACCOUNTS_URL}/login?statusPage=true&statusPageURL=${window.location.href}`;
                }
            }
        });

        this.setLastAlive();
    }

    getCategories(collection, property) {
        const collectionArray = [];
        collection.forEach(monitor => {
            if (
                monitor[property] &&
                collectionArray.indexOf(monitor[property].name) === -1
            ) {
                collectionArray.push(monitor[property].name);
            }
        });
        return collectionArray;
    }

    groupedMonitors = () => {
        if (
            this.props.statusData &&
            this.props.statusData.monitorsData !== undefined &&
            this.props.statusData.monitorsData.length > 0
        ) {
            const monitorData = this.props.statusData.monitorsData;
            const resourceCategories = this.getCategories(
                monitorData,
                'resourceCategory'
            );
            const uncategorized = monitorData.filter(
                mon =>
                    mon.resourceCategory === undefined || !mon.resourceCategory
            );

            return (
                <div
                    className="uptime-graph-header"
                    style={{ flexDirection: 'column' }}
                >
                    {resourceCategories.map(categoryName => {
                        const filteredResource = monitorData.filter(
                            resource =>
                                resource.resourceCategory &&
                                resource.resourceCategory.name === categoryName
                        );

                        return this.CollapsableGroup(
                            categoryName,
                            filteredResource
                        );
                    })}
                    {uncategorized &&
                        uncategorized.length > 0 &&
                        this.CollapsableGroup('Uncategorized', uncategorized)}
                </div>
            );
        } else {
            return <NoMonitor />;
        }
    };

    CollapsableGroup = (categoryName, monitors) => {
        const { probes, activeProbe, statusData } = this.props;
        const theme = statusData.theme === 'Clean Theme' ? true : false;

        const categoryStatuses = monitors.map(monitor => {
            const probe =
                probes && probes.length > 0
                    ? probes[probes.length < 2 ? 0 : activeProbe]
                    : null;
            const statuses = filterProbeData(monitor, probe);
            const monitorStatus = getMonitorStatus(statuses);
            return monitorStatus;
        });

        const categoryStatusBk = categoryStatuses.includes('offline')
            ? 'rgba(250, 109, 70, 1)'
            : categoryStatuses.includes('degraded')
            ? 'rgba(255, 222, 36, 1)'
            : 'rgba(108, 219, 86, 1)';

        const collapsibleStyle = {
            backgroundColor: 'rgb(246 246 246)',
            width: '100%',
            padding: '7px 10px',
            fontSize: ' 12px',
            fontWeight: '400',
            color: 'black',
            marginBottom: '0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            border: '1px solid rgb(236 236 236)',
        };

        if (!theme) {
            //if its a classic theme then, change some styles.
            collapsibleStyle.backgroundColor = 'rgb(247 247 247)';
            collapsibleStyle.border = '1px solid rgb(228 228 228)';
        }

        return (
            <Collapsible
                trigger={
                    categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
                }
                triggerStyle={collapsibleStyle}
                open={true}
                contentContainerTagName="div"
                triggerTagName="div"
                transitionTime="200"
                lazyRender={true}
                closedIconClass="sp__icon sp__icon--down"
                openIconClass="sp__icon sp__icon--up"
                statusColorStyle={{
                    borderRadius: ' 100px',
                    height: '8px',
                    width: '8px',
                    backgroundColor: categoryStatusBk,
                }}
            >
                {monitors.map((monitor, i) => {
                    return (
                        <>
                            <MonitorInfo
                                monitor={monitor}
                                selectedCharts={
                                    this.props.monitors.filter(
                                        m => monitor._id === m.monitor._id
                                    )[0]
                                }
                                key={i}
                                id={`monitor${i}`}
                                resourceCategory={monitor.resourceCategory}
                                isGroupedByMonitorCategory={false}
                                theme={
                                    this.props.statusData.theme ===
                                    'Clean Theme'
                                        ? true
                                        : false
                                }
                            />
                            {this.props.monitors.some(
                                m => monitor._id === m.monitor._id
                            ) && (
                                <LineChartsContainer
                                    monitor={monitor}
                                    selectedCharts={
                                        this.props.monitors.filter(
                                            m => monitor._id === m.monitor._id
                                        )[0]
                                    }
                                />
                            )}

                            {i < monitors.length - 1 ||
                            (i === monitors.length - 1 &&
                                categoryName.toLowerCase() ===
                                    'uncategorized' &&
                                !theme) ? (
                                <div
                                    style={{
                                        margin: '30px 0px',
                                        backgroundColor: 'rgb(232, 232, 232)',
                                        height: '1px',
                                    }}
                                />
                            ) : (i === monitors.length - 1 &&
                                  categoryName.toLowerCase() !==
                                      'uncategorized') ||
                              (i === monitors.length - 1 &&
                                  categoryName.toLowerCase() ===
                                      'uncategorized' &&
                                  theme) ? (
                                <div
                                    style={{
                                        marginBottom: '30px',
                                    }}
                                />
                            ) : null}
                        </>
                    );
                })}
            </Collapsible>
        );
    };

    selectbutton = index => {
        this.props.selectedProbe(index);
    };

    renderError = () => {
        const { error } = this.props.status;
        if (error === 'Input data schema mismatch.') {
            return 'Page Not Found';
        } else if (error === 'Project Not present') {
            return 'Invalid Project.';
        } else return error;
    };

    componentWillUnmount() {
        if (this.state.nowHandler) {
            clearTimeout(this.state.nowHandler);
        }
    }

    render() {
        const {
            headerHTML,
            footerHTML,
            customCSS,
            theme,
        } = this.props.statusData;
        const sanitizedCSS = customCSS ? customCSS.split('↵').join('') : '';
        const probes = this.props.probes;
        let view = false;
        let status = '';
        let newbg = '';
        let serviceStatus = '';
        let statusMessage = '',
            newStatusMessage = '';
        let faviconurl = '';
        let isGroupedByMonitorCategory = false;
        const error = this.renderError();
        let heading,
            backgroundMain,
            contentBackground,
            secondaryText,
            primaryText,
            downtimeColor,
            uptimeColor,
            degradedColor,
            disabledColor,
            disabled,
            noteBackgroundColor;
        let statusBackground;
        if (this.props.statusData && this.props.statusData.monitorsData) {
            serviceStatus = getServiceStatus(this.props.monitorState, probes);
            isGroupedByMonitorCategory = this.props.statusData
                .isGroupedByMonitorCategory;
            const colors = this.props.statusData.colors;
            const disabledMonitors =
                this.props.monitorState &&
                this.props.monitorState.filter(m => m.disabled);
            disabled =
                disabledMonitors && disabledMonitors.length ? true : false;

            view = true;

            heading = {
                color: `rgba(${colors.heading.r}, ${colors.heading.g}, ${colors.heading.b}, ${colors.heading.a})`,
            };

            secondaryText = {
                color: `rgba(${colors.secondaryText.r}, ${colors.secondaryText.g}, ${colors.secondaryText.b}, ${colors.secondaryText.a})`,
            };

            primaryText = {
                color: `rgba(${colors.primaryText.r}, ${colors.primaryText.g}, ${colors.primaryText.b}, ${colors.primaryText.a})`,
            };

            downtimeColor = {
                backgroundColor: `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b}, ${colors.downtime.a})`,
            };

            uptimeColor = {
                backgroundColor: `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b}, ${colors.uptime.a})`,
            };

            degradedColor = {
                backgroundColor: `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b}, ${colors.degraded.a})`,
            };

            if (colors.disabled) {
                disabledColor = {
                    backgroundColor: `rgba(${colors.disabled.r}, ${colors.disabled.g}, ${colors.disabled.b}, ${colors.disabled.a})`,
                };
            } else {
                disabledColor = {
                    backgroundColor: `rgba(201, 201, 201, 1)`,
                };
            }

            if (serviceStatus === 'all') {
                status = 'status-bubble status-up';
                statusMessage = 'All services are online';
                faviconurl = '/status-page/greenfavicon.ico';
                newStatusMessage = 'All resources are operational';
                newbg =
                    uptimeColor.backgroundColor === 'rgba(108, 219, 86, 1)'
                        ? '#49c3b1'
                        : uptimeColor.backgroundColor;
            } else if (serviceStatus === 'some') {
                status = 'status-bubble status-down';
                statusMessage = 'Some services are offline';
                faviconurl = '/status-page/redfavicon.ico';
                newStatusMessage = 'Some resources are offline';
                newbg =
                    downtimeColor.backgroundColor === 'rgba(250, 109, 70, 1)'
                        ? '#FA6D46'
                        : downtimeColor.backgroundColor;
            } else if (serviceStatus === 'none') {
                status = 'status-bubble status-down';
                statusMessage = 'All services are offline';
                faviconurl = '/status-page/redfavicon.ico';
                newStatusMessage = 'All resources are offline';
                newbg =
                    downtimeColor.backgroundColor === 'rgba(250, 109, 70, 1)'
                        ? '#FA6D46'
                        : downtimeColor.backgroundColor;
            } else if (serviceStatus === 'some-degraded') {
                status = 'status-bubble status-paused';
                statusMessage = 'Some services are degraded';
                faviconurl = '/status-page/yellowfavicon.ico';
                newStatusMessage = 'Some resources are degraded';
                newbg =
                    degradedColor.backgroundColor === 'rgba(255, 222, 36, 1)'
                        ? '#e39f48'
                        : degradedColor.backgroundColor;
            }

            if (this.props.ongoing && this.props.ongoing.length > 0) {
                statusBackground = degradedColor;
            } else if (serviceStatus === 'all') {
                statusBackground = uptimeColor;
            } else if (serviceStatus === 'some' || serviceStatus === 'none') {
                statusBackground = downtimeColor;
            } else if (serviceStatus === 'some-degraded') {
                statusBackground = degradedColor;
            }

            backgroundMain = {
                background: `rgba(${colors.pageBackground.r}, ${colors.pageBackground.g}, ${colors.pageBackground.b}, ${colors.pageBackground.a})`,
            };

            contentBackground = {
                background: `rgba(${colors.statusPageBackground.r}, ${colors.statusPageBackground.g}, ${colors.statusPageBackground.b}, ${colors.statusPageBackground.a})`,
            };

            noteBackgroundColor = {
                background: `rgba(${colors.noteBackground.r}, ${colors.noteBackground.g}, ${colors.noteBackground.b}, ${colors.noteBackground.a})`,
            };
        }

        const {
            enableRSSFeed,
            smsNotification,
            webhookNotification,
            emailNotification,
        } = this.props.statusPage;
        const showSubscriberOption =
            enableRSSFeed ||
            smsNotification ||
            webhookNotification ||
            emailNotification;

        const availableMonitors = this.props.statusData.monitors;

        const defaultLayout = {
            visible: [
                { name: 'Header', key: 'header' },
                {
                    name: 'Active Announcement',
                    key: 'anouncement',
                },
                {
                    name: 'Ongoing Scheduled Events',
                    key: 'ongoingSchedule',
                },
                { name: 'Overall Status of Resources', key: 'resources' },
                { name: 'Resource List', key: 'services' },
                { name: 'Incidents List', key: 'incidents' },
                { name: 'Past Announcements List', key: 'AnnouncementLogs' },
                { name: 'Future Scheduled Events', key: 'maintenance' },
                { name: 'Footer', key: 'footer' },
            ],
            invisible: [
                { name: 'Scheduled Events Completed', key: 'pastEvents' },
            ],
        };

        let visibleLayout =
            this.props.statusData && this.props.statusData.layout;
        //check if the layout has been set if not fall back to the default layout
        if (!visibleLayout) {
            visibleLayout = defaultLayout;
        }

        const layoutObj = {
            header: (
                <>
                    <HelemtCard
                        statusData={this.props.statusData}
                        faviconurl={faviconurl}
                    />
                    <ShouldRender
                        if={
                            this.props.statusData &&
                            this.props.statusData.logoPath
                        }
                    >
                        <div className="logo_section pad-left">
                            <span>
                                <img
                                    src={`${API_URL}/file/${this.props.statusData.logoPath}`}
                                    alt=""
                                    className="logo"
                                />
                            </span>
                        </div>
                    </ShouldRender>
                    <ShouldRender if={headerHTML}>
                        <React.Fragment>
                            <style>{sanitizedCSS}</style>
                            <div className="logo_section">
                                <div
                                    id="customHeaderHTML"
                                    dangerouslySetInnerHTML={{
                                        __html: headerHTML,
                                    }}
                                />
                            </div>
                        </React.Fragment>
                    </ShouldRender>
                    {this.props.statusData &&
                    this.props.statusData.bannerPath ? (
                        <div className="banner-container">
                            <div className="page-main-wrapper">
                                <span>
                                    <img
                                        src={`${API_URL}/file/${this.props.statusData.bannerPath}`}
                                        alt=""
                                        className="banner"
                                    />
                                </span>
                            </div>
                        </div>
                    ) : (
                        ''
                    )}
                    <ShouldRender
                        if={
                            this.props.statusData.title ||
                            (this.props.isSubscriberEnabled === true &&
                                showSubscriberOption)
                        }
                    >
                        <div className="subscribe_box">
                            <div>
                                <span
                                    style={{
                                        fontWeight: 'bold',
                                    }}
                                >
                                    {this.props.statusData.title}
                                </span>
                                <ShouldRender
                                    if={this.props.statusData.description}
                                >
                                    <div className="bs-page_desc">
                                        {this.props.statusData.description}
                                    </div>
                                </ShouldRender>
                            </div>
                            <ShouldRender
                                if={
                                    this.props.isSubscriberEnabled === true &&
                                    showSubscriberOption
                                }
                            >
                                <NewThemeSubscriber />
                            </ShouldRender>
                        </div>
                    </ShouldRender>
                </>
            ),

            ongoingSchedule: (
                <OngoingSchedule
                    monitorState={this.props.monitorState}
                    ongoing={this.props.ongoing}
                    history={this.props.history}
                    statusData={this.props.statusData}
                />
            ),

            resources: (
                <div
                    className="sy-op"
                    style={{
                        backgroundColor:
                            this.props.ongoing && this.props.ongoing.length > 0
                                ? 'rgb(227, 159, 72)'
                                : newbg,
                    }}
                    id="status-note"
                >
                    {this.props.ongoing && this.props.ongoing.length > 0
                        ? 'Ongoing Scheduled Maintenance Event'
                        : newStatusMessage}
                </div>
            ),
            services: (
                <>
                    <ShouldRender if={!this.props.statusData.hideProbeBar}>
                        <div className="bs-probes">
                            <Probes
                                probes={probes}
                                backgroundMain={backgroundMain}
                                contentBackground={contentBackground}
                                activeProbe={this.props.activeProbe}
                                monitorState={this.props.monitorState}
                                greenBackground={greenBackground}
                                uptimeColor={uptimeColor}
                                greyBackground={greyBackground}
                                serviceStatus={serviceStatus}
                                redBackground={redBackground}
                                downtimeColor={downtimeColor}
                                yellowBackground={yellowBackground}
                                degradedColor={degradedColor}
                                heading={heading}
                                now={this.state.now}
                                selectbutton={index => this.selectbutton(index)}
                                theme={theme}
                            />
                        </div>
                    </ShouldRender>
                    <ShouldRender
                        if={availableMonitors && availableMonitors.length > 0}
                    >
                        <div className="line-chart">
                            <div
                                className="uptime-graphs"
                                style={
                                    isGroupedByMonitorCategory
                                        ? { paddingBottom: 0 }
                                        : { paddingBottom: 35 }
                                }
                            >
                                {isGroupedByMonitorCategory ? (
                                    <div
                                        className="op-div"
                                        style={{
                                            borderTopWidth: '1px',
                                            ...contentBackground,
                                            padding: 0,
                                        }}
                                    >
                                        {this.groupedMonitors()}
                                    </div>
                                ) : this.props.statusData &&
                                  this.props.statusData.monitorsData !==
                                      undefined &&
                                  this.props.statusData.monitorsData.length >
                                      0 ? (
                                    this.props.monitors
                                        .filter(monitor =>
                                            this.props.statusData.monitorsData.some(
                                                m =>
                                                    m._id ===
                                                    monitor.monitor._id
                                            )
                                        )
                                        .map((monitor, i) => (
                                            <div
                                                className="op-div"
                                                style={{
                                                    borderTopWidth:
                                                        i === 0 && '1px',
                                                    ...contentBackground,
                                                }}
                                                key={i}
                                            >
                                                <MonitorInfo
                                                    monitor={
                                                        this.props.statusData.monitorsData.filter(
                                                            m =>
                                                                m._id ===
                                                                monitor.monitor
                                                                    ._id
                                                        )[0]
                                                    }
                                                    selectedCharts={monitor}
                                                    key={`uptime-${i}`}
                                                    id={`monitor${i}`}
                                                    isGroupedByMonitorCategory={
                                                        isGroupedByMonitorCategory
                                                    }
                                                    theme={'clean'}
                                                />
                                                <LineChartsContainer
                                                    monitor={
                                                        this.props.statusData.monitorsData.filter(
                                                            m =>
                                                                m._id ===
                                                                monitor.monitor
                                                                    ._id
                                                        )[0]
                                                    }
                                                    selectedCharts={monitor}
                                                    key={`line-charts-${i}`}
                                                />
                                            </div>
                                        ))
                                ) : (
                                    <NoMonitor />
                                )}
                            </div>
                        </div>
                    </ShouldRender>
                    <ShouldRender
                        if={availableMonitors && availableMonitors.length < 1}
                    >
                        <div
                            className="bs-no-monitor"
                            style={noteBackgroundColor}
                        >
                            No monitors added yet. Please, add a monitor.
                        </div>
                    </ShouldRender>
                </>
            ),
            incidents: (
                <div
                    className="new-theme-incident matop-40"
                    style={{
                        width: '100%',
                        ...contentBackground,
                    }}
                >
                    <div className="font-largest" style={heading}>
                        Incidents
                    </div>
                    <NotesMain
                        projectId={
                            this.props.statusData &&
                            this.props.statusData.projectId &&
                            this.props.statusData.projectId._id
                        }
                        statusPageId={this.props.statusData._id}
                        theme={theme}
                        statusPageSlug={this.props.statusData.slug}
                    />
                </div>
            ),
            maintenance: (
                <ShouldRender
                    if={
                        this.props.futureEvents &&
                        this.props.futureEvents.length > 0
                    }
                >
                    <div
                        className="new-theme-incident"
                        style={contentBackground}
                    >
                        <div className="font-largest" style={heading}>
                            Maintenance Events Scheduled
                        </div>
                        <NewThemeEvent
                            projectId={
                                this.props.statusData &&
                                this.props.statusData.projectId &&
                                this.props.statusData.projectId._id
                            }
                            statusPageId={this.props.statusData._id}
                            noteBackgroundColor={noteBackgroundColor}
                            type={'future'}
                        />
                    </div>
                </ShouldRender>
            ),
            pastEvents: (
                <ShouldRender
                    if={
                        this.props.pastEvents &&
                        this.props.pastEvents.length > 0
                    }
                >
                    <div
                        className="new-theme-incident"
                        style={contentBackground}
                    >
                        <div className="font-largest" style={heading}>
                            Scheduled Events Completed
                        </div>
                        <NewThemeEvent
                            projectId={
                                this.props.statusData &&
                                this.props.statusData.projectId &&
                                this.props.statusData.projectId._id
                            }
                            statusPageId={this.props.statusData._id}
                            noteBackgroundColor={noteBackgroundColor}
                            type={'past'}
                        />
                    </div>
                </ShouldRender>
            ),
            anouncement: (
                <Announcement
                    monitorState={this.props.monitorState}
                    theme={theme}
                    heading={heading}
                    {...this.props}
                />
            ),
            AnnouncementLogs: (
                <div>
                    <AnnouncementLogs
                        projectId={
                            this.props.statusData &&
                            this.props.statusData.projectId &&
                            this.props.statusData.projectId._id
                        }
                        statusPageId={this.props.statusData}
                        monitorState={this.props.monitorState}
                        theme={theme}
                    />
                </div>
            ),
            footer: (
                <div className="powered">
                    <FooterCard
                        footerHTML={footerHTML}
                        statusData={this.props.statusData}
                        primaryText={primaryText}
                        secondaryText={secondaryText}
                    />
                </div>
            ),
        };

        const theme2Obj = {
            anouncement: (
                <Announcement
                    monitorState={this.props.monitorState}
                    theme={theme}
                    heading={heading}
                    {...this.props}
                />
            ),
            incidents: (
                <NotesMain
                    projectId={
                        this.props.statusData &&
                        this.props.statusData.projectId &&
                        this.props.statusData.projectId._id
                    }
                    statusPageId={this.props.statusData._id}
                    statusPageSlug={this.props.statusData.slug}
                />
            ),
            resources: (
                <>
                    <ShouldRender if={headerHTML}>
                        <React.Fragment>
                            <div
                                style={{
                                    top: -25,
                                    position: 'relative',
                                }}
                            >
                                <style>{sanitizedCSS}</style>
                                <div
                                    id="customHeaderHTML"
                                    dangerouslySetInnerHTML={{
                                        __html: headerHTML,
                                    }}
                                />
                            </div>
                        </React.Fragment>
                    </ShouldRender>

                    <div
                        className="white box"
                        style={{
                            ...contentBackground,
                            marginTop: '50px',
                        }}
                    >
                        <div className="largestatus">
                            <span
                                className={status}
                                style={{
                                    ...statusBackground,
                                    width: '30px',
                                    height: '30px',
                                }}
                            ></span>
                            <div className="title-wrapper">
                                <span className="title" style={heading}>
                                    {this.props.ongoing &&
                                    this.props.ongoing.length > 0
                                        ? 'Ongoing Scheduled Maintenance Event'
                                        : statusMessage}
                                </span>
                                <label
                                    className="status-time"
                                    style={secondaryText}
                                >
                                    As of{' '}
                                    <span className="current-time">
                                        {moment(new Date()).format('LLLL')}
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </>
            ),
            services: (
                <>
                    <div
                        className="content"
                        style={{
                            position: 'relative',
                            marginTop: '50px',
                        }}
                    >
                        <div
                            className="white box"
                            style={{
                                ...contentBackground,
                            }}
                        >
                            <ShouldRender
                                if={!this.props.statusData.hideProbeBar}
                            >
                                <Probes
                                    probes={probes}
                                    backgroundMain={backgroundMain}
                                    contentBackground={contentBackground}
                                    activeProbe={this.props.activeProbe}
                                    monitorState={this.props.monitorState}
                                    greenBackground={greenBackground}
                                    uptimeColor={uptimeColor}
                                    greyBackground={greyBackground}
                                    serviceStatus={serviceStatus}
                                    redBackground={redBackground}
                                    downtimeColor={downtimeColor}
                                    yellowBackground={yellowBackground}
                                    degradedColor={degradedColor}
                                    heading={heading}
                                    now={this.state.now}
                                    selectbutton={index =>
                                        this.selectbutton(index)
                                    }
                                />
                            </ShouldRender>

                            <div
                                className="statistics"
                                style={contentBackground}
                            >
                                <div className="inner-gradient"></div>
                                <div
                                    className="uptime-graphs box-inner"
                                    style={
                                        isGroupedByMonitorCategory
                                            ? { padding: 0 }
                                            : { paddingBottom: 35 }
                                    }
                                >
                                    {isGroupedByMonitorCategory ? (
                                        this.groupedMonitors()
                                    ) : this.props.statusData &&
                                      this.props.statusData.monitorsData !==
                                          undefined &&
                                      this.props.statusData.monitorsData
                                          .length > 0 ? (
                                        this.props.monitors
                                            .filter(monitor =>
                                                this.props.statusData.monitorsData.some(
                                                    m =>
                                                        m._id ===
                                                        monitor.monitor._id
                                                )
                                            )
                                            .map((monitor, i) => (
                                                <>
                                                    <MonitorInfo
                                                        monitor={
                                                            this.props.statusData.monitorsData.filter(
                                                                m =>
                                                                    m._id ===
                                                                    monitor
                                                                        .monitor
                                                                        ._id
                                                            )[0]
                                                        }
                                                        selectedCharts={monitor}
                                                        key={`uptime-${i}`}
                                                        id={`monitor${i}`}
                                                        isGroupedByMonitorCategory={
                                                            isGroupedByMonitorCategory
                                                        }
                                                    />
                                                    <LineChartsContainer
                                                        monitor={
                                                            this.props.statusData.monitorsData.filter(
                                                                m =>
                                                                    m._id ===
                                                                    monitor
                                                                        .monitor
                                                                        ._id
                                                            )[0]
                                                        }
                                                        selectedCharts={monitor}
                                                        key={`line-charts-${i}`}
                                                    />
                                                    {i <
                                                        this.props.statusData
                                                            .monitorsData
                                                            .length -
                                                            1 && (
                                                        <div
                                                            style={{
                                                                margin:
                                                                    '30px 0px',
                                                                backgroundColor:
                                                                    '#e8e8e8',
                                                                height: '1px',
                                                            }}
                                                        />
                                                    )}
                                                </>
                                            ))
                                    ) : (
                                        <NoMonitor />
                                    )}
                                </div>
                                {this.props.statusData &&
                                this.props.statusData.monitorsData !==
                                    undefined &&
                                this.props.statusData.monitorsData.length >
                                    0 ? (
                                    <UptimeLegend
                                        background={contentBackground}
                                        secondaryTextColor={secondaryText}
                                        downtimeColor={downtimeColor}
                                        uptimeColor={uptimeColor}
                                        degradedColor={degradedColor}
                                        disabledColor={disabledColor}
                                        disabled={disabled}
                                    />
                                ) : (
                                    ''
                                )}
                            </div>
                        </div>
                    </div>
                    <HelemtCard
                        statusData={this.props.statusData}
                        faviconurl={faviconurl}
                    />
                </>
            ),
            ongoingSchedule: (
                <OngoingSchedule
                    monitorState={this.props.monitorState}
                    ongoing={this.props.ongoing}
                    history={this.props.history}
                    statusData={this.props.statusData}
                />
            ),
            maintenance: (
                <ShouldRender
                    if={
                        this.props.statusData &&
                        this.props.statusData.projectId &&
                        this.props.statusData._id
                    }
                >
                    <ShouldRender
                        if={this.props.statusData.showScheduledEvents}
                    >
                        <EventsMain
                            projectId={
                                this.props.statusData &&
                                this.props.statusData.projectId &&
                                this.props.statusData.projectId._id
                            }
                            statusPageId={this.props.statusData._id}
                            statusPageSlug={this.props.statusData.slug}
                            type={'future'}
                        />
                    </ShouldRender>
                </ShouldRender>
            ),
            pastEvents: (
                <ShouldRender
                    if={
                        this.props.statusData &&
                        this.props.statusData.projectId &&
                        this.props.statusData._id
                    }
                >
                    <ShouldRender
                        if={this.props.statusData.showScheduledEvents}
                    >
                        <PastEvent
                            projectId={
                                this.props.statusData &&
                                this.props.statusData.projectId &&
                                this.props.statusData.projectId._id
                            }
                            statusPageId={this.props.statusData._id}
                            statusPageSlug={this.props.statusData.slug}
                            type={'past'}
                        />
                    </ShouldRender>
                </ShouldRender>
            ),
            AnnouncementLogs: (
                <div>
                    <AnnouncementLogs
                        projectId={
                            this.props.statusData &&
                            this.props.statusData.projectId &&
                            this.props.statusData.projectId._id
                        }
                        statusPageId={this.props.statusData}
                        monitorState={this.props.monitorState}
                    />
                </div>
            ),
            header:
                this.props.statusData && this.props.statusData.bannerPath ? (
                    <div>
                        <span>
                            <img
                                src={`${API_URL}/file/${this.props.statusData.bannerPath}`}
                                alt=""
                                className="banner"
                            />
                        </span>
                        <ShouldRender
                            if={
                                this.props.statusData &&
                                this.props.statusData.logoPath
                            }
                        >
                            <div className="log-container">
                                <div>
                                    <span>
                                        <img
                                            src={`${API_URL}/file/${this.props.statusData.logoPath}`}
                                            alt=""
                                            className="logo"
                                        />
                                    </span>
                                </div>
                            </div>
                        </ShouldRender>
                    </div>
                ) : (
                    ''
                ),
            footer: (
                <FooterCard
                    footerHTML={footerHTML}
                    statusData={this.props.statusData}
                    primaryText={primaryText}
                    secondaryText={secondaryText}
                />
            ),
        };

        return (
            <>
                {theme === 'Clean Theme' ? (
                    <>
                        <div
                            className="new-theme"
                            style={
                                backgroundMain.background ===
                                'rgba(247, 247, 247, 1)'
                                    ? { background: 'rgba(255, 255, 255, 1)' }
                                    : backgroundMain
                            }
                        >
                            {visibleLayout &&
                                visibleLayout.visible.map(layout => {
                                    if (layout.key === 'header') {
                                        return (
                                            <div key={layout.key}>
                                                {layoutObj[layout.key]}
                                            </div>
                                        );
                                    } else {
                                        return (
                                            <div
                                                key={layout.key}
                                                className="new-main-container"
                                            >
                                                {layoutObj[layout.key]}
                                            </div>
                                        );
                                    }
                                })}
                        </div>
                    </>
                ) : (
                    <div className="page-main-wrapper" style={backgroundMain}>
                        {view ? (
                            <>
                                {visibleLayout &&
                                    visibleLayout.visible.map(layout => {
                                        if (layout.key === 'header') {
                                            return <>{theme2Obj[layout.key]}</>;
                                        } else {
                                            return (
                                                <div
                                                    key={layout.key}
                                                    className="innernew"
                                                >
                                                    {theme2Obj[layout.key]}
                                                </div>
                                            );
                                        }
                                    })}
                            </>
                        ) : (
                            <div
                                id="app-loading"
                                style={{
                                    position: 'fixed',
                                    top: '0',
                                    bottom: '0',
                                    left: '0',
                                    right: '0',
                                    backgroundColor: '#fdfdfd',
                                    zIndex: '999',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                }}
                            >
                                <div style={{ transform: 'scale(2)' }}>
                                    <svg
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="bs-Spinner-svg"
                                    >
                                        <ellipse
                                            cx="12"
                                            cy="12"
                                            rx="10"
                                            ry="10"
                                            className="bs-Spinner-ellipse"
                                        ></ellipse>
                                    </svg>
                                </div>
                            </div>
                        )}

                        <ShouldRender
                            if={
                                this.props.status &&
                                (this.props.status.requesting ||
                                    this.props.status.logs.some(
                                        log => log.requesting
                                    )) &&
                                this.props.requestingEvents
                            }
                        >
                            <div
                                id="app-loading"
                                style={{
                                    position: 'fixed',
                                    top: '0',
                                    bottom: '0',
                                    left: '0',
                                    right: '0',
                                    backgroundColor: '#fdfdfd',
                                    zIndex: '999',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                }}
                            >
                                <div style={{ transform: 'scale(2)' }}>
                                    <svg
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="bs-Spinner-svg"
                                    >
                                        <ellipse
                                            cx="12"
                                            cy="12"
                                            rx="10"
                                            ry="10"
                                            className="bs-Spinner-ellipse"
                                        ></ellipse>
                                    </svg>
                                </div>
                            </div>
                        </ShouldRender>
                        <ShouldRender if={error}>
                            <div id="app-loading">
                                <div>{error}</div>
                            </div>
                        </ShouldRender>
                    </div>
                )}
            </>
        );
    }
}

Main.displayName = 'Main';

const mapStateToProps = state => {
    const ongoing =
        state.status &&
        state.status.ongoing &&
        state.status.ongoing.ongoing &&
        state.status.ongoing.ongoing.filter(
            ongoingSchedule => !ongoingSchedule.cancelled
        );
    const futureEvents = state.status.futureEvents.events;
    const pastEvents = state.status.pastEvents.events;
    return {
        status: state.status,
        statusData: state.status.statusPage,
        login: state.login,
        activeProbe: state.status.activeProbe,
        monitorState: state.status.statusPage.monitorsData,
        monitors: state.status.statusPage.monitors,
        probes: state.probe.probes,
        events: state.status.events.events,
        requestingEvents: state.status.events.requesting,
        statusPage: state.status.statusPage,
        isSubscriberEnabled: state.status.statusPage.isSubscriberEnabled,
        scheduleHistoryDays: state.status.statusPage.scheduleHistoryDays,
        ongoing,
        futureEvents,
        pastEvents,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getStatusPage,
            selectedProbe,
            getScheduledEvent,
            getProbes,
            getOngoingScheduledEvent,
            fetchFutureEvents,
            fetchPastEvents,
        },
        dispatch
    );

Main.propTypes = {
    statusData: PropTypes.object,
    status: PropTypes.object,
    getStatusPage: PropTypes.func,
    getProbes: PropTypes.func,
    getOngoingScheduledEvent: PropTypes.func,
    login: PropTypes.object.isRequired,
    monitorState: PropTypes.array,
    monitors: PropTypes.array,
    selectedProbe: PropTypes.func,
    activeProbe: PropTypes.number,
    probes: PropTypes.array,
    events: PropTypes.array,
    history: PropTypes.object,
    getScheduledEvent: PropTypes.func,
    scheduleHistoryDays: PropTypes.number,
    requestingEvents: PropTypes.bool,
    statusPage: PropTypes.object,
    isSubscriberEnabled: PropTypes.bool.isRequired,
    ongoing: PropTypes.array,
    fetchFutureEvents: PropTypes.func,
    fetchPastEvents: PropTypes.func,
    futureEvents: PropTypes.func,
    pastEvents: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(Main);

const Probes = ({
    probes,
    backgroundMain,
    contentBackground,
    activeProbe,
    monitorState,
    greenBackground,
    uptimeColor,
    greyBackground,
    serviceStatus,
    redBackground,
    downtimeColor,
    yellowBackground,
    degradedColor,
    heading,
    now,
    selectbutton,
    theme,
}) => {
    return (
        <div className="btn-group">
            {probes.map((probe, index) => (
                <>
                    <button
                        onClick={() => selectbutton(index)}
                        style={{
                            background: theme
                                ? '#fff'
                                : backgroundMain.background,
                            borderColor: theme
                                ? 'rgba(170, 170, 170, 0.3)'
                                : contentBackground.background,
                            color: theme && '#000',
                        }}
                        key={`probes-btn${index}`}
                        id={`probes-btn${index}`}
                        className={
                            theme
                                ? activeProbe === index
                                    ? 'icon-container border-fix new_selected'
                                    : 'icon-container border-fix'
                                : activeProbe === index
                                ? 'icon-container selected'
                                : 'icon-container'
                        }
                    >
                        <span
                            style={
                                // If the page doesn't include any monitor or includes only manual monitors
                                // The probe servers will be shown online
                                monitorState.length === 0 ||
                                monitorState.every(
                                    monitor => monitor.type === 'manual'
                                )
                                    ? {
                                          ...greenBackground,
                                          backgroundColor:
                                              uptimeColor.backgroundColor,
                                      }
                                    : probe.lastAlive &&
                                      moment(now).diff(
                                          moment(probe.lastAlive),
                                          'seconds'
                                      ) >= 300
                                    ? greyBackground
                                    : serviceStatus === 'none' ||
                                      serviceStatus === 'some'
                                    ? {
                                          ...redBackground,
                                          backgroundColor:
                                              downtimeColor.backgroundColor,
                                      }
                                    : serviceStatus === 'some-degraded'
                                    ? {
                                          ...yellowBackground,
                                          backgroundColor:
                                              degradedColor.backgroundColor,
                                      }
                                    : {
                                          ...greenBackground,
                                          backgroundColor:
                                              uptimeColor.backgroundColor,
                                      }
                            }
                        ></span>
                        <span style={heading} className={theme && 'probe_bg'}>
                            {probe.probeName}
                        </span>
                    </button>
                </>
            ))}
        </div>
    );
};

Probes.displayName = 'Probes';

Probes.propTypes = {
    probes: PropTypes.array.isRequired,
    backgroundMain: PropTypes.object.isRequired,
    contentBackground: PropTypes.object.isRequired,
    activeProbe: PropTypes.number.isRequired,
    monitorState: PropTypes.array.isRequired,
    greenBackground: PropTypes.object.isRequired,
    uptimeColor: PropTypes.object.isRequired,
    greyBackground: PropTypes.object.isRequired,
    serviceStatus: PropTypes.object.isRequired,
    redBackground: PropTypes.object.isRequired,
    downtimeColor: PropTypes.object.isRequired,
    yellowBackground: PropTypes.object.isRequired,
    degradedColor: PropTypes.object.isRequired,
    heading: PropTypes.object.isRequired,
    now: PropTypes.object.isRequired,
    selectbutton: PropTypes.func,
    theme: PropTypes.string,
};

const FooterCard = ({ footerHTML, statusData, primaryText, secondaryText }) => {
    return (
        <>
            <div id="footer">
                <ul>
                    <ShouldRender if={statusData && statusData.copyright}>
                        <li>
                            {' '}
                            <span style={primaryText}>&copy;</span>{' '}
                            {statusData && statusData.copyright ? (
                                <span style={primaryText}>
                                    {statusData.copyright}
                                </span>
                            ) : (
                                ''
                            )}
                        </li>
                    </ShouldRender>
                    <ShouldRender
                        if={
                            statusData &&
                            statusData.links &&
                            statusData.links.length
                        }
                    >
                        {statusData &&
                            statusData.links &&
                            statusData.links.map((link, i) => (
                                <Footer
                                    link={link}
                                    key={i}
                                    textColor={secondaryText}
                                />
                            ))}
                    </ShouldRender>
                </ul>

                <ShouldRender if={footerHTML}>
                    <div
                        id="customFooterHTML"
                        dangerouslySetInnerHTML={{
                            __html: footerHTML,
                        }}
                    />
                </ShouldRender>

                <p>
                    <a
                        href="https://fyipe.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={secondaryText}
                    >
                        Powered by Fyipe
                    </a>
                </p>
            </div>
        </>
    );
};

FooterCard.displayName = 'FooterCard';

FooterCard.propTypes = {
    footerHTML: PropTypes.string,
    statusData: PropTypes.object,
    primaryText: PropTypes.object,
    secondaryText: PropTypes.object,
};

const HelemtCard = ({ statusData, faviconurl }) => {
    return (
        <Helmet>
            {statusData && statusData.faviconPath ? (
                <link
                    rel="shortcut icon"
                    href={`${API_URL}/file/${statusData.faviconPath}`}
                />
            ) : (
                <link rel="shortcut icon" href={faviconurl} />
            )}
            <title>
                {statusData && statusData.title
                    ? statusData.title
                    : 'Status page'}
            </title>
            <meta name="description" content={statusData.description}></meta>
            <script
                src="/status-page/js/landing.base.js"
                type="text/javascript"
            ></script>
        </Helmet>
    );
};

HelemtCard.displayName = 'HelmetCard';

HelemtCard.propTypes = {
    statusData: PropTypes.object,
    faviconurl: PropTypes.string,
};
