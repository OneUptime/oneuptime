import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import WebHookItem from './WebHookItem';
import { User } from '../../config';
import { WebHookTableHeader } from './WebHookRow';
import {
    getWebHook,
    getWebHookError,
    getWebHookRequest,
    getWebHookSuccess,
    paginate,
    getWebHookMonitor,
} from '../../actions/webHook';
import { ListLoader } from '../basic/Loader';

class WebHookList extends React.Component {
    ready() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getWebHookMonitor' does not exist on typ... Remove this comment to see the full error message
        const { getWebHookMonitor, getWebHook } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, monitorId } = this.props;

        if (monitorId) {
            getWebHookMonitor(projectId, monitorId);
        } else {
            getWebHook(projectId);
        }
    }

    componentDidMount() {
        this.ready();
    }

    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'webHook' does not exist on type 'Readonl... Remove this comment to see the full error message
            webHook: { skip, limit },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getWebHookMonitor' does not exist on typ... Remove this comment to see the full error message
            getWebHookMonitor,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getWebHook' does not exist on type 'Read... Remove this comment to see the full error message
            getWebHook,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
            paginate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
            monitorId,
        } = this.props;

        if (monitorId) {
            getWebHookMonitor(
                projectId,
                monitorId,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            getWebHook(
                projectId,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        }

        paginate('prev');
    };

    nextClicked = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'webHook' does not exist on type 'Readonl... Remove this comment to see the full error message
            webHook: { skip, limit },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getWebHookMonitor' does not exist on typ... Remove this comment to see the full error message
            getWebHookMonitor,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
            paginate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
            monitorId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getWebHook' does not exist on type 'Read... Remove this comment to see the full error message
            getWebHook,
        } = this.props;

        if (monitorId) {
            getWebHookMonitor(projectId, monitorId, skip + limit, 10);
        } else {
            getWebHook(projectId, skip + limit, 10);
        }
        paginate('next');
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'webHook' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { webHook, isRequesting, monitorId } = this.props;
        const { count, skip, limit } = webHook;
        let { webHooks } = webHook;
        let canPaginateForward =
            webHook && count && count > skip + limit ? true : false;
        let canPaginateBackward = webHook && skip && skip > 0 ? true : false;
        if (monitorId && webHooks) {
            webHooks = webHooks.filter((hook: $TSFixMe) => hook.monitors.some((mon: $TSFixMe) => mon.monitorId._id === monitorId)
            );
        }
        const numberOfWebHooks = webHooks ? webHooks.length : 0;

        if (webHook && (webHook.requesting || !webHook.webHooks)) {
            canPaginateForward = false;
            canPaginateBackward = false;
        }
        const numberOfPages = Math.ceil(parseInt(count) / limit);
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
                                <WebHookTableHeader text="Type" />
                                <WebHookTableHeader
                                    text="Action"
                                    name="webhooklist"
                                />
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            <ShouldRender if={numberOfWebHooks > 0}>
                                {(webHooks ? webHooks : []).map((hook: $TSFixMe) => <WebHookItem
                                    key={`${hook._id}`}
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ key: string; data: any; monitorId: any; mo... Remove this comment to see the full error message
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
                                    {numberOfPages > 0
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                        ? `Page ${this.props.page &&
                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                              this.props.page
                                                  .counter} of ${numberOfPages} (${count} Webhook${
                                              count === 1 ? '' : 's'
                                          })`
                                        : `${count} Webhook${
                                              count === 1 ? '' : 's'
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
                                    className={`Button bs-ButtonLegacy ${
                                        !canPaginateBackward
                                            ? 'Is--disabled'
                                            : ''
                                    }`}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    disabled={!canPaginateBackward}
                                    type="button"
                                    onClick={this.prevClicked}
                                    id="btnPrevWebhook"
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
                                    id="btnNextWebhook"
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
WebHookList.displayName = 'WebHookList';

const mapStateToProps = (state: $TSFixMe) => ({
    webHook: state.webHooks.webHook,
    page: state.webHooks.pages,
    isRequesting: state.webHooks.webHook.requesting,
    currentProject: state.project.currentProject,

    projectId:
        (state.project.currentProject && state.project.currentProject._id) ||
        User.getCurrentProjectId(),

    monitor: state.monitor
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        getWebHookMonitor,
        getWebHook,
        getWebHookError,
        getWebHookRequest,
        getWebHookSuccess,
        paginate,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
WebHookList.propTypes = {
    getWebHookMonitor: PropTypes.func,
    projectId: PropTypes.string,
    monitorId: PropTypes.string,
    isRequesting: PropTypes.bool,
    webHook: PropTypes.any,
    paginate: PropTypes.func.isRequired,
    page: PropTypes.any,
    getWebHook: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(WebHookList);
