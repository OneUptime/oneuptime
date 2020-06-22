import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import UptimeLegend from './UptimeLegend';
import NoMonitor from './NoMonitor';
import MonitorInfo from './MonitorInfo';
import ShouldRender from './ShouldRender';
import Footer from './Footer';
import NotesMain from './NotesMain';
import EventsMain from './EventsMain';
import { API_URL, ACCOUNTS_URL, getServiceStatus } from '../config';
import moment from 'moment';
import { Helmet } from 'react-helmet';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { getStatusPage, selectedProbe } from '../actions/status';
import { getProbes } from '../actions/probe';
import LineChartsContainer from './LineChartsContainer';

const greenBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(117, 211, 128)',
};
const yellowBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(255, 222, 36)',
};
const redBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(250, 117, 90)',
};
const greyBackground = {
    display: 'inline-block',
    borderRadius: '50%',
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
        if (prevProps.probes !== this.props.probes) {
            if (this.state.nowHandler) {
                clearTimeout(this.state.nowHandler);
            }

            this.setLastAlive();
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

        let statusPageId, url;

        if (
            window.location.pathname.includes('/status-page/') &&
            window.location.pathname.split('/').length >= 3
        ) {
            statusPageId = window.location.pathname.split('/')[2];
            url = 'null';
        } else if (
            window.location.href.indexOf('localhost') > -1 ||
            window.location.href.indexOf('fyipeapp.com') > 0
        ) {
            statusPageId = window.location.host.split('.')[0];
            url = 'null';
        } else {
            statusPageId = 'null';
            url = window.location.host;
        }

        this.props.getProbes(statusPageId, 0, 10).then(() => {
            this.selectbutton(this.props.activeProbe);
        });

        this.props.getStatusPage(statusPageId, url).catch(err => {
            if (err.message === 'Request failed with status code 401') {
                const { loginRequired } = this.props.login;
                if (loginRequired) {
                    window.location = `${ACCOUNTS_URL}/login?statusPage=true&statusPageURL=${window.location.href}`;
                }
            }
        });

        this.setLastAlive();
    }

    groupBy(collection, property) {
        let i = 0,
            val,
            index;
        const values = [],
            result = [];

        for (; i < collection.length; i++) {
            val = collection[i][property]
                ? collection[i][property]['name']
                : 'no-category';
            index = values.indexOf(val);
            if (index > -1) {
                result[index].push(collection[i]);
            } else {
                values.push(val);
                result.push([collection[i]]);
            }
        }
        return result;
    }

    groupedMonitors = () => {
        if (
            this.props.statusData &&
            this.props.statusData.monitorsData !== undefined &&
            this.props.statusData.monitorsData.length > 0
        ) {
            const monitorData = this.props.statusData.monitorsData;
            const groupedMonitorData = this.groupBy(
                monitorData,
                'monitorCategoryId'
            );
            const monitorCategoryStyle = {
                display: 'inline-block',
                marginBottom: 10,
                fontSize: 10,
                color: '#8898aa',
                fontWeight: 'Bold',
            };
            const monitorCategoryGroupContainerStyle = {
                marginBottom: 40,
            };
            return groupedMonitorData.map((groupedMonitors, i) => {
                return (
                    <div
                        key={i}
                        style={monitorCategoryGroupContainerStyle}
                        className="uptime-graph-header"
                    >
                        <div
                            id={`monitorCategory${i}`}
                            style={monitorCategoryStyle}
                        >
                            <span>
                                {groupedMonitors[0].monitorCategoryId
                                    ? groupedMonitors[0].monitorCategoryId.name.toUpperCase()
                                    : 'Uncategorized'.toUpperCase()}
                            </span>
                        </div>
                        {groupedMonitors.map((monitor, i) => {
                            return (
                                <MonitorInfo
                                    monitor={monitor}
                                    key={i}
                                    id={`monitor${i}`}
                                />
                            );
                        })}
                    </div>
                );
            });
        } else {
            return <NoMonitor />;
        }
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
        const { headerHTML, footerHTML, customCSS } = this.props.statusData;
        const sanitizedCSS = customCSS ? customCSS.split('↵').join('') : '';
        const probes = this.props.probes;
        let view = false;
        let status = '';
        let serviceStatus = '';
        let statusMessage = '';
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
            degradedColor;
        let statusBackground;
        if (this.props.statusData && this.props.statusData.monitorsData) {
            serviceStatus = getServiceStatus(this.props.monitorState, probes);
            isGroupedByMonitorCategory = this.props.statusData
                .isGroupedByMonitorCategory;
            const colors = this.props.statusData.colors;

            if (serviceStatus === 'all') {
                status = 'status-bubble status-up';
                statusMessage = 'All services are online';
                faviconurl = '/status-page/greenfavicon.ico';
            } else if (serviceStatus === 'none') {
                status = 'status-bubble status-down';
                statusMessage = 'All services are offline';
                faviconurl = '/status-page/redfavicon.ico';
            } else if (serviceStatus === 'some') {
                status = 'status-bubble status-paused';
                statusMessage = 'Some services are offline';
                faviconurl = '/status-page/yellowfavicon.ico';
            }
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
                backgroundColor: `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b})`,
            };

            uptimeColor = {
                backgroundColor: `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b})`,
            };

            degradedColor = {
                backgroundColor: `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b})`,
            };

            if (serviceStatus === 'all') {
                statusBackground = uptimeColor;
            } else if (serviceStatus === 'none') {
                statusBackground = downtimeColor;
            } else if (serviceStatus === 'some') {
                statusBackground = degradedColor;
            }

            backgroundMain = {
                background: `rgba(${colors.pageBackground.r}, ${colors.pageBackground.g}, ${colors.pageBackground.b}, ${colors.pageBackground.a})`,
            };

            contentBackground = {
                background: `rgba(${colors.statusPageBackground.r}, ${colors.statusPageBackground.g}, ${colors.statusPageBackground.b}, ${colors.statusPageBackground.a})`,
            };
        }

        return (
            <div className="page-main-wrapper" style={backgroundMain}>
                {this.props.statusData && this.props.statusData.bannerPath ? (
                    <span>
                        <img
                            src={`${API_URL}/file/${this.props.statusData.bannerPath}`}
                            alt=""
                            className="banner"
                        />
                    </span>
                ) : (
                    ''
                )}
                {view ? (
                    <div className="innernew">
                        {headerHTML ? (
                            <React.Fragment>
                                <style>{sanitizedCSS}</style>
                                <div
                                    id="customHeaderHTML"
                                    dangerouslySetInnerHTML={{
                                        __html: headerHTML,
                                    }}
                                />
                            </React.Fragment>
                        ) : (
                            <div className="header clearfix">
                                <div className="heading">
                                    {this.props.statusData &&
                                    this.props.statusData.logoPath ? (
                                        <span>
                                            <img
                                                src={`${API_URL}/file/${this.props.statusData.logoPath}`}
                                                alt=""
                                                className="logo"
                                            />
                                        </span>
                                    ) : (
                                        ''
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="content">
                            <div
                                className="white box"
                                style={contentBackground}
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
                                            {statusMessage}
                                        </span>
                                        <label
                                            className="status-time"
                                            style={secondaryText}
                                        >
                                            As of{' '}
                                            <span className="current-time">
                                                {moment(new Date()).format(
                                                    'LLLL'
                                                )}
                                            </span>
                                        </label>
                                    </div>
                                </div>
                                <div className="btn-group">
                                    {probes.map((probe, index) => (
                                        <button
                                            onClick={() =>
                                                this.selectbutton(index)
                                            }
                                            style={{
                                                background:
                                                    backgroundMain.background,
                                                borderColor:
                                                    contentBackground.background,
                                            }}
                                            key={`probes-btn${index}`}
                                            id={`probes-btn${index}`}
                                            className={
                                                this.props.activeProbe === index
                                                    ? 'icon-container selected'
                                                    : 'icon-container'
                                            }
                                        >
                                            <span
                                                style={
                                                    probe.lastAlive &&
                                                    moment(this.state.now).diff(
                                                        moment(probe.lastAlive),
                                                        'seconds'
                                                    ) >= 300
                                                        ? greyBackground
                                                        : serviceStatus ===
                                                          'none'
                                                        ? {
                                                              ...redBackground,
                                                              backgroundColor:
                                                                  downtimeColor.backgroundColor,
                                                          }
                                                        : serviceStatus ===
                                                          'some'
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
                                            <span style={heading}>
                                                {probe.probeName}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                                <div
                                    className="statistics"
                                    style={contentBackground}
                                >
                                    <div className="inner-gradient"></div>
                                    <div className="uptime-graphs box-inner">
                                        {isGroupedByMonitorCategory ? (
                                            this.groupedMonitors()
                                        ) : this.props.statusData &&
                                          this.props.statusData.monitorsData !==
                                              undefined &&
                                          this.props.statusData.monitorsData
                                              .length > 0 ? (
                                            this.props.statusData.monitorsData.map(
                                                (monitor, i) => {
                                                    return (
                                                        this.props.monitors && (
                                                            <Fragment>
                                                                {this.props.monitors.some(
                                                                    m =>
                                                                        monitor._id ===
                                                                        m.monitor
                                                                ) && (
                                                                    <MonitorInfo
                                                                        monitor={
                                                                            monitor
                                                                        }
                                                                        selectedCharts={
                                                                            this.props.monitors.filter(
                                                                                m =>
                                                                                    monitor._id ===
                                                                                    m.monitor
                                                                            )[0]
                                                                        }
                                                                        key={`uptime-${i}`}
                                                                        id={`monitor${i}`}
                                                                    />
                                                                )}
                                                                {this.props.monitors.some(
                                                                    m =>
                                                                        monitor._id ===
                                                                        m.monitor
                                                                ) && (
                                                                    <LineChartsContainer
                                                                        monitor={
                                                                            monitor
                                                                        }
                                                                        selectedCharts={
                                                                            this.props.monitors.filter(
                                                                                m =>
                                                                                    monitor._id ===
                                                                                    m.monitor
                                                                            )[0]
                                                                        }
                                                                    />
                                                                )}
                                                            </Fragment>
                                                        )
                                                    );
                                                }
                                            )
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
                                        />
                                    ) : (
                                        ''
                                    )}
                                </div>
                            </div>
                        </div>
                        <Helmet>
                            {this.props.statusData &&
                            this.props.statusData.faviconPath ? (
                                <link
                                    rel="shortcut icon"
                                    href={`${API_URL}/file/${this.props.statusData.faviconPath}`}
                                />
                            ) : (
                                <link rel="shortcut icon" href={faviconurl} />
                            )}
                            <title>
                                {this.props.statusData &&
                                this.props.statusData.title
                                    ? this.props.statusData.title
                                    : 'Status page'}
                            </title>
                            <script
                                src="/status-page/js/landing.base.js"
                                type="text/javascript"
                            ></script>
                        </Helmet>
                        <ShouldRender
                            if={
                                this.props.statusData &&
                                this.props.statusData.projectId &&
                                this.props.statusData._id
                            }
                        >
                            <NotesMain
                                projectId={this.props.statusData.projectId._id}
                                statusPageId={this.props.statusData._id}
                            />

                            <ShouldRender
                                if={this.props.statusData.showScheduledEvents}
                            >
                                <EventsMain
                                    projectId={
                                        this.props.statusData.projectId._id
                                    }
                                    statusPageId={this.props.statusData._id}
                                />
                            </ShouldRender>
                        </ShouldRender>
                        {footerHTML ? (
                            <div
                                id="customFooterHTML"
                                dangerouslySetInnerHTML={{ __html: footerHTML }}
                            />
                        ) : (
                            <div id="footer">
                                <ul>
                                    <ShouldRender
                                        if={
                                            this.props.statusData &&
                                            this.props.statusData.copyright
                                        }
                                    >
                                        <li>
                                            {' '}
                                            <span style={primaryText}>
                                                &copy;
                                            </span>{' '}
                                            {this.props.statusData &&
                                            this.props.statusData.copyright ? (
                                                <span style={primaryText}>
                                                    {
                                                        this.props.statusData
                                                            .copyright
                                                    }
                                                </span>
                                            ) : (
                                                ''
                                            )}
                                        </li>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            this.props.statusData &&
                                            this.props.statusData.links &&
                                            this.props.statusData.links.length
                                        }
                                    >
                                        {this.props.statusData &&
                                            this.props.statusData.links &&
                                            this.props.statusData.links.map(
                                                (link, i) => (
                                                    <Footer
                                                        link={link}
                                                        key={i}
                                                        textColor={
                                                            secondaryText
                                                        }
                                                    />
                                                )
                                            )}
                                    </ShouldRender>
                                </ul>

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
                        )}
                    </div>
                ) : (
                    ''
                )}

                <ShouldRender
                    if={
                        this.props.status &&
                        (this.props.status.requesting ||
                            this.props.status.logs.some(log => log.requesting))
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
        );
    }
}

Main.displayName = 'Main';

const mapStateToProps = state => ({
    status: state.status,
    statusData: state.status.statusPage,
    login: state.login,
    activeProbe: state.status.activeProbe,
    monitorState: state.status.statusPage.monitorsData,
    monitors: state.status.statusPage.monitors,
    probes: state.probe.probes,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getStatusPage,
            getProbes,
            selectedProbe,
        },
        dispatch
    );

Main.propTypes = {
    statusData: PropTypes.object,
    status: PropTypes.object,
    getStatusPage: PropTypes.func,
    getProbes: PropTypes.func,
    login: PropTypes.object.isRequired,
    monitorState: PropTypes.array,
    monitors: PropTypes.array,
    selectedProbe: PropTypes.func,
    activeProbe: PropTypes.number,
    probes: PropTypes.array,
};

export default connect(mapStateToProps, mapDispatchToProps)(Main);
