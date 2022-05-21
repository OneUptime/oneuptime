import PropTypes from 'prop-types';
import React from 'react';
import { connect } from 'react-redux';
import { closeModal } from 'CommonUI/actions/Modal';
import { bindActionCreators } from 'redux';
class ExtraCharge extends React.Component {
    constructor() {
        super(...arguments);
        this.handleKeyBoard = (e) => {
            switch (e.key) {
                case 'Escape':
                    return this.props.closeModal({
                        id: this.props.modalId,
                    });
                default:
                    return false;
            }
        };
    }
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }
    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }
    render() {
        return (React.createElement("div", null,
            React.createElement("div", { className: "ModalLayer-contents", tabIndex: -1, style: { marginTop: 40 } },
                React.createElement("div", { className: "bs-BIM" },
                    React.createElement("div", { className: "bs-Modal bs-Modal--medium" },
                        React.createElement("div", { className: "bs-Modal-header" },
                            React.createElement("div", { className: "bs-Modal-header-copy" },
                                React.createElement("span", { className: "Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap" },
                                    React.createElement("span", null, "Why we charge your cards at sign up?")))),
                        React.createElement("div", { className: "bs-Modal-content" },
                            React.createElement("div", null,
                                "We've had few issues with toll fraud in the past and we want to make sure our customers who sign up to OneUptime are 100% genuine. This is one of the steps we take to filter out fraud. To learn about toll fraud,",
                                ' ',
                                React.createElement("span", { style: {
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                    } },
                                    React.createElement("a", { style: { color: 'green' }, href: "https://www.twilio.com/learn/voice-and-video/toll-fraud", target: "_blank", rel: "noopener noreferrer" }, "please click here")))),
                        React.createElement("div", { className: "bs-Modal-footer" },
                            React.createElement("div", { className: "bs-Modal-footer-actions" },
                                React.createElement("button", { className: "bs-Button bs-DeprecatedButton bs-Button--grey", type: "button", onClick: () => this.props.closeModal({
                                        id: this.props.modalId,
                                    }) },
                                    React.createElement("span", { className: "cancel-btn__keycode" }, 'Close')))))))));
    }
}
ExtraCharge.propTypes = {
    closeModal: PropTypes.func,
    modalId: PropTypes.string,
};
ExtraCharge.displayName = 'ExtraCharge';
const mapStateToProps = (state) => {
    return {
        modalId: state.modal.modals[0].id,
    };
};
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        closeModal,
    }, dispatch);
};
export default connect(mapStateToProps, mapDispatchToProps)(ExtraCharge);
