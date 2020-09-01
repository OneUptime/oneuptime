import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';

class AlertDetailsModal extends Component {
    render() {
        const { closeThisDialog } = this.props;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
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
                                        <div>{this.props.data.monitor}</div>
                                    </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">
                                        Subscriber
                                    </label>
                                    <div className="bs-Fieldset-fields Margin-top--6">
                                        <div>{this.props.data.subscriber}</div>
                                    </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">
                                        Alert via
                                    </label>
                                    <div className="bs-Fieldset-fields Margin-top--6">
                                        <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                <span>
                                                    {this.props.data.alertVia}
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
                                        {this.props.data.eventType ===
                                            'acknowledged' && (
                                            <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    {this.props.data.eventType}
                                                </span>
                                            </div>
                                        )}
                                        {this.props.data.eventType ===
                                            'resolved' && (
                                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    {this.props.data.eventType}
                                                </span>
                                            </div>
                                        )}
                                        {this.props.data.eventType ===
                                            'identified' && (
                                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    {this.props.data.eventType}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">
                                        Created At
                                    </label>
                                    <div className="bs-Fieldset-fields Margin-top--6">
                                        <div>
                                            {moment(
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
                                    className="bs-Button bs-DeprecatedButton"
                                    type="button"
                                    onClick={closeThisDialog}
                                >
                                    <span>Close</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

AlertDetailsModal.displayName = 'AlertDetailsModal';
AlertDetailsModal.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
};

export default AlertDetailsModal;
