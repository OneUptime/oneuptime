import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'CommonUI/actions/modal';
import copyToClipboard from '../../utils/copyToClipboard';

interface IncomingRequestUrlProps {
    closeModal?: Function;
    incomingRequest?: object;
    currentProject?: object;
}

export class IncomingRequestUrl extends React.Component<IncomingRequestUrlProps> {
    state = {
        copied: false,
    };

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
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

        this.props.closeModal({

            id: this.props.currentProject._id,
        });
    };

    copyHandler = (text: $TSFixMe) => {
        copyToClipboard(text);
        this.setState({ copied: true });
    };

    override render() {

        const { closeModal, currentProject, incomingRequest } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-Modal bs-Modal--medium">
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
                                        <span>Incoming Request URL</span>
                                    </span>
                                    <br />
                                    <span>
                                        This personalised url will be used in
                                        your external service to trigger
                                        incident creation and/or resolution
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    Please copy and paste the url below, in your
                                    external service to integrate it with
                                    OneUptime
                                </span>
                                <br />
                                <br />
                                <span>
                                    <input
                                        type="url"
                                        value={incomingRequest.url}
                                        style={{
                                            width: '100%',
                                            padding: '5px 10px',
                                            fontWeight: 600,
                                        }}
                                    />
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        type="button"
                                        onClick={() =>
                                            this.copyHandler(
                                                incomingRequest.url
                                            )
                                        }
                                        disabled={this.state.copied}
                                        id="copyToClipboardBtn"
                                    >
                                        {this.state.copied ? (
                                            <span>Copied</span>
                                        ) : (
                                            <span>Copy to clipboard</span>
                                        )}
                                    </button>
                                    <button
                                        className="bs-Button btn__modal"
                                        type="button"
                                        onClick={() =>
                                            closeModal({
                                                id: currentProject._id,
                                            })
                                        }
                                        autoFocus={true}
                                        id="requestOkBtn"
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
        );
    }
}


IncomingRequestUrl.displayName = 'IncomingRequestUrl';


IncomingRequestUrl.propTypes = {
    closeModal: PropTypes.func,
    incomingRequest: PropTypes.object,
    currentProject: PropTypes.object,
};

const mapStateToProps: Function = (state: RootState) => ({
    currentProject: state.project.currentProject,

    incomingRequest:
        state.incomingRequest.createIncomingRequest.incomingRequest
});

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ closeModal }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(IncomingRequestUrl);
