import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'Common-ui/actions/modal';
import moment from 'moment';

interface KubePodDataProps {
    closeModal: Function;
    data?: object;
}

class KubePodData extends React.Component<KubePodDataProps> {
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
            case 'podName':
                return 'Name';
            case 'podCreationTimestamp':
                return 'Creation Time';
            case 'podStatus':
                return 'Status';
            case 'podRestart':
                return 'Restarts';
            case 'podNamespace':
                return 'Namespace';
            case 'podResourceVersion':
                return 'Resource Version';
            case 'podSelfLink':
                return 'Self Link';
            case 'podUid':
                return 'UID';
            case 'image':
                return 'Container Image';
            case 'ready':
                return 'Container Ready';
            case 'started':
                return 'Container Started';
            case 'name':
                return 'Name';
            case 'finishedAt':
                return 'Finished At';
            case 'reason':
                return 'Reason';
            case 'startedAt':
                return 'Started At';
            case 'env':
                return 'Container ENV';
            case 'ports':
                return 'Container Ports';
            case 'imagePullPolicy':
                return 'Image Pull Policy';
            case 'containerPort':
                return 'Container Port';
            case 'hostPort':
                return 'Host Port';
            case 'protocol':
                return 'Protocol';
            // no default
        }
    };

    handleContainerStatuses = (podData: $TSFixMe, key: $TSFixMe) => {
        return podData[key].map((container: $TSFixMe, index: $TSFixMe) => {
            const dataKeys = Object.keys(container);
            return (
                <div
                    key={index}
                    style={{
                        borderBottom: '1px solid #cfd7df80',
                    }}
                >
                    {dataKeys.map(key => {
                        if (
                            key === 'containerID' ||
                            key === 'imageID' ||
                            key === 'lastState' ||
                            key === 'restartCount'
                        ) {
                            return null;
                        }
                        if (key === 'state') {
                            const containerKeys = Object.keys(container[key]);
                            return containerKeys.map(eachKey => {
                                const stateObj = container[key][eachKey];
                                const valueKeys = Object.keys(stateObj);

                                return valueKeys.map(key => {
                                    let output = moment(stateObj[key]);
                                    if (output.isValid()) {

                                        output = output.format('LLL');
                                    } else {

                                        output = String(stateObj[key]);
                                    }
                                    if (
                                        key === 'finishedAt' ||
                                        key === 'reason' ||
                                        key === 'startedAt'
                                    ) {
                                        return (
                                            <div
                                                key={key}
                                                className="scheduled-event-list-item bs-ObjectList-row db-UserListRow"
                                                style={{
                                                    backgroundColor: 'white',
                                                    minHeight: 60,
                                                    display: 'flex',
                                                    justifyContent:
                                                        'space-between',
                                                    alignItems: 'center',
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
                                                            whiteSpace:
                                                                'normal',
                                                        }}
                                                    >
                                                        {output}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return null;
                                });
                            });
                        }

                        let output = moment(container[key]);
                        if (output.isValid()) {

                            output = output.format('LLL');
                        } else {

                            output = String(container[key]);
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
                                id={`podData_item`}
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
                                        style={{ whiteSpace: 'normal' }}
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

    handlePorts = (ports: $TSFixMe) => {
        return ports.map((port: $TSFixMe) => {
            const portKeys = Object.keys(port);

            return portKeys.map(key => {
                const output = port[key];
                if (
                    key === 'containerPort' ||
                    key === 'hostPort' ||
                    key === 'name' ||
                    key === 'protocol'
                ) {
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
                            id={`podData_item`}
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
                }

                return null;
            });
        });
    };

    handleEnv = (data: $TSFixMe) => {
        return data.map((env: $TSFixMe) => {
            return (
                <div
                    key={env.name}
                    className="scheduled-event-list-item bs-ObjectList-row db-UserListRow"
                    style={{
                        backgroundColor: 'white',
                        minHeight: 60,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
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
                            {env.name}
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
                            {env.value || 'N/A'}
                        </div>
                    </div>
                </div>
            );
        });
    };

    handleContainer = (podData: $TSFixMe, key: $TSFixMe) => {
        return podData[key].map((container: $TSFixMe, index: $TSFixMe) => {
            const dataKeys = Object.keys(container);
            return (
                <div
                    key={index}
                    style={{
                        borderBottom: '1px solid #cfd7df80',
                    }}
                >
                    {dataKeys.map(key => {
                        if (
                            key !== 'env' &&
                            key !== 'image' &&
                            key !== 'ports' &&
                            key !== 'imagePullPolicy'
                        ) {
                            return null;
                        }
                        if (key === 'ports') {
                            return (
                                <>
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
                                        id={`podData_item`}
                                    >
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div
                                                className="bs-ObjectList-cell-row"
                                                style={{
                                                    fontWeight: 500,
                                                }}
                                            >
                                                List of All Container Ports
                                            </div>
                                        </div>
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div className="bs-ObjectList-cell-row"></div>
                                        </div>
                                    </div>
                                    {this.handlePorts(container[key])}
                                </>
                            );
                        }
                        if (key === 'env') {
                            return (
                                <>
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
                                        id={`podData_item`}
                                    >
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div
                                                className="bs-ObjectList-cell-row"
                                                style={{
                                                    fontWeight: 500,
                                                }}
                                            >
                                                List of All Container Env
                                            </div>
                                        </div>
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div className="bs-ObjectList-cell-row"></div>
                                        </div>
                                    </div>
                                    {this.handleEnv(container[key])}
                                </>
                            );
                        }

                        let output = moment(container[key]);
                        if (output.isValid()) {

                            output = output.format('LLL');
                        } else {

                            output = String(container[key]);
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
                                id={`podData_item`}
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
                                        style={{ whiteSpace: 'normal' }}
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

        const { data } = this.props;
        const podData = data.data;
        const logTitle = data.data['podName'];

        const dataKeys = Object.keys(podData);

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
                                            id="kubePodData"
                                            className="bs-ObjectList-rows"
                                            style={{ display: 'block' }}
                                        >
                                            {dataKeys.map(key => {
                                                let output = moment(
                                                    podData[key]
                                                );
                                                if (
                                                    output.isValid() &&
                                                    key !== 'podRestart' &&
                                                    key !== 'podName' &&
                                                    key !== 'podResourceVersion'
                                                ) {

                                                    output = output.format(
                                                        'LLL'
                                                    );
                                                } else {

                                                    output = String(
                                                        podData[key]
                                                    );
                                                }

                                                if (key === 'podConditions') {
                                                    return null;
                                                }
                                                if (key === 'podContainers') {
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
                                                                        All Pod
                                                                        Containers
                                                                    </div>
                                                                </div>
                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                    <div className="bs-ObjectList-cell-row"></div>
                                                                </div>
                                                            </div>
                                                            {this.handleContainer(
                                                                podData,
                                                                key
                                                            )}
                                                        </>
                                                    );
                                                }
                                                if (
                                                    key ===
                                                    'podContainerStatuses'
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
                                                                        All Pod
                                                                        Container
                                                                        Status
                                                                    </div>
                                                                </div>
                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                    <div className="bs-ObjectList-cell-row"></div>
                                                                </div>
                                                            </div>
                                                            {this.handleContainerStatuses(
                                                                podData,
                                                                key
                                                            )}
                                                        </>
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
                                                        id={`podData_item`}
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


KubePodData.displayName = 'KubePodData';


KubePodData.propTypes = {
    closeModal: PropTypes.func.isRequired,
    data: PropTypes.object,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
    },
    dispatch
);

export default connect(null, mapDispatchToProps)(KubePodData);
