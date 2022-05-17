import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Modal from '../components/Modal';
import { closeModal } from '../actions/Modal';
export class Modals extends Component {
    render() {
        const modals = this.props.modals.map((item, i) => {
            const ModalComponent = Modal(item.content);
            return (
            //  Modal(item.content)({
            // 	item,
            // 	zIndex: i,
            // 	key: i,
            // 	onClose: item => this.props.closeModal(item)
            // })
            React.createElement(ModalComponent, { item: item, key: i, zIndex: i, onClose: (item) => this.props.closeModal(item) }));
        });
        return React.createElement("div", { id: "backboneModals" }, modals);
    }
}
Modals.displayName = '';
Modals.propTypes = {};
Modals.propTypes = {
    modals: PropTypes.array.isRequired,
    closeModal: PropTypes.func.isRequired,
};
Modals.displayName = 'BlackBoneModals';
export default connect((state) => {
    return state.modal;
}, (dispatch) => {
    return bindActionCreators({
        closeModal,
    }, dispatch);
})(Modals);
