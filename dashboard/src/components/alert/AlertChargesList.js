import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { ListLoader } from '../basic/Loader';
import moment from 'moment';
import { fetchAlertCharges } from '../../actions/alert';
import { history } from '../../store';


export class AlertChargesList extends Component {

    constructor(props) {
        super(props);
        this.props = props;
    }
    componentDidMount() {
        const { fetchAlertCharges } = this.props;
        let { projectId } = this.props;
        if (!projectId) {
            projectId = history.location.pathname.split('project/')[1].split('/')[0];
            fetchAlertCharges(projectId, 0, 5);
        } else {
            fetchAlertCharges(projectId, 0, 5);
        }
    }

    prevClicked = () => {
        const { fetchAlertCharges, projectId, skip } = this.props;
        fetchAlertCharges(projectId, (skip ? (parseInt(skip, 10) - 5) : 5), 5);
    }

    nextClicked = () => {
        const { fetchAlertCharges, projectId, skip } = this.props;
        fetchAlertCharges(projectId, (skip ? (parseInt(skip, 10) + 5) : 5), 5);
    }

    render() {
        const { alertCharges, error, isRequesting, count, skip, limit, projectId } = this.props;
        const canNext = (count > (parseInt(skip) + parseInt(limit))) ? true : false;
        const canPrev = (parseInt(skip) <= 0) ? false : true;
        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Monitor Name</span></span></div>
                                </td>
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Incident ID</span></span></div>
                                </td>
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Time</span></span></div>
                                </td>
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Alert Type</span></span></div>
                                </td>
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Alert Charge($)</span></span></div>
                                </td>
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Closing Balance($)</span></span></div>
                                </td>
                            </tr>
                        </thead>
                        <tbody>
                            {!isRequesting && alertCharges && alertCharges.length > 0 &&
                                alertCharges.map(alertCharge =>
                                    <tr className="Table-row db-ListViewItem bs-ActionsParent" key={alertCharge.alertId._id}>
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord db-ListViewItem--hasLink" style={{ height: '1px' }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--cyan">
                                                    <div onClick={() => { history.push('/project/' + projectId + '/monitors/' + alertCharge.monitorId._id) }} className="Box-root Margin-right--16"><span>{alertCharge.monitorId.name}</span></div>
                                                </span>
                                            </div>
                                        </td>
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord db-ListViewItem--hasLink" style={{ height: '1px', minWidth: '180px' }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--cyan">
                                                    <div onClick={() => { history.push('/project/' + projectId + '/incidents/' + alertCharge.incidentId) }} className="Box-root Margin-right--16"><span>{alertCharge.incidentId}</span></div>
                                                </span>
                                            </div>
                                        </td>
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ height: '1px', minWidth: '150px' }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Margin-right--16"><span>{moment(alertCharge.createdAt).format('lll')}</span></div>
                                                </span>
                                            </div>
                                        </td>
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ height: '1px', minWidth: '100px' }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Margin-right--16"><span>{alertCharge.alertId.alertVia}</span></div>
                                                </span>
                                            </div>
                                        </td>
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ height: '1px', minWidth: '100px' }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Margin-right--16"><span>{alertCharge.chargeAmount}</span></div>
                                                </span>
                                            </div>
                                        </td>
                                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ height: '1px', minWidth: '100px' }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Margin-right--16"><span>{alertCharge.closingAccountBalance}</span></div>
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            }
                        </tbody>

                    </table>
                </div>
                {isRequesting ? <ListLoader /> : null}
                <div style={{ textAlign: 'center', marginTop: '10px', padding: '0 10px' }}>
                    {(!alertCharges || alertCharges.length === 0) && !isRequesting && !error ? 'No Alert charge' : null}
                    {error && error ? error : null}
                    {error && error === 'You cannot edit the project because you\'re not an owner.' ? 'Alert Charges are available to only owners.' : error}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">{count ? count + (count && count > 1 ? ' Alerts' : ' Alert ') : null}</span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button onClick={() => this.prevClicked()} id="btnPrev" className={'Button bs-ButtonLegacy' + (canPrev ? '' : 'Is--disabled')} disabled={!canPrev} data-db-analytics-name="list_view.pagination.previous" type="button">
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Previous</span></span></div>
                                </button>
                            </div>
                            <div className="Box-root">
                                <button onClick={() => this.nextClicked()} id="btnNext" className={'Button bs-ButtonLegacy' + (canNext ? '' : 'Is--disabled')} disabled={!canNext} data-db-analytics-name="list_view.pagination.next" type="button">
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Next</span></span></div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ fetchAlertCharges }, dispatch)
}

const mapStateToProps = state => {
    return {
        projectId: state.project.currentProject !== null && state.project.currentProject._id,
        alertCharges: state.alert.alertCharges !== null && state.alert.alertCharges.data,
        isRequesting: state.alert.alertCharges !== null && state.alert.alertCharges.requesting,
        skip: state.alert.alertCharges !== null && state.alert.alertCharges.skip,
        limit: state.alert.alertCharges !== null && state.alert.alertCharges.limit,
        success: state.alert.alertCharges !== null && state.alert.alertCharges.success,
        error: state.alert.alertCharges !== null && state.alert.alertCharges.error,
        count: state.alert.alertCharges !== null && state.alert.alertCharges.count
    }
}

AlertChargesList.propTypes = {
    alertCharges: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null, undefined])
    ]),
    isRequesting: PropTypes.bool,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    projectId: PropTypes.string,
    skip: PropTypes.number,
    limit: PropTypes.number,
    count: PropTypes.number,
    fetchAlertCharges: PropTypes.func.isRequired
}

AlertChargesList.displayName = 'AlertChargesList';

export default connect(mapStateToProps, mapDispatchToProps)(AlertChargesList);
