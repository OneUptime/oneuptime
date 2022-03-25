import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import SlackItem from './SlackItem';
import { WebHookTableHeader } from './WebHookRow';
import {
    getSlack,
    paginate,
    getSlackMonitor,
} from '../../actions/slackWebhook';
import { ListLoader } from '../basic/Loader';

import { User } from '../../config';

interface SlackListProps {
    getSlack?: Function;
    projectId?: string;
    monitorId?: string;
    isRequesting?: boolean;
    slacks?: object;
    paginate: Function;
    pages?: object;
    getSlackMonitor?: Function;
}

class SlackList extends React.Component<SlackListProps> {
    ready() {

        const { getSlackMonitor, monitorId, getSlack } = this.props;

        const { projectId } = this.props;
        if (monitorId) {
            getSlackMonitor(projectId, monitorId);
        } else {
            getSlack(projectId);
        }
    }

    override componentDidMount() {
        this.ready();
    }

    override componentWillUnmount() {

        this.props.paginate('reset');
    }

    handleKeyBoard = (e: $TSFixMe) => {
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

            slacks: { skip, limit },

            getSlackMonitor,

            projectId,

            paginate,

            monitorId,

            getSlack,
        } = this.props;

        if (monitorId) {
            getSlackMonitor(
                projectId,
                monitorId,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            getSlack(
                projectId,
                monitorId,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        }

        paginate('prev');
    };

    nextClicked = () => {
        const {

            slacks: { skip, limit },

            getSlackMonitor,

            projectId,

            paginate,

            monitorId,

            getSlack,
        } = this.props;

        if (monitorId) {
            getSlackMonitor(projectId, monitorId, skip + limit, 10);
        } else {
            getSlack(projectId, skip + limit, 10);
        }

        paginate('next');
    };

    override render() {

        const { slacks, isRequesting, monitorId } = this.props;
        const { count, skip, limit } = slacks;
        let { slacks: webHooks } = slacks;
        let canPaginateForward =
            slacks && count && count > skip + limit ? true : false;
        let canPaginateBackward = slacks && skip && skip > 0 ? true : false;
        if (monitorId && webHooks) {
            webHooks = webHooks.filter((hook: $TSFixMe) => hook.monitors.some((mon: $TSFixMe) => mon.monitorId._id === monitorId)
            );
        }
        const numberOfWebHooks = webHooks ? webHooks.length : 0;

        if (slacks && (slacks.requesting || !slacks.slacks)) {
            canPaginateForward = false;
            canPaginateBackward = false;
        }
        const numberOfPages = Math.ceil(parseInt(count) / 10);

        return (
            <React.Fragment>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table
                        className="Table"
                        id="slackWebhookList"
                        onKeyDown={this.handleKeyBoard}
                    >
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <WebHookTableHeader text="Name" />
                                {!monitorId && (
                                    <WebHookTableHeader text="Monitors" />
                                )}
                                <WebHookTableHeader
                                    text="Action"
                                    name="webhooklist"
                                />
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            <ShouldRender if={numberOfWebHooks > 0}>
                                {(webHooks ? webHooks : []).map((hook: $TSFixMe) => <SlackItem
                                    key={`${hook._id}`}

                                    data={hook}
                                    monitorId={monitorId}
                                    monitors={hook.monitors}
                                />)}
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
                            <span id="No_SlackTeam">
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
                                    {numberOfPages > 0
                                        ? `Page ${this.props.pages.counter
                                        } of ${numberOfPages} (${count} Slack${count === 1 ? '' : 's'
                                        })`
                                        : `${count} Slack${count === 1 ? '' : 's'
                                        }`}
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
                                    className={`Button bs-ButtonLegacy ${!canPaginateBackward
                                        ? 'Is--disabled'
                                        : ''
                                        }`}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    disabled={!canPaginateBackward}
                                    type="button"
                                    onClick={this.prevClicked}
                                    id="btnPrevSlack"
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
                                    className={`Button bs-ButtonLegacy ${!canPaginateForward
                                        ? 'Is--disabled'
                                        : ''
                                        }`}
                                    data-db-analytics-name="list_view.pagination.next"
                                    disabled={!canPaginateForward}
                                    type="button"
                                    onClick={this.nextClicked}
                                    id="btnNextSlack"
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


SlackList.displayName = 'SlackList';

const mapStateToProps = (state: $TSFixMe) => ({
    slacks: state.slackWebhooks.slacks,
    isRequesting: state.slackWebhooks.slacks.requesting,
    currentProject: state.project.currentProject,

    projectId:
        (state.project.currentProject && state.project.currentProject._id) ||
        User.getCurrentProjectId(),

    monitor: state.monitor,
    pages: state.slackWebhooks.pages
});

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        getSlack,
        paginate,
        getSlackMonitor,
    },
    dispatch
);


SlackList.propTypes = {
    getSlack: PropTypes.func,
    projectId: PropTypes.string,
    monitorId: PropTypes.string,
    isRequesting: PropTypes.bool,
    slacks: PropTypes.object,
    paginate: PropTypes.func.isRequired,
    pages: PropTypes.object,
    getSlackMonitor: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(SlackList);
