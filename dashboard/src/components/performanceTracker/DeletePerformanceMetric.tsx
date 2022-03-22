import React, { Component } from 'react';
import ShouldRender from '../basic/ShouldRender';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'common-ui/actions/modal';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import {
    deleteIncomingMetrics,
    deleteOutgoingMetrics,
    fetchIncomingMetrics,
    fetchOutgoingMetrics,
} from '../../actions/performanceTrackerMetric';

class DeletePerformanceMetric extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal();
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleDelete = () => {
        const {

            closeModal,

            data,

            deleteIncomingMetrics,

            deleteOutgoingMetrics,

            fetchIncomingMetrics,

            fetchOutgoingMetrics,
        } = this.props;

        const {
            appId,
            key,
            metricId,
            type,
            skip,
            limit,
            startDate,
            endDate,
        } = data;

        if (type === 'incoming') {
            deleteIncomingMetrics({
                appId,
                key,
                metricId,
            }).then(() => {
                fetchIncomingMetrics({
                    appId,
                    key,
                    skip,
                    limit,
                    startDate,
                    endDate,
                });
                closeModal();
            });
        }
        if (type === 'outgoing') {
            deleteOutgoingMetrics({
                appId,
                key,
                metricId,
            }).then(() => {
                fetchOutgoingMetrics({
                    appId,
                    key,
                    skip,
                    limit,
                    startDate,
                    endDate,
                });
                closeModal();
            });
        }
    };

    render() {
        const {

            closeModal,

            data,

            incomingMetrics,

            outgoingMetrics,
        } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeModal}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Deletion</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    {data.type === 'incoming' && (
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            Are you sure you want to delete
                                            incoming performance metrics ?
                                        </span>
                                    )}
                                    {data.type === 'outgoing' && (
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            Are you sure you want to delete
                                            outgoing performance metrics ?
                                        </span>
                                    )}
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={
                                                data.type === 'incoming' &&
                                                !incomingMetrics.requesting &&
                                                incomingMetrics.error
                                            }
                                        >
                                            <div
                                                id="deleteCardError"
                                                className="bs-Tail-copy"
                                            >
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {
                                                                incomingMetrics.error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                data.type === 'outgoing' &&
                                                !outgoingMetrics.requesting &&
                                                outgoingMetrics.error
                                            }
                                        >
                                            <div
                                                id="deleteCardError"
                                                className="bs-Tail-copy"
                                            >
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {
                                                                outgoingMetrics.error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={closeModal}
                                            id="cancelApplicationSecurityModalBtn"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <ShouldRender
                                            if={data.type === 'incoming'}
                                        >
                                            <button
                                                id="deleteApplicationSecurityModalBtn"
                                                className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                                type="button"
                                                onClick={this.handleDelete}
                                                disabled={
                                                    incomingMetrics.requesting
                                                }
                                                autoFocus={true}
                                            >
                                                {!incomingMetrics.requesting && (
                                                    <>
                                                        <span>Delete</span>
                                                        <span className="delete-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                                {incomingMetrics.requesting && (
                                                    <FormLoader />
                                                )}
                                            </button>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={data.type === 'outgoing'}
                                        >
                                            <button
                                                id="deleteApplicationSecurityModalBtn"
                                                className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                                type="button"
                                                onClick={this.handleDelete}
                                                disabled={
                                                    outgoingMetrics.requesting
                                                }
                                                autoFocus={true}
                                            >
                                                {!outgoingMetrics.requesting && (
                                                    <>
                                                        <span>Delete</span>
                                                        <span className="delete-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                                {outgoingMetrics.requesting && (
                                                    <FormLoader />
                                                )}
                                            </button>
                                        </ShouldRender>
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

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        deleteIncomingMetrics,
        deleteOutgoingMetrics,
        fetchIncomingMetrics,
        fetchOutgoingMetrics,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        performanceTracker:
            state.performanceTracker.fetchPerformanceTracker &&
            state.performanceTracker.fetchPerformanceTracker.performanceTracker,
        incomingMetrics: state.performanceTrackerMetric.deleteIncomingMetrics,
        outgoingMetrics: state.performanceTrackerMetric.deleteOutgoingMetrics,
        data: state.modal.modals[0],
    };
};


DeletePerformanceMetric.propTypes = {
    closeModal: PropTypes.func.isRequired,
    data: PropTypes.object,
    incomingMetrics: PropTypes.object,
    outgoingMetrics: PropTypes.object,
    deleteIncomingMetrics: PropTypes.func,
    deleteOutgoingMetrics: PropTypes.func,
    fetchIncomingMetrics: PropTypes.func,
    fetchOutgoingMetrics: PropTypes.func,
};


DeletePerformanceMetric.displayName = 'DeletePerformanceMetric';

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DeletePerformanceMetric);
