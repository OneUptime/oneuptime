import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import { fetchMonitorIssue } from '../actions/monitor';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import WebsiteIssuesList from '../components/monitor/WebsiteIssuesList';
import ShouldRender from '../components/basic/ShouldRender';

const WebsiteIssuesBox = ({ id, category, description, issues }) => {
    return (
        <div id={id} className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    {category} Issues ({issues && issues.length}
                                    )
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>{description}</span>
                            </span>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <WebsiteIssuesList issues={issues} />
                </div>
            </div>
        </div>
    );
};

WebsiteIssuesBox.displayName = 'WebsiteIssuesBox';

WebsiteIssuesBox.propTypes = {
    id: PropTypes.string,
    category: PropTypes.string,
    description: PropTypes.string,
    issues: PropTypes.array,
};

class WebsiteMonitorIssues extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
    }
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > MONITOR > WEBSITE ISSUES > URL'
            );
        }
    }

    ready = () => {
        this.props.fetchMonitorIssue(
            this.props.match.params.projectId,
            this.props.match.params.issueId
        );
    };

    render() {
        const { monitorState } = this.props;
        let variable;
        if (monitorState.monitorIssue) {
            variable = (
                <>
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div
                                className="db-Trend"
                                style={{ height: 'auto', fontSize: '120%' }}
                            >
                                <div className="block-chart-side line-chart">
                                    <div
                                        className="db-TrendRow"
                                        style={{
                                            flexFlow: 'row wrap',
                                        }}
                                    >
                                        <div
                                            className="db-Trend-colInformation"
                                            style={{
                                                flexBasis: '18%',
                                            }}
                                        >
                                            <div
                                                className="db-Trend-rowTitle"
                                                title="Performance"
                                            >
                                                <div className="db-Trend-title">
                                                    <span className="chart-font">
                                                        Performance
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="db-Trend-row">
                                                <div className="db-Trend-col db-Trend-colValue">
                                                    <span>
                                                        {' '}
                                                        <span className="chart-font">
                                                            <small id="lighthouse-performance">
                                                                {monitorState
                                                                    .monitorIssue
                                                                    .performance
                                                                    ? `${monitorState.monitorIssue.performance}%`
                                                                    : '-'}
                                                            </small>
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            className="db-Trend-colInformation"
                                            style={{
                                                flexBasis: '18%',
                                            }}
                                        >
                                            <div
                                                className="db-Trend-rowTitle"
                                                title="Accessibility"
                                            >
                                                <div className="db-Trend-title">
                                                    <span className="chart-font">
                                                        Accessibility
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="db-Trend-row">
                                                <div className="db-Trend-col db-Trend-colValue">
                                                    <span>
                                                        {' '}
                                                        <span className="chart-font">
                                                            <small id="lighthouse-accessibility">
                                                                {monitorState
                                                                    .monitorIssue
                                                                    .accessibility
                                                                    ? `${monitorState.monitorIssue.accessibility}%`
                                                                    : '-'}
                                                            </small>
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            className="db-Trend-colInformation"
                                            style={{
                                                flexBasis: '18%',
                                            }}
                                        >
                                            <div
                                                className="db-Trend-rowTitle"
                                                title="Best Practices"
                                            >
                                                <div className="db-Trend-title">
                                                    <span className="chart-font">
                                                        Best Practices
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="db-Trend-row">
                                                <div className="db-Trend-col db-Trend-colValue">
                                                    <span>
                                                        {' '}
                                                        <span className="chart-font">
                                                            <small id="lighthouse-bestPractices">
                                                                {monitorState
                                                                    .monitorIssue
                                                                    .bestPractices
                                                                    ? `${monitorState.monitorIssue.bestPractices}%`
                                                                    : '-'}
                                                            </small>
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            className="db-Trend-colInformation"
                                            style={{
                                                flexBasis: '18%',
                                            }}
                                        >
                                            <div
                                                className="db-Trend-rowTitle"
                                                title="SEO"
                                            >
                                                <div className="db-Trend-title">
                                                    <span className="chart-font">
                                                        SEO
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="db-Trend-row">
                                                <div className="db-Trend-col db-Trend-colValue">
                                                    <span>
                                                        {' '}
                                                        <span className="chart-font">
                                                            <small id="lighthouse-seo">
                                                                {monitorState
                                                                    .monitorIssue
                                                                    .seo
                                                                    ? `${monitorState.monitorIssue.seo}%`
                                                                    : '-'}
                                                            </small>
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            className="db-Trend-colInformation"
                                            style={{
                                                flexBasis: '18%',
                                            }}
                                        >
                                            <div
                                                className="db-Trend-rowTitle"
                                                title="PWA"
                                            >
                                                <div className="db-Trend-title">
                                                    <span className="chart-font">
                                                        PWA
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="db-Trend-row">
                                                <div className="db-Trend-col db-Trend-colValue">
                                                    <span>
                                                        {' '}
                                                        <span className="chart-font">
                                                            <small id="lighthouse-pwa">
                                                                {monitorState
                                                                    .monitorIssue
                                                                    .pwa
                                                                    ? `${monitorState.monitorIssue.pwa}%`
                                                                    : '-'}
                                                            </small>
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <ShouldRender
                        if={
                            monitorState.monitorIssue.data &&
                            monitorState.monitorIssue.data.performance
                        }
                    >
                        <WebsiteIssuesBox
                            id="performance"
                            category="Performance"
                            description="These checks ensure that your page is optimized for users to be able to see and interact with page content."
                            issues={monitorState.monitorIssue.data.performance}
                        />
                    </ShouldRender>

                    <ShouldRender
                        if={
                            monitorState.monitorIssue.data &&
                            monitorState.monitorIssue.data.accessibility
                        }
                    >
                        <WebsiteIssuesBox
                            id="accessibility"
                            category="Accessibility"
                            description="These checks highlight opportunities to improve the accessibility of your web app."
                            issues={
                                monitorState.monitorIssue.data.accessibility
                            }
                        />
                    </ShouldRender>

                    <ShouldRender
                        if={
                            monitorState.monitorIssue.data &&
                            monitorState.monitorIssue.data.bestPractices
                        }
                    >
                        <WebsiteIssuesBox
                            id="bestPractices"
                            category="Best Practices"
                            description="These checks highlight opportunities to improve the overall code health of your web app."
                            issues={
                                monitorState.monitorIssue.data.bestPractices
                            }
                        />
                    </ShouldRender>

                    <ShouldRender
                        if={
                            monitorState.monitorIssue.data &&
                            monitorState.monitorIssue.data.seo
                        }
                    >
                        <WebsiteIssuesBox
                            id="seo"
                            category="SEO"
                            description="These checks ensure that your page is optimized for search engine results ranking."
                            issues={monitorState.monitorIssue.data.seo}
                        />
                    </ShouldRender>

                    <ShouldRender
                        if={
                            monitorState.monitorIssue.data &&
                            monitorState.monitorIssue.data.pwa
                        }
                    >
                        <WebsiteIssuesBox
                            id="pwa"
                            category="PWA"
                            description="These checks validate the aspects of a Progressive Web App."
                            issues={monitorState.monitorIssue.data.pwa}
                        />
                    </ShouldRender>
                </>
            );
        } else {
            variable = (
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
            );
        }
        const {
            location: { pathname },
            component,
            monitor,
        } = this.props;
        const componentName =
            component.length > 0
                ? component[0]
                    ? component[0].name
                    : null
                : null;
        const monitorName = monitor ? monitor.name : null;
        const url =
            monitorState &&
            monitorState.monitorIssue &&
            monitorState.monitorIssue.url
                ? monitorState.monitorIssue.url
                : 'URL';

        const monitorDetailRoute = getParentRoute(pathname);
        const componentMonitorsRoute = getParentRoute(monitorDetailRoute);

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
                <BreadCrumbItem route={monitorDetailRoute} name={monitorName} />
                <BreadCrumbItem
                    route={`${monitorDetailRoute}#`}
                    name="Website Issues"
                />
                <BreadCrumbItem route={pathname} name={url} />
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span>
                                    <div>
                                        <div>{variable}</div>
                                    </div>
                                </span>
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

    return {
        component,
        monitor,
        monitorState: state.monitor,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchMonitorIssue,
        },
        dispatch
    );
};

WebsiteMonitorIssues.propTypes = {
    fetchMonitorIssue: PropTypes.func,
    match: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    monitor: PropTypes.object,
    monitorState: PropTypes.object,
};

WebsiteMonitorIssues.displayName = 'WebsiteMonitorIssues';

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(WebsiteMonitorIssues);
