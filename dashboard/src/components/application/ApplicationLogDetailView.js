import React, { Component } from 'react';
import LogList from './LogList';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { fetchLogs } from '../../actions/applicationLog';
import { ListLoader } from '../basic/Loader';
import AlertPanel from '../basic/AlertPanel';

class ApplicationLogDetailView extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        const {
            fetchLogs,
            projectId,
            componentId,
            applicationLog,
        } = this.props;
        fetchLogs(projectId, componentId, applicationLog._id, 0, 10);
    }
    render() {
        const {
            applicationLog,
            componentId,
            projectId,
            isDetails,
            stats,
            logOptions,
            handleLogTypeChange,
            handleNavigationButtonClick,
        } = this.props;
        return (
            <div>
                <ShouldRender
                    if={!(stats && !stats.requesting && stats.stats.all > 0)}
                >
                    <AlertPanel
                        id={`${applicationLog.name}-no-log-warning`}
                        message={
                            <span>
                                This Log Container is currently not receiving
                                any logs, Click{' '}
                                <a
                                    rel="noopener noreferrer"
                                    href="https://github.com/Fyipe/feature-docs/blob/master/log.md"
                                    target="_blank"
                                    className="Border-bottom--white Text-fontWeight--bold Text-color--white"
                                >
                                    {' '}
                                    here
                                </a>{' '}
                                to setup it up and start collecting logs.
                            </span>
                        }
                    />
                </ShouldRender>
                <ShouldRender if={!stats || stats.requesting}>
                    <ListLoader />
                </ShouldRender>
                <ShouldRender if={stats && !stats.requesting}>
                    <div
                        className="db-TrendRow db-ListViewItem-header db-Trends-header"
                        style={{
                            cursor: isDetails ? 'pointer' : 'none',
                            zIndex: 'unset',
                        }}
                    >
                        <div
                            onClick={() => handleLogTypeChange(logOptions[0])}
                            className="db-Trend-colInformation"
                            id={`${applicationLog.name}-all`}
                        >
                            <div className="db-Trend-rowTitle" title="All Logs">
                                <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                    <span className="chart-font">All Logs</span>
                                </div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                    <span>
                                        {' '}
                                        <span className="chart-font">
                                            {stats && stats.stats
                                                ? stats.stats.all
                                                : 0}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div
                            onClick={() => handleLogTypeChange(logOptions[1])}
                            className="db-Trend-colInformation"
                            id={`${applicationLog.name}-error`}
                        >
                            <div
                                className="db-Trend-rowTitle"
                                title="Error Logs"
                            >
                                <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                    <span className="chart-font">
                                        Error Logs
                                    </span>
                                </div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                    <span>
                                        {' '}
                                        <span className="chart-font">
                                            {stats && stats.stats
                                                ? stats.stats.error
                                                : 0}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div
                            onClick={() => handleLogTypeChange(logOptions[2])}
                            className="db-Trend-colInformation"
                            id={`${applicationLog.name}-warning`}
                        >
                            <div
                                className="db-Trend-rowTitle"
                                title="Warning Logs"
                            >
                                <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                    <span className="chart-font">
                                        Warning Logs
                                    </span>
                                </div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                    <span>
                                        {' '}
                                        <span className="chart-font">
                                            {stats && stats.stats
                                                ? stats.stats.warning
                                                : 0}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div
                            onClick={() => handleLogTypeChange(logOptions[3])}
                            className="db-Trend-colInformation"
                            id={`${applicationLog.name}-info`}
                        >
                            <div
                                className="db-Trend-rowTitle"
                                title="Info Logs"
                            >
                                <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                    <span className="chart-font">
                                        Info Logs
                                    </span>
                                </div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                    <span>
                                        {' '}
                                        <span className="chart-font">
                                            {stats && stats.stats
                                                ? stats.stats.info
                                                : 0}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="">
                            <div className="Box-root">
                                <div>
                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span>
                                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>
                                                        Here&apos;s a list of
                                                        recent logs which belong
                                                        to this log container.
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <LogList
                                        applicationLog={applicationLog}
                                        componentId={componentId}
                                        projectId={projectId}
                                        handleNavigationButtonClick={
                                            handleNavigationButtonClick
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
ApplicationLogDetailView.displayName = 'ApplicationLogDetailView';

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ fetchLogs }, dispatch);
};

ApplicationLogDetailView.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    applicationLog: PropTypes.object,
    isDetails: PropTypes.bool,
    fetchLogs: PropTypes.func,
    stats: PropTypes.object,
    logOptions: PropTypes.array,
    handleLogTypeChange: PropTypes.func,
    handleNavigationButtonClick: PropTypes.func,
};

export default connect(null, mapDispatchToProps)(ApplicationLogDetailView);
