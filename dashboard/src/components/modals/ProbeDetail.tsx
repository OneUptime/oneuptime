import React, { Component } from 'react';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
import moment from 'moment';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ProbeStatus from '../probe/ProbeStatus';
import ShouldRender from '../basic/ShouldRender';
import { IS_SAAS_SERVICE } from '../../config';

class ProbeDetail extends Component {
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
                return this.handleCloseModal();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.props.data.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            id: this.props.data.ProbeDetailModalId,
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { ProbeDetailModalId, closeModal, probesData } = this.props.data;
        const isOffline =
            (probesData.lastAlive &&
                moment(Date.now()).diff(
                    moment(probesData.lastAlive),
                    'seconds'
                ) >= 300) ||
            !probesData.lastAlive;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Probe Details</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span
                                        id="message-modal-message"
                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                    >
                                        <div className="Flex-flex Flex-direction--row">
                                            <span className="Flex-flex--1">
                                                Probe Name:{' '}
                                            </span>
                                            <span className="Flex-flex--3">
                                                {probesData.probeName}
                                            </span>
                                        </div>
                                        <div className="Flex-flex Flex-direction--row">
                                            <span className="Flex-flex--1">
                                                Last Active:{' '}
                                            </span>
                                            <span className="Flex-flex--3">
                                                {probesData.lastAlive
                                                    ? moment(
                                                          probesData.lastAlive
                                                      ).format(
                                                          'dddd, MMMM Do YYYY, h:mm a'
                                                      )
                                                    : ''}
                                            </span>
                                        </div>
                                        <div className="Flex-flex Flex-direction--row">
                                            <span className="Flex-flex--1">
                                                Status:
                                            </span>
                                            <span className="Flex-flex--3">
                                                <ProbeStatus
                                                    lastAlive={
                                                        probesData &&
                                                        probesData.lastAlive
                                                    }
                                                />
                                            </span>
                                        </div>
                                        <ShouldRender
                                            if={IS_SAAS_SERVICE && isOffline}
                                        >
                                            <div className="Padding-top--16">
                                                <span>
                                                    Probe is currently offline,
                                                    please contact your
                                                    administrator for more info.
                                                </span>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={!IS_SAAS_SERVICE && isOffline}
                                        >
                                            <div className="Padding-top--16">
                                                <span>
                                                    Probe is currently offline,
                                                    please contact{' '}
                                                    <span className="Text-fontWeight--medium underline">
                                                        <a href="mailto: support@oneuptime.com">
                                                            support@oneuptime.com
                                                        </a>
                                                    </span>{' '}
                                                    for more info.
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--white btn__modal"
                                            type="button"
                                            id="modal-ok"
                                            onClick={() =>
                                                closeModal({
                                                    id: ProbeDetailModalId,
                                                })
                                            }
                                            autoFocus={true}
                                        >
                                            <span>OK</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ProbeDetail.displayName = 'ProbeDetail';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ProbeDetail.propTypes = {
    data: PropTypes.shape({
        ProbeDetailModalId: PropTypes.string,
        closeModal: PropTypes.func,
        probesData: PropTypes.shape({
            probeName: PropTypes.string,
            lastAlive: PropTypes.string,
        }),
    }),
};

export default ProbeDetail;
