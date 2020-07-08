import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import MSTeamsItem from './MSTeamsItem';
import { WebHookTableHeader } from './WebHookRow';
import { getMsTeams, paginate } from '../../actions/msteamsWebhook';
import { ListLoader } from '../basic/Loader';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { history } from '../../store';

class MSTeamsList extends React.Component {
    ready() {
        const { getMsTeams } = this.props;
        let { projectId } = this.props;
        if (!projectId) {
            projectId = history.location.pathname
                .split('project/')[1]
                .split('/')[0];
            getMsTeams(projectId);
        } else {
            getMsTeams(projectId);
        }
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > WEBHOOKS');
        }
    }

    componentDidMount() {
        this.ready();
    }

    componentWillUnmount() {
        this.props.paginate('reset');
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'ArrowRight':
                return this.nextClicked();
            case 'ArrowLeft':
                return this.prevClicked();
            default:
                return false;
        }
    };

    prevClicked = () => {
        const {
            msTeams: { skip, limit },
            getMsTeams,
            projectId,
            paginate,
        } = this.props;

        getMsTeams(
            projectId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        paginate('prev');
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > WEBHOOKS > PREVIOUS CLICKED'
            );
        }
    };

    nextClicked = () => {
        const {
            msTeams: { skip, limit },
            getMsTeams,
            projectId,
            paginate,
        } = this.props;

        getMsTeams(projectId, skip + limit, 10);
        paginate('next');
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('EVENT: DASHBOARD > PROJECT > WEBHOOKS > NEXT CLICKED');
        }
    };

    render() {
        const { msTeams, isRequesting, monitorId } = this.props;
        const { count, skip, limit } = msTeams;
        let { msTeams: webHooks } = msTeams;
        let canPaginateForward =
            msTeams && count && count > skip + limit ? true : false;
        let canPaginateBackward = msTeams && skip && skip > 0 ? true : false;
        if (monitorId && webHooks) {
            webHooks = webHooks.filter(
                hook => hook.monitorId._id === monitorId
            );
        }
        const numberOfWebHooks = webHooks ? webHooks.length : 0;

        if (msTeams && (msTeams.requesting || !msTeams.msTeams)) {
            canPaginateForward = false;
            canPaginateBackward = false;
        }

        return (
            <React.Fragment>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table
                        className="Table"
                        id="webhookList"
                        onKeyDown={this.handleKeyBoard}
                    >
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <WebHookTableHeader text="Endpoint" />
                                {!monitorId && (
                                    <WebHookTableHeader text="Monitors" />
                                )}
                                <WebHookTableHeader text="Action" />
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            <ShouldRender if={numberOfWebHooks > 0}>
                                {(webHooks ? webHooks : []).map(hook => (
                                    <MSTeamsItem
                                        key={`${hook._id}`}
                                        data={hook}
                                        monitorId={monitorId}
                                    />
                                ))}
                            </ShouldRender>
                        </tbody>
                    </table>
                </div>
                <ShouldRender if={numberOfWebHooks === 0 && !isRequesting}>
                    <div className="Box-root">
                        <br />
                        <div
                            id="app-loading"
                            style={{
                                zIndex: '1',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                flexDirection: 'column',
                                textAlign: 'center',
                                padding: '0 10px',
                            }}
                        >
                            <span>
                                You don&#39;t have any webhook added. Do you
                                want to add one?
                            </span>
                            <br />
                        </div>
                        <br />
                    </div>
                </ShouldRender>
                <ShouldRender if={isRequesting}>
                    <div
                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                        style={{ marginTop: '10px' }}
                    >
                        <ListLoader />
                    </div>
                </ShouldRender>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {webHooks.length} MS Team
                                    {numberOfWebHooks === 1 ? '' : 's'}
                                </span>
                            </span>
                        </span>
                    </div>
                    <div
                        className="Box-root Padding-horizontal--20 Padding-vertical--16"
                        style={{ paddingRight: 29 }}
                    >
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    className={`Button bs-ButtonLegacy ${
                                        !canPaginateBackward
                                            ? 'Is--disabled'
                                            : ''
                                    }`}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    disabled={!canPaginateBackward}
                                    type="button"
                                    onClick={this.prevClicked}
                                    id="btnPrevMsTeams"
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Previous</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                            <div className="Box-root">
                                <button
                                    className={`Button bs-ButtonLegacy ${
                                        !canPaginateForward
                                            ? 'Is--disabled'
                                            : ''
                                    }`}
                                    data-db-analytics-name="list_view.pagination.next"
                                    disabled={!canPaginateForward}
                                    type="button"
                                    onClick={this.nextClicked}
                                    id="btnNextMsTeams"
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Next</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </React.Fragment>
        );
    }
}

MSTeamsList.displayName = 'MsTeamsList';

const mapStateToProps = state => ({
    msTeams: state.msTeams.msTeams,
    isRequesting: state.msTeams.msTeams.requesting,
    currentProject: state.project.currentProject,
    projectId: state.project.currentProject && state.project.currentProject._id,
    monitor: state.monitor,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getMsTeams,
            paginate,
        },
        dispatch
    );

MSTeamsList.propTypes = {
    getMsTeams: PropTypes.func,
    projectId: PropTypes.string,
    monitorId: PropTypes.string,
    isRequesting: PropTypes.bool,
    msTeams: PropTypes.object,
    paginate: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(MSTeamsList);
