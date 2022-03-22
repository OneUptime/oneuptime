import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import Modal from '../components/Modal';
import { closeModal } from '../actions/modal';

export class Modals extends Component {
    render() {

        const modals = this.props.modals.map((item: $TSFixMe, i: $TSFixMe) => {
            const ModalComponent = Modal(item.content);
            return (
                //  Modal(item.content)({
                // 	item,
                // 	zIndex: i,
                // 	key: i,
                // 	onClose: item => this.props.closeModal(item)
                // })
                <ModalComponent

                    item={item}
                    key={i}
                    zIndex={i}

                    onClose={(item: $TSFixMe) => this.props.closeModal(item)}
                />
            );
        });
        return <div id="backboneModals">{modals}</div>;
    }
}


Modals.propTypes = {
    modals: PropTypes.array.isRequired,
    closeModal: PropTypes.func.isRequired,
};


Modals.displayName = 'BlackBoneModals';

export default connect(
    (state) => {

        return state.modal;
    },
    (dispatch) => {
        return bindActionCreators(
            {
                closeModal,
            },
            dispatch
        );
    }
)(Modals);
