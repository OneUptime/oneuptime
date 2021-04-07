import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import moment from 'moment';

class KubeStatefulsetData extends React.Component {
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
                return this.handleCloseModal(e);
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.closeModal();
    };

    handleKey = key => {
        switch (key) {
            case 'statefulsetName':
                return 'Name';
            case 'readyStatefulsets':
                return 'Ready Statefulsets';
            case 'desiredStatefulsets':
                return 'Desired Statefulsets';
            case 'statefulsetCreationTimestamp':
                return 'Creation Time';
            case 'statefulsetNamespace':
                return 'Namespace';
            case 'statefulsetResourceVersion':
                return 'Resource Version';
            case 'statefulsetSelfLink':
                return 'Self Link';
            case 'statefulsetUid':
                return 'UID';
            // no default
        }
    };

    render() {
        const { data } = this.props;
        const statefulsetData = data.data;
        const logTitle = data.data['statefulsetName'];

        const dataKeys = Object.keys(statefulsetData);

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
                                                let output = moment(
                                                    statefulsetData[key]
                                                );
                                                if (
                                                    output.isValid() &&
                                                    key !==
                                                        'readyStatefulsets' &&
                                                    key !==
                                                        'desiredStatefulsets' &&
                                                    key !==
                                                        'statefulsetResourceVersion' &&
                                                    key !== 'statefulsetName'
                                                ) {
                                                    output = output.format(
                                                        'LLL'
                                                    );
                                                } else {
                                                    output = String(
                                                        statefulsetData[key]
                                                    );
                                                }
                                                return (
                                                    <div
                                                        key={key}
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
                                                        }}
                                                        id={`statefulsetData_item`}
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

KubeStatefulsetData.displayName = 'KubeStatefulsetData';

KubeStatefulsetData.propTypes = {
    closeModal: PropTypes.func.isRequired,
    data: PropTypes.object,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            closeModal,
        },
        dispatch
    );

export default connect(null, mapDispatchToProps)(KubeStatefulsetData);
