import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { ListLoader } from '../basic/Loader';
import moment from 'moment';
import { fetchAlertCharges } from '../../actions/alert';
import { getProjectBalance } from '../../actions/project';
import { history } from '../../store';

interface AlertChargesListProps {
    alertCharges?: unknown[];
    isRequesting?: boolean;
    error?: string;
    projectId?: string;
    slug?: string;
    skip?: number;
    limit?: number;
    count?: number;
    fetchAlertCharges: Function;
    getProjectBalance?: Function;
}

export class AlertChargesList extends Component<AlertChargesListProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {};
    }
    componentDidMount() {

        const { fetchAlertCharges, getProjectBalance } = this.props;

        let { projectId } = this.props;
        if (!projectId) {
            projectId = history.location.pathname
                .split('project/')[1]
                .split('/')[0];
            fetchAlertCharges(projectId, 0, 5);
        } else {
            fetchAlertCharges(projectId, 0, 5);
        }
        getProjectBalance(projectId);
    }

    prevClicked = () => {

        const { fetchAlertCharges, projectId, skip } = this.props;
        fetchAlertCharges(projectId, skip ? parseInt(skip, 10) - 5 : 5, 5);
        this.setState({

            page: this.state.page === 1 ? 1 : this.state.page - 1,
        });
    };

    nextClicked = () => {

        const { fetchAlertCharges, projectId, skip } = this.props;
        fetchAlertCharges(projectId, skip ? parseInt(skip, 10) + 5 : 5, 5);

        this.setState({ page: !this.state.page ? 2 : this.state.page + 1 });
    };

    render() {
        const {

            alertCharges,

            error,

            isRequesting,

            count,

            skip,

            limit,
        } = this.props;
        const canNext = count > parseInt(skip) + parseInt(limit) ? true : false;
        const canPrev = parseInt(skip) <= 0 ? false : true;
        const numberOfPages = Math.ceil(parseInt(count) / 5);
        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Monitor Name</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Incident ID</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Time</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Alert Type</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Phone Number</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Alert Charge($)</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Closing Balance($)</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody>
                            {!isRequesting &&
                                alertCharges &&
                                alertCharges.length > 0 &&
                                alertCharges.map((alertCharge: $TSFixMe) => <tr
                                    className="Table-row db-ListViewItem bs-ActionsParent"
                                    key={
                                        alertCharge.alertId
                                            ? alertCharge.alertId._id
                                            : alertCharge.subscriberAlertId
                                                ._id
                                    }
                                >
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord db-ListViewItem--hasLink"
                                        style={{ height: '1px' }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--cyan">
                                                <div
                                                    onClick={() => {
                                                        history.push(
                                                            '/dashboard/project/' +
                                                            this.props

                                                                .slug +
                                                            '/component/' +
                                                            alertCharge
                                                                .monitorId
                                                                .componentSlug +
                                                            '/monitoring/' +
                                                            alertCharge
                                                                .monitorId
                                                                .slug
                                                        );
                                                    }}
                                                    className="Box-root Margin-right--16"
                                                >
                                                    <span>
                                                        {
                                                            alertCharge
                                                                .monitorId
                                                                .name
                                                        }
                                                    </span>
                                                </div>
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord db-ListViewItem--hasLink"
                                        style={{
                                            height: '1px',
                                            minWidth: '180px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--cyan">
                                                <div
                                                    onClick={() => {
                                                        history.push(
                                                            '/dashboard/project/' +
                                                            this.props

                                                                .slug +
                                                            '/component/' +
                                                            alertCharge
                                                                .monitorId
                                                                .componentSlug +
                                                            '/incidents/' +
                                                            alertCharge
                                                                .incidentId
                                                                .slug
                                                        );
                                                    }}
                                                    className="Box-root Margin-right--16"
                                                >
                                                    <span
                                                        style={{
                                                            textDecoration:
                                                                'underline',
                                                        }}
                                                    >
                                                        <b>
                                                            {'#'}
                                                            {
                                                                alertCharge
                                                                    .incidentId
                                                                    .idNumber
                                                            }
                                                        </b>
                                                    </span>
                                                </div>
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                        style={{
                                            height: '1px',
                                            minWidth: '150px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <div className="Box-root Margin-right--16">
                                                    <span>
                                                        {moment(
                                                            alertCharge.createdAt
                                                        ).format('lll')}
                                                    </span>
                                                </div>
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                        style={{
                                            height: '1px',
                                            minWidth: '100px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                        <span>
                                                            {alertCharge.alertId
                                                                ? alertCharge
                                                                    .alertId
                                                                    .alertVia
                                                                : alertCharge
                                                                    .subscriberAlertId
                                                                    .alertVia}
                                                        </span>
                                                    </span>
                                                </div>
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                        style={{
                                            height: '1px',
                                            minWidth: '100px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <div className="Box-root Margin-right--16">
                                                    <span>
                                                        {alertCharge.sentTo}
                                                    </span>
                                                </div>
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                        style={{
                                            height: '1px',
                                            minWidth: '100px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <div className="Box-root Margin-right--16">
                                                    <span>
                                                        {
                                                            alertCharge.chargeAmount
                                                        }
                                                    </span>
                                                </div>
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                        style={{
                                            height: '1px',
                                            minWidth: '100px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <div className="Box-root Margin-right--16">
                                                    <span>
                                                        {Number.parseFloat(
                                                            alertCharge.closingAccountBalance
                                                        ).toFixed(2)}
                                                    </span>
                                                </div>
                                            </span>
                                        </div>
                                    </td>
                                </tr>)}
                        </tbody>
                    </table>
                </div>
                {isRequesting ? <ListLoader /> : null}
                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {(!alertCharges || alertCharges.length === 0) &&
                        !isRequesting &&
                        !error
                        ? 'No Alert charge'
                        : null}
                    {error && error ? error : null}
                    {error &&
                        error ===
                        "You cannot edit the project because you're not an owner."
                        ? 'Alert Charges are available to only owners.'
                        : error}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {numberOfPages > 0
                                        ? `Page ${!this.state.page
                                            ? 1

                                            : this.state.page
                                        } of ${numberOfPages} (${count} Alert${count === 1 ? '' : 's'
                                        })`
                                        : `${count} Alert${count === 1 ? '' : 's'
                                        }`}
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    onClick={() => this.prevClicked()}
                                    id="btnPrev"
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canPrev ? '' : 'Is--disabled')
                                    }
                                    disabled={!canPrev}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    type="button"
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
                                    onClick={() => this.nextClicked()}
                                    id="btnNext"
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canNext ? '' : 'Is--disabled')
                                    }
                                    disabled={!canNext}
                                    data-db-analytics-name="list_view.pagination.next"
                                    type="button"
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
            </div>
        );
    }
}

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        { fetchAlertCharges, getProjectBalance },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        slug: state.project.currentProject && state.project.currentProject.slug,
        alertCharges:
            state.alert.alertCharges !== null && state.alert.alertCharges.data,
        isRequesting:
            state.alert.alertCharges !== null &&
            state.alert.alertCharges.requesting,
        skip:
            state.alert.alertCharges !== null && state.alert.alertCharges.skip,
        limit:
            state.alert.alertCharges !== null && state.alert.alertCharges.limit,
        success:
            state.alert.alertCharges !== null &&
            state.alert.alertCharges.success,
        error:
            state.alert.alertCharges !== null && state.alert.alertCharges.error,
        count:
            state.alert.alertCharges !== null && state.alert.alertCharges.count,
    };
};


AlertChargesList.propTypes = {
    alertCharges: PropTypes.array,
    isRequesting: PropTypes.bool,
    error: PropTypes.string,
    projectId: PropTypes.string,
    slug: PropTypes.string,
    skip: PropTypes.number,
    limit: PropTypes.number,
    count: PropTypes.number,
    fetchAlertCharges: PropTypes.func.isRequired,
    getProjectBalance: PropTypes.func,
};


AlertChargesList.displayName = 'AlertChargesList';

export default connect(mapStateToProps, mapDispatchToProps)(AlertChargesList);
