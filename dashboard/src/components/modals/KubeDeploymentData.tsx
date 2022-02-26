import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import moment from 'moment';

class KubeDeploymentData extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Enter':
            case 'Escape':
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 0 arguments, but got 1.
                return this.handleCloseModal(e);
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal();
    };

    handleKey = (key: $TSFixMe) => {
        switch (key) {
            case 'deploymentName':
                return 'Name';
            case 'readyDeployment':
                return 'Ready Deployment';
            case 'desiredDeployment':
                return 'Desired Deployment';
            case 'deploymentCreationTimestamp':
                return 'Creation Time';
            case 'deploymentResourceVersion':
                return 'Resource Version';
            case 'deploymentSelfLink':
                return 'Self Link';
            case 'deploymentUid':
                return 'UID';
            case 'deploymentNamespace':
                return 'Namespace';
            case 'lastTransitionTime':
                return 'Last Transition Time';
            case 'lastUpdateTime':
                return 'Last Update Time';
            case 'message':
                return 'Message';
            case 'reason':
                return 'Reason';
            case 'status':
                return 'Status';
            case 'type':
                return 'Type';
            // no default
        }
    };

    handleCondition = (deploymentData: $TSFixMe, key: $TSFixMe) => {
        return deploymentData[key].map((condition: $TSFixMe, index: $TSFixMe) => {
            const dataKeys = Object.keys(condition);
            return (
                <div
                    key={index}
                    style={{
                        borderBottom: '1px solid #cfd7df80',
                    }}
                >
                    {dataKeys.map(key => {
                        let output = moment(condition[key]);
                        if (output.isValid()) {
                            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Moment'.
                            output = output.format('LLL');
                        } else {
                            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Moment'.
                            output = String(condition[key]);
                        }

                        return (
                            <div
                                key={key}
                                className="scheduled-event-list-item bs-ObjectList-row db-UserListRow"
                                style={{
                                    backgroundColor: 'white',
                                    minHeight: 60,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}
                                id={`deploymentData_item`}
                            >
                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                    <div
                                        className="bs-ObjectList-cell-row"
                                        style={{
                                            fontWeight: 500,
                                        }}
                                    >
                                        {this.handleKey(key)}
                                    </div>
                                </div>
                                <div
                                    className="bs-ObjectList-cell bs-u-v-middle"
                                    style={{ minWidth: 50 }}
                                >
                                    <div
                                        className="bs-ObjectList-cell-row"
                                        style={{
                                            whiteSpace: 'normal',
                                        }}
                                    >
                                        {output}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { data } = this.props;
        const deploymentData = data.data;
        const logTitle = data.data['deploymentName'];

        const dataKeys = Object.keys(deploymentData);

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div
                        className="bs-Modal"
                        style={{ width: '100%', maxWidth: 650 }}
                    >
                        <ClickOutside onClickOutside={this.handleCloseModal}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>{logTitle}</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <div className="bs-ObjectList db-UserList">
                                    <div
                                        style={{
                                            overflow: 'hidden',
                                            overflowX: 'auto',
                                        }}
                                    >
                                        <div
                                            id="scheduledEventsList"
                                            className="bs-ObjectList-rows"
                                        >
                                            {dataKeys.map(key => {
                                                if (
                                                    key ===
                                                    'deploymentConditions'
                                                ) {
                                                    return (
                                                        <>
                                                            <div
                                                                key={key}
                                                                className="scheduled-event-list-item bs-ObjectList-row db-UserListRow"
                                                                style={{
                                                                    backgroundColor:
                                                                        'white',
                                                                    minHeight: 60,
                                                                    borderBottom:
                                                                        '1px solid #cfd7df80',
                                                                    display:
                                                                        'flex',
                                                                    justifyContent:
                                                                        'space-between',
                                                                    alignItems:
                                                                        'center',
                                                                }}
                                                                id={`podData_item`}
                                                            >
                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                    <div
                                                                        className="bs-ObjectList-cell-row"
                                                                        style={{
                                                                            fontWeight: 500,
                                                                        }}
                                                                    >
                                                                        List of
                                                                        All
                                                                        Deployment
                                                                        Conditions
                                                                    </div>
                                                                </div>
                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                    <div className="bs-ObjectList-cell-row"></div>
                                                                </div>
                                                            </div>
                                                            {this.handleCondition(
                                                                deploymentData,
                                                                key
                                                            )}
                                                        </>
                                                    );
                                                }

                                                let output = moment(
                                                    deploymentData[key]
                                                );
                                                if (
                                                    output.isValid() &&
                                                    key !== 'readyDeployment' &&
                                                    key !==
                                                        'desiredDeployment' &&
                                                    key !== 'deploymentName'
                                                ) {
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Moment'.
                                                    output = output.format(
                                                        'LLL'
                                                    );
                                                } else {
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Moment'.
                                                    output = String(
                                                        deploymentData[key]
                                                    );
                                                }
                                                return (
                                                    <div
                                                        key={key}
                                                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow"
                                                        style={{
                                                            backgroundColor:
                                                                'white',
                                                            minHeight: 60,
                                                            borderBottom:
                                                                '1px solid #cfd7df80',
                                                            display: 'flex',
                                                            justifyContent:
                                                                'space-between',
                                                            alignItems:
                                                                'center',
                                                        }}
                                                        id={`deploymentData_item`}
                                                    >
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div
                                                                className="bs-ObjectList-cell-row"
                                                                style={{
                                                                    fontWeight: 500,
                                                                }}
                                                            >
                                                                {this.handleKey(
                                                                    key
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div
                                                                className="bs-ObjectList-cell-row"
                                                                style={{
                                                                    whiteSpace:
                                                                        'normal',
                                                                }}
                                                            >
                                                                {output}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        id="okBtn"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                        type="submit"
                                        onClick={this.handleCloseModal}
                                    >
                                        <>
                                            <span>Ok</span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
                                        </>
                                    </button>
                                </div>
                            </div>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
KubeDeploymentData.displayName = 'KubeDeploymentData';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
KubeDeploymentData.propTypes = {
    closeModal: PropTypes.func.isRequired,
    data: PropTypes.object,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        closeModal,
    },
    dispatch
);

export default connect(null, mapDispatchToProps)(KubeDeploymentData);
