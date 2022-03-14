import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import PropTypes from 'prop-types';
import { fetchMonitorIssue } from '../actions/monitor';
import { fetchComponent } from '../actions/component';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import WebsiteIssuesList from '../components/monitor/WebsiteIssuesList';
import ShouldRender from '../components/basic/ShouldRender';

const WebsiteIssuesBox = ({
    id,
    category,
    description,
    issues
}: $TSFixMe) => {
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
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }
    componentDidMount() {
        this.ready();
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            String(prevProps.componentSlug) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            String(this.props.componentSlug) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            prevProps.projectId !== this.props.projectId
        ) {
            this.ready();
        }
    }

    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
        const { componentSlug, fetchComponent, projectId } = this.props;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorIssue' does not exist on typ... Remove this comment to see the full error message
            this.props.fetchMonitorIssue(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                this.props.match.params.issueId
            );
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
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
                            monitorState.monitorIssue.data.performance &&
                            monitorState.monitorIssue.data.performance.length >
                            0
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
                            monitorState.monitorIssue.data.accessibility &&
                            monitorState.monitorIssue.data.accessibility
                                .length > 0
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
                            monitorState.monitorIssue.data['best-practices'] &&
                            monitorState.monitorIssue.data['best-practices']
                                .length > 0
                        }
                    >
                        <WebsiteIssuesBox
                            id="bestPractices"
                            category="Best Practices"
                            description="These checks highlight opportunities to improve the overall code health of your web app."
                            issues={
                                monitorState.monitorIssue.data['best-practices']
                            }
                        />
                    </ShouldRender>

                    <ShouldRender
                        if={
                            monitorState.monitorIssue.data &&
                            monitorState.monitorIssue.data.seo &&
                            monitorState.monitorIssue.data.seo.length > 0
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
                            monitorState.monitorIssue.data.pwa &&
                            monitorState.monitorIssue.data.pwa.length > 0
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            monitor,
        } = this.props;
        const componentName =
            component?.length > 0
                ? component[0]
                    ? component[0]?.name
                    : null
                : null;
        const monitorName = monitor ? monitor.name : null;
        const url =
            monitorState &&
                monitorState.monitorIssue &&
                monitorState.monitorIssue.url
                ? monitorState.monitorIssue.url
                : 'URL';

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
        const monitorDetailRoute = getParentRoute(pathname);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
        const componentMonitorsRoute = getParentRoute(monitorDetailRoute);

        return (
            <Fade>
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
            </Fade>
        );
    }
}

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const { componentSlug, monitorSlug } = props.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const monitorCollection = state.monitor.monitorsList.monitors.find((el: $TSFixMe) => {
        return projectId === el._id;
    });
    const currentMonitor =
        monitorCollection &&
        monitorCollection.monitors.find((el: $TSFixMe) => {
            return el.slug === monitorSlug;
        });
    const monitorId = currentMonitor && currentMonitor._id;
    const monitor = state.monitor.monitorsList.monitors
        .map((monitor: $TSFixMe) => monitor.monitors.find((monitor: $TSFixMe) => monitor._id === monitorId)
        )
        .filter((monitor: $TSFixMe) => monitor)[0];

    return {
        component:
            state.component && state.component.currentComponent.component,
        monitor,
        monitorState: state.monitor,
        projectId,
        componentSlug,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchMonitorIssue,
            fetchComponent,
        },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
WebsiteMonitorIssues.propTypes = {
    fetchMonitorIssue: PropTypes.func,
    fetchComponent: PropTypes.func,
    match: PropTypes.object,
    componentSlug: PropTypes.string,
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
    projectId: PropTypes.string,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
WebsiteMonitorIssues.displayName = 'WebsiteMonitorIssues';

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(WebsiteMonitorIssues);
