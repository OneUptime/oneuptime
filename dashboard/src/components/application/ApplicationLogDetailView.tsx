import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { fetchLogs } from '../../actions/applicationLog';
import { ListLoader } from '../basic/Loader';
import AlertPanel from '../basic/AlertPanel';
import LogTail from './LogTail';
import SearchInput from '../search/SearchInput';

class ApplicationLogDetailView extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            display: null,
        };
    }

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLogs' does not exist on type 'Reado... Remove this comment to see the full error message
            fetchLogs,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
        } = this.props;
        fetchLogs(projectId, componentId, applicationLog._id, 0, 10);
    }
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLogId' does not exist on type... Remove this comment to see the full error message
            applicationLogId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'stats' does not exist on type 'Readonly<... Remove this comment to see the full error message
            stats,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logs' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            logs,
        } = this.props;
        return (
            <div>
                <ShouldRender
                    if={
                        !(stats && !stats.requesting && stats.stats.all > 0) &&
                        logs &&
                        logs.logs.length < 1 &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'display' does not exist on type 'Readonl... Remove this comment to see the full error message
                        !this.state.display
                    }
                >
                    <AlertPanel
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        id={`${applicationLog.name}-no-log-warning`}
                        message={
                            <span>
                                This Log Container is currently not receiving
                                any logs, Click{' '}
                                <a
                                    rel="noopener noreferrer"
                                    href="https://github.com/OneUptime/feature-docs/blob/master/log.md"
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
                        className="db-ListViewItem-header db-Trends-header"
                        style={{
                            position: 'relative',
                            display: 'flex',
                            justifyContent: 'center',
                            backgroundColor: '#202839',
                        }}
                    >
                        <div className="bs-app-log">
                            <SearchInput
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; componentId: any; applicat... Remove this comment to see the full error message
                                projectId={projectId}
                                componentId={componentId}
                                applicationLogId={applicationLogId}
                                setDisplay={(val: $TSFixMe) => this.setState({ display: val })
                                }
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'display' does not exist on type 'Readonl... Remove this comment to see the full error message
                                display={this.state.display}
                            />
                        </div>
                    </div>
                </ShouldRender>
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="">
                            <div className="Box-root">
                                <div>
                                    <LogTail applicationLog={applicationLog} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ApplicationLogDetailView.displayName = 'ApplicationLogDetailView';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ fetchLogs }, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ApplicationLogDetailView.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    applicationLog: PropTypes.object,
    applicationLogId: PropTypes.string,
    fetchLogs: PropTypes.func,
    stats: PropTypes.object,
    logs: PropTypes.object,
};

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const applicationLogId = props.applicationLog._id;
    const logs = state.applicationLog.logs[applicationLogId];
    return {
        applicationLogId,
        logs,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ApplicationLogDetailView);
