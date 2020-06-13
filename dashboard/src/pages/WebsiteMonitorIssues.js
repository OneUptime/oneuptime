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

class WebsiteMonitorIssues extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
    }
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > WEBSITE ISSUES');
        }
    }

    ready = () => {
        this.props.fetchMonitorIssue(
            this.props.match.params.projectId,
            this.props.match.params.issueId
        );
    };

    render() {
        let variable;
        if (this.props.monitor.monitorIssue) {
            variable = (
                <div className="Box-root Card-shadow--medium">
                    <div className="db-Trends-header Box-background--white Box-divider--surface-bottom-1">
                        <div className="ContentHeader Box-root Box-background--white Flex-flex Flex-direction--column">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Website Issues (
                                            {this.props.monitor.monitorIssue
                                                .data &&
                                                this.props.monitor.monitorIssue
                                                    .data.length}
                                            )
                                        </span>
                                    </span>
                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Here&#39;s the list of issues for{' '}
                                            {
                                                this.props.monitor.monitorIssue
                                                    .url
                                            }
                                            .
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <WebsiteIssuesList
                            monitorIssue={this.props.monitor.monitorIssue}
                        />
                    </div>
                </div>
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
            component,
            location: { pathname },
        } = this.props;
        const componentName =
            component.length > 0
                ? component[0]
                    ? component[0].name
                    : null
                : null;

        return (
            <Dashboard ready={this.ready}>
                <BreadCrumbItem route="#" name={componentName} />
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Website Issues"
                />
                <BreadCrumbItem route={pathname} name="Website Issues" />
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
    const { componentId } = props.match.params;
    const component = state.component.componentList.components.map(item => {
        return item.components.find(component => component._id === componentId);
    });

    return {
        component,
        monitor: state.monitor,
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
    monitor: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
};

WebsiteMonitorIssues.displayName = 'WebsiteMonitorIssues';

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(WebsiteMonitorIssues);
