import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { closeModal, openModal } from 'CommonUI/actions/Modal';
import ShouldRender from '../basic/ShouldRender';
import KubeIndicator from '../monitor/KubeIndicator';
import DataPathHoC from '../DataPathHoC';
import KubeJobData from './KubeJobData';

interface KubeJobsProps {
    closeModal: Function;
    openModal?: Function;
    data?: object;
    modals?: unknown[];
}

class KubeJobs extends React.Component<KubeJobsProps> {
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
                return this.handleCloseModal();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        /**
         * NORMAL BEHAVIOR:
         * 1. when a user clicks within the modal, the modal should not close
         * 2. when a user clicks outside the modal, the last modal on the stack should close (the currently viewed modal)
         *
         * BUG FIX:
         * a tiny hack to fix issue with closing stacked modals
         * when a user clicks on the modal
         */

        if (this.props.modals.length === 1) {

            this.props.closeModal();
        }
    };

    handleJobData = (data: $TSFixMe) => {

        this.props.openModal({
            id: 'kube_job_data',
            content: DataPathHoC(KubeJobData, { data }),
        });
    };

    override render() {

        const { data }: $TSFixMe = this.props;
        const jobData: $TSFixMe = data.data;
        const logTitle: $TSFixMe = data.title;

        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div
                        className="bs-Modal"
                        style={{ width: '100%', maxWidth: 600 }}
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
                                            <ShouldRender
                                                if={
                                                    jobData &&
                                                    jobData.length > 0
                                                }
                                            >
                                                <header
                                                    className="bs-ObjectList-row bs-ObjectList-row--header"
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent:
                                                            'space-between',
                                                        alignItems: 'center',
                                                    }}
                                                >
                                                    <div className="bs-ObjectList-cell">
                                                        Job Name
                                                    </div>
                                                    <div
                                                        className="bs-ObjectList-cell"
                                                        style={{
                                                            textAlign: 'right',
                                                        }}
                                                    >
                                                        Status
                                                    </div>
                                                </header>
                                            </ShouldRender>
                                            {jobData &&
                                                jobData.map((data: $TSFixMe, index: $TSFixMe) => (
                                                    <div
                                                        key={data._id}
                                                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow"
                                                        style={{
                                                            backgroundColor:
                                                                'white',
                                                            height: 60,
                                                            borderBottom:
                                                                '1px solid #cfd7df80',
                                                            display: 'flex',
                                                            justifyContent:
                                                                'space-between',
                                                            alignItems:
                                                                'center',
                                                            cursor: 'pointer',
                                                        }}
                                                        id={`jobData_${index}`}
                                                        onClick={() =>
                                                            this.handleJobData(
                                                                data
                                                            )
                                                        }
                                                    >
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div className="bs-ObjectList-cell-row">
                                                                <KubeIndicator
                                                                    status={
                                                                        data.jobStatus ===
                                                                            'running' ||
                                                                            data.jobStatus ===
                                                                            'succeeded'
                                                                            ? 'healthy'
                                                                            : 'unhealthy'
                                                                    }

                                                                    index={
                                                                        index
                                                                    }
                                                                />
                                                                {data.jobName}
                                                            </div>
                                                        </div>
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div
                                                                className="bs-ObjectList-cell-row"
                                                                style={{
                                                                    textAlign:
                                                                        'right',
                                                                    textTransform:
                                                                        'capitalize',
                                                                    whiteSpace:
                                                                        'normal',
                                                                }}
                                                            >
                                                                {data.jobStatus}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                    <ShouldRender
                                        if={!jobData || jobData.length === 0}
                                    >
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                            style={{
                                                textAlign: 'center',
                                                backgroundColor: 'white',
                                                padding: '20px 10px',
                                            }}
                                            id="noprojectDomains"
                                        >
                                            <span>
                                                {!jobData ||
                                                    jobData.length === 0
                                                    ? 'Sorry no Job data at this time'
                                                    : null}
                                            </span>
                                        </div>
                                    </ShouldRender>
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


KubeJobs.displayName = 'KubeJobs';


KubeJobs.propTypes = {
    closeModal: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    data: PropTypes.object,
    modals: PropTypes.array,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        openModal,
    },
    dispatch
);

const mapStateToProps: Function = (state: RootState) => ({
    modals: state.modal.modals
});

export default connect(mapStateToProps, mapDispatchToProps)(KubeJobs);
