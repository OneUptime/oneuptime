import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { ListLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { deleteSubscriber } from '../../actions/subscriber';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';

export class SubscriberList extends Component {

    render() {
        const monitor = this.props.monitorState.monitorsList.monitors.map(monitor =>
            monitor.monitors.find(monitor =>
                monitor._id === this.props.monitorId)).filter(monitor => monitor)[0];
        const subscribers = monitor.subscribers || {};
        const subProjectId = monitor.projectId._id || monitor.projectId;
        if (subscribers && subscribers.skip && typeof subscribers.skip === 'string') {
            subscribers.skip = parseInt(subscribers.skip, 10);
        }
        if (subscribers && subscribers.limit && typeof subscribers.limit === 'string') {
            subscribers.limit = parseInt(subscribers.limit, 10);
        }
        if (!subscribers.skip) subscribers.skip = 0;
        if (!subscribers.limit) subscribers.limit = 0;

        let canNext = (subscribers && subscribers.count) && (subscribers.count > (subscribers.skip + subscribers.limit)) ? true : false;
        let canPrev = (subscribers && subscribers.skip <= 0) ? false : true;

        if (subscribers && (subscribers.requesting || !subscribers.subscribers)) {
            canNext = false;
            canPrev = false;
        }

        let deleting = this.props.delete ? this.props.delete : false;

        return (
            <div className="div">
                <table className="Table" id="subscribersList">
                    <thead className="Table-body">
                        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', minWidth: '270px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Monitor</span></span></div>
                            </td>
                            <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Subscribed From</span></span></div>
                            </td>
                            <td id="placeholder-left" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                            </td>
                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Subscriber</span></span></div>
                            </td>
                            <td id="placeholder-right" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                            </td>
                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Alert Via</span></span></div>
                            </td>
                            <td id="overflow" type="action" className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                            </td>
                            <RenderIfSubProjectAdmin subProjectId={subProjectId}>
                                <td id="overflow" type="action" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">Action</span></div>
                                </td>
                            </RenderIfSubProjectAdmin>
                        </tr>
                    </thead>
                    <tbody className="Table-body">
                        {
                            subscribers && subscribers.subscribers && subscribers.subscribers.length > 0 ? (
                                subscribers.subscribers.map((subscriber) => (
                                    <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink" key={subscriber._id} >
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ height: '1px', minWidth: '270px' }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Margin-right--16"><span>{subscribers.name ? subscribers.name : subscriber.monitorId ? subscriber.monitorId.name : 'Unknown Monitor'}</span></div>
                                                </span>
                                            </div>
                                        </td>
                                        <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                            <div className="db-ListViewItem-link" >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root"><span>{(subscriber.statusPageId !== undefined && subscriber.statusPageId !== null && subscriber.statusPageId.title) || 'Dashboard'}</span></div>
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td aria-hidden="true" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                            <div className="db-ListViewItem-link" >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣</div>
                                            </div>
                                        </td>
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                            <div className="db-ListViewItem-link" >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Flex-flex">
                                                            <div className="Box-root Flex-flex">
                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                    {subscriber.contactWebhook || subscriber.contactEmail || subscriber.contactPhone || ''}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </span>
                                                </div>
                                            </div>
                                        </td>

                                        <td aria-hidden="true" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                            <div className="db-ListViewItem-link" >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣</div>
                                            </div>
                                        </td>
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                            <div className="db-ListViewItem-link" >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <div className="Box-root"><span>{subscriber.alertVia}</span></div>
                                                </div>
                                            </div>
                                        </td>
                                        <td aria-hidden="true" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                            <div className="db-ListViewItem-link" >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣</div>
                                            </div>
                                        </td>
                                        <RenderIfSubProjectAdmin subProjectId={subProjectId}>
                                            <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                                <div className="db-ListViewItem-link" >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <div className="Box-root"><span>
                                                            <button className={deleting ? 'bs-Button bs-Button--blue' : 'bs-Button bs-ButtonLegacy ActionIconParent'} type="button" disabled={deleting}
                                                                onClick={() => this.props.deleteSubscriber(subscriber.projectId._id, subscriber._id)}>
                                                                <ShouldRender if={!deleting}>
                                                                    <span className="bs-Button--icon bs-Button--trash">
                                                                        <span>Remove</span>
                                                                    </span>
                                                                </ShouldRender>
                                                                <ShouldRender if={deleting}>
                                                                    <FormLoader />
                                                                </ShouldRender>
                                                            </button>
                                                        </span></div>
                                                    </div>
                                                </div>
                                            </td>
                                        </RenderIfSubProjectAdmin>
                                    </tr>
                                ))
                            ) :
                                <tr></tr>
                        }
                    </tbody>

                </table>

                {(subscribers && subscribers.requesting) || (this.props.monitorState && this.props.monitorState.fetchMonitorsSubscriberRequest && subscribers.subscribers && subscribers.subscribers[0] && this.props.monitorState.fetchMonitorsSubscriberRequest === subscribers.subscribers[0].monitorId) ? <ListLoader /> : null}

                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    {subscribers && (!subscribers.subscribers || !subscribers.subscribers.length) && !subscribers.requesting && !subscribers.error ? 'We don\'t have any subscribers yet' : null}
                    {subscribers && subscribers.error ? subscribers.error : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">{subscribers && subscribers.count ? subscribers.count + (subscribers && subscribers.count > 1 ? ' Subscribers' : ' Subscriber') : null}</span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button id="btnPrevSubscriber" onClick={this.props.prevClicked} className={'Button bs-ButtonLegacy' + (canPrev ? '' : 'Is--disabled')} disabled={!canPrev} data-db-analytics-name="list_view.pagination.previous" type="button">
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Previous</span></span></div>
                                </button>
                            </div>
                            <div className="Box-root">
                                <button id="btnNextSubscriber" onClick={this.props.nextClicked} className={'Button bs-ButtonLegacy' + (canNext ? '' : 'Is--disabled')} disabled={!canNext} data-db-analytics-name="list_view.pagination.next" type="button">
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Next</span></span></div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ deleteSubscriber }, dispatch)
}

function mapStateToProps(state) {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        delete: state.subscriber.deleteSubscriber.requesting,
    };
}

SubscriberList.displayName = 'SubscriberList'

SubscriberList.propTypes = {
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    monitorId: PropTypes.string.isRequired,
    delete: PropTypes.bool.isRequired,
    deleteSubscriber: PropTypes.func.isRequired,
}

export default connect(mapStateToProps, mapDispatchToProps)(SubscriberList);
