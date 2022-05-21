import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'CommonUI/actions/Modal';
import moment from 'moment';

interface KubeJobDataProps {
    closeModal: Function;
    data?: object;
}

class KubeJobData extends React.Component<KubeJobDataProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Enter':
            case 'Escape':

                return this.handleCloseModal(e);
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal();
    };

    handleKey = (key: $TSFixMe) => {
        switch (key) {
            case 'jobName':
                return 'Name';
            case 'jobStatus':
                return 'Status';
            case 'jobCreationTimestamp':
                return 'Creation Time';
            case 'jobNamespace':
                return 'Namespace';
            case 'jobResourceVersion':
                return 'Resource Version';
            case 'jobSelfLink':
                return 'Self Link';
            case 'jobUid':
                return 'UID';
            case 'lastTransitionTime':
                return 'Last Transition Time';
            case 'lastProbeTime':
                return 'Last Probe Time';
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

    handleCondition = (jobData: $TSFixMe, key: $TSFixMe) => {
        return jobData[key].map((condition: $TSFixMe, index: $TSFixMe) => {
            const dataKeys: $TSFixMe = Object.keys(condition);
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

                            output = output.format('LLL');
                        } else {

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
                                id={`jobData_item`}
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

    override render() {

        const { data }: $TSFixMe = this.props;
        const jobData: $TSFixMe = data.data;
        const logTitle: $TSFixMe = data.data['jobName'];

        const dataKeys: $TSFixMe = Object.keys(jobData);

        return (
            <div
                className="ModalLayer-contents"

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
                                                if (key === 'jobConditions') {
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
                                                                        All Job
                                                                        Conditions
                                                                    </div>
                                                                </div>
                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                    <div className="bs-ObjectList-cell-row"></div>
                                                                </div>
                                                            </div>
                                                            {this.handleCondition(
                                                                jobData,
                                                                key
                                                            )}
                                                        </>
                                                    );
                                                }

                                                let output = moment(
                                                    jobData[key]
                                                );
                                                if (
                                                    output.isValid() &&
                                                    key !==
                                                    'jobResourceVersion' &&
                                                    key !== 'jobName'
                                                ) {

                                                    output = output.format(
                                                        'LLL'
                                                    );
                                                } else {

                                                    output = String(
                                                        jobData[key]
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
                                                        id={`jobData_item`}
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
                                                        <div
                                                            className="bs-ObjectList-cell bs-u-v-middle"
                                                            style={{
                                                                minWidth: 50,
                                                            }}
                                                        >
                                                            <div
                                                                className="bs-ObjectList-cell-row"
                                                                style={{
                                                                    textAlign:
                                                                        'right',
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


KubeJobData.displayName = 'KubeJobData';


KubeJobData.propTypes = {
    closeModal: PropTypes.func.isRequired,
    data: PropTypes.object,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
    },
    dispatch
);

export default connect(null, mapDispatchToProps)(KubeJobData);
