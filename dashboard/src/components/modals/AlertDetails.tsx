import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';

class AlertDetailsModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    handleMonitorList = (monitors: $TSFixMe) => {
        if (monitors.length === 0) {
            return 'Unknown';
        }
        if (monitors.length === 1) {
            return monitors[0].name;
        }
        if (monitors.length === 2) {
            return `${monitors[0].name} and ${monitors[1].name}`;
        }
        if (monitors.length === 3) {
            return `${monitors[0].name}, ${monitors[1].name} and ${monitors[2].name}`;
        }

        return `${monitors[0].name}, ${monitors[1].name} and ${monitors.length -
            2} others`;
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
        const { closeThisDialog } = this.props;
        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                <ClickOutside onClickOutside={this.props.closeThisDialog}>
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Subscriber Alert Details</span>
                                </span>
                            </div>
                            <div className="bs-Modal-content">
                                <div className="bs-Fieldset-rows">
                                    <div className="bs-Fieldset-row">
                                        <label className="bs-Fieldset-label">
                                            Monitor
                                        </label>
                                        <div className="bs-Fieldset-fields Margin-top--6">
                                            <div>
                                                {this.handleMonitorList(
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                    this.props.data.monitors
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-Fieldset-row">
                                        <label className="bs-Fieldset-label">
                                            Subscriber
                                        </label>
                                        <div className="bs-Fieldset-fields Margin-top--6">
                                            <div id="subscriber">
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {this.props.data.subscriber}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-Fieldset-row">
                                        <label className="bs-Fieldset-label">
                                            Alert via
                                        </label>
                                        <div className="bs-Fieldset-fields Margin-top--6">
                                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    <span id="alertVia">
                                                        {
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                            this.props.data
                                                                .alertVia
                                                        }
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-Fieldset-row">
                                        <label className="bs-Fieldset-label">
                                            Event type
                                        </label>
                                        <div className="bs-Fieldset-fields Margin-top--6">
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                            {this.props.data.eventType ===
                                                'acknowledged' && (
                                                <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                    <span
                                                        id="eventType"
                                                        className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap"
                                                    >
                                                        {
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                            this.props.data
                                                                .eventType
                                                        }
                                                    </span>
                                                </div>
                                            )}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                            {this.props.data.eventType ===
                                                'resolved' && (
                                                <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                    <span
                                                        id="eventType"
                                                        className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap"
                                                    >
                                                        {
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                            this.props.data
                                                                .eventType
                                                        }
                                                    </span>
                                                </div>
                                            )}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                            {this.props.data.eventType ===
                                                'identified' && (
                                                <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                    <span
                                                        id="eventType"
                                                        className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap"
                                                    >
                                                        {
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                            this.props.data
                                                                .eventType
                                                        }
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="bs-Fieldset-row">
                                        <label className="bs-Fieldset-label">
                                            Alert status
                                        </label>
                                        <div className="bs-Fieldset-fields Margin-top--6">
                                            <div>
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {this.props.data.alertStatus ===
                                                    'Pending' && (
                                                    <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span
                                                            id="alertStatus"
                                                            className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap"
                                                        >
                                                            {
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                this.props.data
                                                                    .alertStatus
                                                            }
                                                        </span>
                                                    </div>
                                                )}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {(this.props.data
                                                    .alertStatus ===
                                                    'Success' ||
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                    this.props.data
                                                        .alertStatus ===
                                                        'Sent') && (
                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span
                                                            id="alertStatus"
                                                            className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap"
                                                        >
                                                            Sent
                                                        </span>
                                                    </div>
                                                )}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {this.props.data.alertStatus ===
                                                    'Disabled' && (
                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--16 Padding-vertical--4">
                                                        <span
                                                            id="alertStatus"
                                                            className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper"
                                                        >
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                            {this.props.data
                                                                .eventType ===
                                                            'identified'
                                                                ? 'Create Incident'
                                                                : this.props
                                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                      .data
                                                                      .eventType ===
                                                                  'acknowledged'
                                                                ? 'Acknowledge Incident'
                                                                : 'Resolved Incident'}{' '}
                                                            Notification
                                                            Disabled for
                                                            Subscribers
                                                        </span>
                                                    </div>
                                                )}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {this.props.data.alertStatus ===
                                                    null && (
                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span
                                                            id="alertStatus"
                                                            className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap"
                                                        >
                                                            {'Error'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <ShouldRender
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                        if={this.props.data.errorMessage}
                                    >
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                Error Message
                                            </label>
                                            <div className="bs-Fieldset-fields Margin-top--6">
                                                <div>
                                                    {
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        this.props.data
                                                            .errorMessage
                                                    }
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <div className="bs-Fieldset-row">
                                        <label className="bs-Fieldset-label">
                                            Created At
                                        </label>
                                        <div className="bs-Fieldset-fields Margin-top--6">
                                            <div>
                                                {moment(
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                    this.props.data.createdAt
                                                ).format('lll')}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        id="closeBtn"
                                        className="bs-Button bs-DeprecatedButton btn__modal"
                                        type="button"
                                        onClick={closeThisDialog}
                                        autoFocus={true}
                                    >
                                        <span>Close</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </ClickOutside>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AlertDetailsModal.displayName = 'AlertDetailsModal';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
AlertDetailsModal.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
};

export default AlertDetailsModal;
