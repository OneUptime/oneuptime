import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import Modal from '../components/Modal';
import { closeModal } from '../actions/modal';

interface ModalsProps {
    modals: unknown[];
    closeModal: Function;
}

export class Modals extends Component<ModalsProps>{
    public static displayName = '';
    public static propTypes = {};
    override render() {

        const modals = this.props.modals.map((item: $TSFixMe, i: $TSFixMe) => {
            const ModalComponent: $TSFixMe = Modal(item.content);
            return (
                <ModalComponent

                    item={item}
                    key={i}
                    zIndex={i}

                    onClose={(item: $TSFixMe) => this.props.closeModal(item)}
                    title={item.title}
                    body={item.body}
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
