import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';

import { ListLoader } from '../basic/Loader';
import { openModal, closeModal } from '../../actions/modal';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import SmsLogsContentViewModal from './SmsLogsContentViewModal';
import SmsLogsErrorViewModal from './SmsLogsErrorViewModal';
import ShouldRender from '../basic/ShouldRender';

import { history } from '../../store';

export class SmsLogsList extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { deleteModalId: uuidv4() };
    }

    handleDelete = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteModalId' does not exist on type 'R... Remove this comment to see the full error message
        const { deleteModalId } = this.state;
        openModal({
            id: deleteModalId,
            content: DeleteConfirmationModal,
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };

    render() {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs.skip &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            typeof this.props.smsLogs.skip === 'string'
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs.skip = parseInt(this.props.smsLogs.skip, 10);
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs.limit &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            typeof this.props.smsLogs.limit === 'string'
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs.limit = parseInt(this.props.smsLogs.limit, 10);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (!this.props.smsLogs.skip) this.props.smsLogs.skip = 0;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (!this.props.smsLogs.limit) this.props.smsLogs.limit = 0;

        let canNext =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs.count &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs.count >
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                this.props.smsLogs.skip + this.props.smsLogs.limit
                ? true
                : false;
        let canPrev =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs && this.props.smsLogs.skip <= 0 ? false : true;

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.smsLogs &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            (this.props.requesting || !this.props.smsLogs.smsLogs)
        ) {
            canNext = false;
            canPrev = false;
        }
        const numberOfPages = Math.ceil(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
            parseInt(this.props.smsLogs && this.props.smsLogs.count) / 10
        );
        return (
            <div onKeyDown={this.handleKeyBoard}>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Status</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Project name</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Users</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Sent to</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Date/Time</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
                            {this.props.requesting ? (
                                <Fragment>
                                    <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
                                        <td
                                            colSpan={7}
                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                            ) : this.props.smsLogs &&
                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                              this.props.smsLogs.smsLogs &&
                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                              this.props.smsLogs.smsLogs.length > 0 ? (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                this.props.smsLogs.smsLogs.map((smsLog: $TSFixMe) => {
                                    return (
                                        <tr
                                            key={smsLog._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent"
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16">
                                                            <div
                                                                className={`Badge Badge--color--${
                                                                    smsLog.status ===
                                                                    'Success'
                                                                        ? 'green'
                                                                        : 'red'
                                                                } Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                            >
                                                                <span
                                                                    className={`Badge-text Text-color--${
                                                                        smsLog.status ===
                                                                        'Success'
                                                                            ? 'green'
                                                                            : 'red'
                                                                    } Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
                                                                >
                                                                    <span>
                                                                        {smsLog.status
                                                                            ? smsLog.status
                                                                            : 'N/A'}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--wrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    cursor: 'pointer',
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | null' is not assignable to type 'Te... Remove this comment to see the full error message
                                                    textDecoration: smsLog.projectId
                                                        ? 'underline'
                                                        : null,
                                                }}
                                                onClick={() => {
                                                    history.push(
                                                        '/admin/projects/' +
                                                            smsLog.projectId._id
                                                    );
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root">
                                                                <span>
                                                                    {smsLog.projectId
                                                                        ? smsLog
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
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                    cursor: 'pointer',
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | null' is not assignable to type 'Te... Remove this comment to see the full error message
                                                    textDecoration: smsLog.userId
                                                        ? 'underline'
                                                        : null,
                                                }}
                                                onClick={() => {
                                                    if (smsLog.userId) {
                                                        history.push(
                                                            '/admin/users/' +
                                                                smsLog.userId
                                                                    ._id
                                                        );
                                                    }
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16">
                                                            <span>
                                                                {smsLog.userId
                                                                    ? smsLog
                                                                          .userId
                                                                          .name
                                                                    : 'N/A'}
                                                            </span>
                                                        </div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--wrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex-flex">
                                                                <span>
                                                                    {smsLog.sentTo
                                                                        ? smsLog.sentTo
                                                                        : 'N/A'}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--wrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex-flex">
                                                                <span>
                                                                    {smsLog.createdAt
                                                                        ? moment
                                                                              .utc(
                                                                                  smsLog.createdAt
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
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                            this.props.openModal(
                                                                                {
                                                                                    id: uuidv4(),
                                                                                    onConfirm: () => {
                                                                                        return Promise.resolve();
                                                                                    },
                                                                                    content: (props: $TSFixMe) => <SmsLogsContentViewModal
                                                                                        {...props}
                                                                                        content={
                                                                                            smsLog.content
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
                                                                    {smsLog.error ? (
                                                                        <button
                                                                            onClick={() => {
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                                this.props.openModal(
                                                                                    {
                                                                                        id: uuidv4(),
                                                                                        onConfirm: () => {
                                                                                            return Promise.resolve();
                                                                                        },
                                                                                        content: (props: $TSFixMe) => <SmsLogsErrorViewModal
                                                                                            {...props}
                                                                                            content={
                                                                                                smsLog.error
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                    {this.props.smsLogs &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                    (!this.props.smsLogs.smsLogs ||
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                        !this.props.smsLogs.smsLogs.length) &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
                    !this.props.requesting &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                    !this.props.smsLogs.error
                        ? "We don't have any logs yet"
                        : null}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                    {this.props.smsLogs && this.props.smsLogs.error
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                        ? this.props.smsLogs.error
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
                                    <ShouldRender
                                        if={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            this.props.smsLogs &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            this.props.smsLogs.count
                                        }
                                    >
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                        Page {this.props.page} of{' '}
                                        {numberOfPages} (
                                        <span id="sms-log-count">
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            {this.props.smsLogs.count}
                                        </span>{' '}
                                        Log
                                        <ShouldRender
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            if={this.props.smsLogs.count > 0}
                                        >
                                            s
                                        </ShouldRender>
                                        )
                                    </ShouldRender>
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'prevClicked' does not exist on type 'Rea... Remove this comment to see the full error message
                                        this.props.prevClicked(
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            this.props.smsLogs.skip,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            this.props.smsLogs.limit
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextClicked' does not exist on type 'Rea... Remove this comment to see the full error message
                                        this.props.nextClicked(
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            this.props.smsLogs.skip,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsLogs' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            this.props.smsLogs.limit
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
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
        deleteRequest: state.smsLogs.smsLogs.deleteRequest,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SmsLogsList.displayName = 'ProjectList';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SmsLogsList.propTypes = {
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    smsLogs: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    requesting: PropTypes.bool,
    openModal: PropTypes.func.isRequired,
    page: PropTypes.number,
};

export default connect(mapStateToProps, mapDispatchToProps)(SmsLogsList);
