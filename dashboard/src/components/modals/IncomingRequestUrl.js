import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { closeModal } from '../../actions/modal';
import copyToClipboard from '../../utils/copyToClipboard';

export class IncomingRequestUrl extends React.Component {
    state = {
        copied: false,
    };

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        const { closeModal, currentProject } = this.props;

        switch (e.key) {
            case 'Escape':
            case 'Enter':
                return closeModal({
                    id: currentProject._id,
                });
            default:
                return false;
        }
    };

    copyHandler = text => {
        copyToClipboard(text);
        this.setState({ copied: true });
    };

    render() {
        const { closeModal, currentProject, incomingRequest } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-Modal bs-Modal--medium">
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
                                    This personalised url will be used in your
                                    external service to trigger incident
                                    creation and/or resolution
                                </span>
                            </div>
                        </div>
                        <div className="bs-Modal-content">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                Please copy and paste the url below, in your
                                external service to integrate it with Fyipe
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
                                        this.copyHandler(incomingRequest.url)
                                    }
                                    disabled={this.state.copied}
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
                                        closeModal({ id: currentProject._id })
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
                    </div>
                </div>
            </div>
        );
    }
}

IncomingRequestUrl.displayName = 'IncomingRequestUrl';

IncomingRequestUrl.propTypes = {
    closeModal: PropTypes.func,
    incomingRequest: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    currentProject: PropTypes.object,
};

const mapStateToProps = state => ({
    currentProject: state.project.currentProject,
    incomingRequest:
        state.incomingRequest.createIncomingRequest.incomingRequest,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeModal }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(IncomingRequestUrl);
