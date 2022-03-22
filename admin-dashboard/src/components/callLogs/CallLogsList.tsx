import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';

import { ListLoader } from '../basic/Loader';
import { openModal, closeModal } from '../../actions/modal';
import CallLogsContentViewModal from './CallLogsContentViewModal';
import CallLogsErrorViewModal from './CallLogsErrorViewModal';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import { history } from '../../store';

export class CallLogsList extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { deleteModalId: uuidv4() };
    }

    handleDelete = () => {

        const { openModal } = this.props;

        const { deleteModalId } = this.state;
        openModal({
            id: deleteModalId,
            content: DeleteConfirmationModal,
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };

    render() {
        if (

            this.props.callLogs &&

            this.props.callLogs.skip &&

            typeof this.props.callLogs.skip === 'string'
        ) {

            this.props.callLogs.skip = parseInt(this.props.callLogs.skip, 10);
        }
        if (

            this.props.callLogs &&

            this.props.callLogs.limit &&

            typeof this.props.callLogs.limit === 'string'
        ) {

            this.props.callLogs.limit = parseInt(this.props.callLogs.limit, 10);
        }

        if (!this.props.callLogs.skip) this.props.callLogs.skip = 0;

        if (!this.props.callLogs.limit) this.props.callLogs.limit = 0;

        let canNext =

            this.props.callLogs &&

                this.props.callLogs.count &&

                this.props.callLogs.count >

                this.props.callLogs.skip + this.props.callLogs.limit
                ? true
                : false;
        let canPrev =

            this.props.callLogs && this.props.callLogs.skip <= 0 ? false : true;

        if (

            this.props.callLogs &&

            (this.props.requesting || !this.props.callLogs.callLogs)
        ) {
            canNext = false;
            canPrev = false;
        }
        const numberOfPages = Math.ceil(

            parseInt(this.props.callLogs && this.props.callLogs.count) / 10
        );
        return (
            <div onKeyDown={this.handleKeyBoard}>
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
                                            <span>Status</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Project Name</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>From</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>To</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Date/Time</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div
                                        className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                        style={{ float: 'right' }}
                                    >
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Actions</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">

                            {this.props.requesting ? (
                                <Fragment>
                                    <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
                                        <td
                                            colSpan={7}
                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root">
                                                            <ListLoader />
                                                        </div>
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </Fragment>

                            ) : this.props.callLogs &&

                                this.props.callLogs.callLogs &&

                                this.props.callLogs.callLogs.length > 0 ? (

                                this.props.callLogs.callLogs.map((callLog: $TSFixMe) => {
                                    return (
                                        <tr
                                            key={callLog._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent"
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16">
                                                            <div
                                                                className={`Badge Badge--color--${callLog.status ===
                                                                        'Success'
                                                                        ? 'green'
                                                                        : 'red'
                                                                    } Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                            >
                                                                <span
                                                                    className={`Badge-text Text-color--${callLog.status ===
                                                                            'Success'
                                                                            ? 'green'
                                                                            : 'red'
                                                                        } Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
                                                                >
                                                                    <span>
                                                                        {callLog.status
                                                                            ? callLog.status
                                                                            : 'N/A'}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    cursor: 'pointer',

                                                    textDecoration: callLog.projectId
                                                        ? 'underline'
                                                        : null,
                                                }}
                                                onClick={() => {
                                                    history.push(
                                                        '/admin/projects/' +
                                                        callLog.projectId
                                                            ._id
                                                    );
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root">
                                                                <span>
                                                                    {callLog.projectId
                                                                        ? callLog
                                                                            .projectId
                                                                            .name
                                                                        : 'N/A'}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root">
                                                                <span>
                                                                    {callLog.from
                                                                        ? callLog.from
                                                                        : 'N/A'}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex-flex">
                                                                <span>
                                                                    {callLog.to
                                                                        ? callLog.to
                                                                        : 'N/A'}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex-flex">
                                                                <span>
                                                                    {callLog.createdAt
                                                                        ? moment
                                                                            .utc(
                                                                                callLog.createdAt
                                                                            )
                                                                            .local()
                                                                            .format(
                                                                                'ddd, YYYY/MM/DD, h:mm:ss'
                                                                            )
                                                                        : 'N/A'}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div
                                                        className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                                        style={{
                                                            float: 'right',
                                                        }}
                                                    >
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root">
                                                                <span>
                                                                    <button
                                                                        onClick={() => {

                                                                            this.props.openModal(
                                                                                {
                                                                                    id: uuidv4(),
                                                                                    onConfirm: () => {
                                                                                        return Promise.resolve();
                                                                                    },
                                                                                    content: (props: $TSFixMe) => <CallLogsContentViewModal
                                                                                        {...props}
                                                                                        content={
                                                                                            callLog.content
                                                                                        }
                                                                                    />,
                                                                                }
                                                                            );
                                                                        }}
                                                                        id="view"
                                                                        className="bs-Button"
                                                                    >
                                                                        <span>
                                                                            View
                                                                            Content
                                                                        </span>
                                                                    </button>
                                                                    {callLog.error ? (
                                                                        <button
                                                                            onClick={() => {

                                                                                this.props.openModal(
                                                                                    {
                                                                                        id: uuidv4(),
                                                                                        onConfirm: () => {
                                                                                            return Promise.resolve();
                                                                                        },
                                                                                        content: (props: $TSFixMe) => <CallLogsErrorViewModal
                                                                                            {...props}
                                                                                            content={
                                                                                                callLog.error
                                                                                            }
                                                                                        />,
                                                                                    }
                                                                                );
                                                                            }}
                                                                            id="view"
                                                                            className="bs-Button"
                                                                        >
                                                                            <span>
                                                                                View
                                                                                Error
                                                                            </span>
                                                                        </button>
                                                                    ) : null}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div
                    id="logsStatus"
                    style={{ textAlign: 'center', marginTop: '10px' }}
                >

                    {this.props.callLogs &&

                        (!this.props.callLogs.callLogs ||

                            !this.props.callLogs.callLogs.length) &&

                        !this.props.requesting &&

                        !this.props.callLogs.error
                        ? "We don't have any logs yet"
                        : null}

                    {this.props.callLogs && this.props.callLogs.error

                        ? this.props.callLogs.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span
                                    id="log-count"
                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                >

                                    {this.props.callLogs &&

                                        this.props.callLogs.count
                                        ? `Page ${this.props.page
                                        } of ${numberOfPages} (${this.props

                                            .callLogs &&

                                        this.props.callLogs.count} Log${this.props.callLogs &&

                                            this.props.callLogs.count === 1
                                            ? ''
                                            : 's'
                                        })`
                                        : null}
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    onClick={() => {

                                        this.props.prevClicked(

                                            this.props.callLogs.skip,

                                            this.props.callLogs.limit
                                        );
                                    }}
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
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnNext"
                                    onClick={() => {

                                        this.props.nextClicked(

                                            this.props.callLogs.skip,

                                            this.props.callLogs.limit
                                        );
                                    }}
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
                            <div className="Box-root">
                                <button
                                    id="deleteLog"
                                    onClick={this.handleDelete}
                                    className={'Button bs-ButtonLegacy'}
                                    // data-db-analytics-name="list_view.pagination.next"
                                    type="button"

                                    disabled={this.props.requesting}
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Delete All Logs</span>
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

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ openModal, closeModal }, dispatch);
};

function mapStateToProps(state: $TSFixMe) {
    return {
        users: state.user.users.users,
        deleteRequest: state.callLogs.callLogs.deleteRequest,
    };
}


CallLogsList.displayName = 'ProjectList';


CallLogsList.propTypes = {
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    callLogs: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    requesting: PropTypes.bool,
    openModal: PropTypes.func.isRequired,
    page: PropTypes.number,
};

export default connect(mapStateToProps, mapDispatchToProps)(CallLogsList);
