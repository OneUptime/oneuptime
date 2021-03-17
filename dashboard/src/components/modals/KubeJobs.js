import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ClickOutside from 'react-click-outside';
import { closeModal, openModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import KubeIndicator from '../monitor/KubeIndicator';
import DataPathHoC from '../DataPathHoC';
import KubeJobData from './KubeJobData';

class KubeJobs extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Enter':
            case 'Escape':
                return this.handleCloseModal();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.closeModal();
    };

    handleJobData = data => {
        this.props.openModal({
            content: DataPathHoC(KubeJobData, { data }),
        });
    };

    render() {
        const { data } = this.props;
        const jobData = data.data;
        const logTitle = data.title;

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 600 }}>
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
                                                <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                                    <div className="bs-ObjectList-cell">
                                                        Job Name
                                                    </div>
                                                    <div
                                                        className="bs-ObjectList-cell"
                                                        style={{
                                                            marginRight: '10px',
                                                            textAlign: 'right',
                                                        }}
                                                    >
                                                        Status
                                                    </div>
                                                </header>
                                            </ShouldRender>
                                            {jobData &&
                                                jobData.map((data, index) => (
                                                    <div
                                                        key={data._id}
                                                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                        style={{
                                                            backgroundColor:
                                                                'white',
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
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            closeModal,
            openModal,
        },
        dispatch
    );

export default connect(null, mapDispatchToProps)(KubeJobs);
