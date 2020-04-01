import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import uuid from 'uuid';

import { ListLoader } from '../basic/Loader';
import { openModal, closeModal } from '../../actions/modal';
import { deleteAuditLogs } from '../../actions/auditLogs';
import AuditLogsJsonViewModal from './AuditLogsJsonViewModal';
import DeleteConfirmationModal from './DeleteConfirmationModal';

export class AuditLogsList extends Component {
    constructor(props) {
        super(props);
        this.state = { deleteModalId: uuid.v4() };
    }

    handleDelete = () => {
        const { deleteAuditLogs } = this.props;
        const thisObj = this;
        const { deleteModalId } = this.state;
        this.props.openModal({
            id: deleteModalId,
            onConfirm: () => {
                return deleteAuditLogs().then(() => {
                    if (window.location.href.indexOf('localhost') <= -1) {
                        thisObj.context.mixpanel.track('Audit Log Deleted');
                    }
                });
            },
            content: DeleteConfirmationModal,
        });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };

    render() {
        if (
            this.props.auditLogs &&
            this.props.auditLogs.skip &&
            typeof this.props.auditLogs.skip === 'string'
        ) {
            this.props.auditLogs.skip = parseInt(this.props.auditLogs.skip, 10);
        }
        if (
            this.props.auditLogs &&
            this.props.auditLogs.limit &&
            typeof this.props.auditLogs.limit === 'string'
        ) {
            this.props.auditLogs.limit = parseInt(
                this.props.auditLogs.limit,
                10
            );
        }
        if (!this.props.auditLogs.skip) this.props.auditLogs.skip = 0;
        if (!this.props.auditLogs.limit) this.props.auditLogs.limit = 0;

        let canNext =
            this.props.auditLogs &&
            this.props.auditLogs.count &&
            this.props.auditLogs.count >
                this.props.auditLogs.skip + this.props.auditLogs.limit
                ? true
                : false;
        let canPrev =
            this.props.auditLogs && this.props.auditLogs.skip <= 0
                ? false
                : true;

        if (
            this.props.auditLogs &&
            (this.props.requesting || !this.props.auditLogs.auditLogs)
        ) {
            canNext = false;
            canPrev = false;
        }
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
                                            <span>User</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '200px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>API URL</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--center Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>View JSON</span>
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
                            ) : this.props.auditLogs &&
                              this.props.auditLogs.auditLogs &&
                              this.props.auditLogs.auditLogs.length > 0 ? (
                                this.props.auditLogs.auditLogs.map(auditLog => {
                                    return (
                                        <tr
                                            key={auditLog._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent"
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16">
                                                            <span>
                                                                {auditLog.projectId
                                                                    ? auditLog
                                                                          .projectId
                                                                          .name
                                                                    : 'N/A'}
                                                            </span>
                                                        </div>
                                                    </span>
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
                                                                    {auditLog.userId
                                                                        ? auditLog
                                                                              .userId
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
                                                            <div className="Box-root Flex-flex">
                                                                <span>
                                                                    {auditLog.request &&
                                                                    auditLog
                                                                        .request
                                                                        .apiSection
                                                                        ? auditLog
                                                                              .request
                                                                              .apiSection
                                                                        : ''}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            <td
                                                className="Table-cell Table-cell--align--center Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root">
                                                                <span>
                                                                    <button
                                                                        onClick={() => {
                                                                            this.props.openModal(
                                                                                {
                                                                                    id: uuid.v4(),
                                                                                    onConfirm: () => {
                                                                                        return Promise.resolve();
                                                                                    },
                                                                                    content: props => (
                                                                                        <AuditLogsJsonViewModal
                                                                                            {...props}
                                                                                            reqLog={
                                                                                                auditLog.request
                                                                                            }
                                                                                            resLog={
                                                                                                auditLog.response
                                                                                            }
                                                                                        />
                                                                                    ),
                                                                                }
                                                                            );
                                                                        }}
                                                                        id="view"
                                                                        className="bs-Button"
                                                                    >
                                                                        <span>
                                                                            View
                                                                        </span>
                                                                    </button>
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
                <div id="aStatus" style={{ textAlign: 'center', marginTop: '10px' }}>
                    {this.props.auditLogs &&
                    (!this.props.auditLogs.auditLogs ||
                        !this.props.auditLogs.auditLogs.length) &&
                    !this.props.requesting &&
                    !this.props.auditLogs.error
                        ? "We don't have any logs yet"
                        : null}
                    {this.props.auditLogs && this.props.auditLogs.error
                        ? this.props.auditLogs.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {this.props.auditLogs &&
                                    this.props.auditLogs.count
                                        ? this.props.auditLogs.count +
                                          (this.props.auditLogs &&
                                          this.props.auditLogs.count > 1
                                              ? ' Logs'
                                              : ' Log')
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
                                            this.props.auditLogs.skip,
                                            this.props.auditLogs.limit
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
                                            this.props.auditLogs.skip,
                                            this.props.auditLogs.limit
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

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { openModal, closeModal, deleteAuditLogs },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        users: state.user.users.users,
        deleteRequest: state.auditLogs.auditLogs.deleteRequest,
    };
}

AuditLogsList.displayName = 'ProjectList';

AuditLogsList.propTypes = {
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    deleteAuditLogs: PropTypes.func.isRequired,
    auditLogs: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    requesting: PropTypes.bool,
    openModal: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(AuditLogsList);
