import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { fetchLogs } from '../../actions/applicationLog';
import { ListLoader } from '../basic/Loader';
import AlertPanel from '../basic/AlertPanel';
import LogTail from './LogTail';
import SearchInput from '../search/SearchInput';

interface ApplicationLogDetailViewProps {
    projectId?: string;
    componentId?: string;
    applicationLog?: object;
    applicationLogId?: string;
    fetchLogs?: Function;
    stats?: object;
    logs?: object;
}

class ApplicationLogDetailView extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            display: null,
        };
    }

    override componentDidMount() {
        const {

            fetchLogs,

            projectId,

            componentId,

            applicationLog,
        } = this.props;
        fetchLogs(projectId, componentId, applicationLog._id, 0, 10);
    }
    override render() {
        const {

            projectId,

            componentId,

            applicationLog,

            applicationLogId,

            stats,

            logs,
        } = this.props;
        return (
            <div>
                <ShouldRender
                    if={
                        !(stats && !stats.requesting && stats.stats.all > 0) &&
                        logs &&
                        logs.logs.length < 1 &&

                        !this.state.display
                    }
                >
                    <AlertPanel

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

                                projectId={projectId}
                                componentId={componentId}
                                applicationLogId={applicationLogId}
                                setDisplay={(val: $TSFixMe) => this.setState({ display: val })
                                }

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

ApplicationLogDetailView.displayName = 'ApplicationLogDetailView';

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators({ fetchLogs }, dispatch);
};


ApplicationLogDetailView.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    applicationLog: PropTypes.object,
    applicationLogId: PropTypes.string,
    fetchLogs: PropTypes.func,
    stats: PropTypes.object,
    logs: PropTypes.object,
};

const mapStateToProps: Function = (state: RootState, props: $TSFixMe) => {
    const applicationLogId: $TSFixMe = props.applicationLog._id;
    const logs: $TSFixMe = state.applicationLog.logs[applicationLogId];
    return {
        applicationLogId,
        logs,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ApplicationLogDetailView);
