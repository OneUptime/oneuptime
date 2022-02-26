import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Modal from '../components/Modal';
import { closeModal } from '../actions/modal';

export class Modals extends Component {
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'modals' does not exist on type 'Readonly... Remove this comment to see the full error message
        const modals = this.props.modals.map((item: $TSFixMe, i: $TSFixMe) => {
            const ModalComponent = Modal(item.content);
            return (
                <ModalComponent
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ item: any; key: any; zIndex: any; onClose:... Remove this comment to see the full error message
                    item={item}
                    key={i}
                    zIndex={i}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                    onClose={(item: $TSFixMe) => this.props.closeModal(item)}
                    title={item.title}
                    body={item.body}
                />
            );
        });
        return <div id="backboneModals">{modals}</div>;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Modals.propTypes = {
    modals: PropTypes.array.isRequired,
    closeModal: PropTypes.func.isRequired,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Modals.displayName = 'BlackBoneModals';

export default connect(
    function mapStateToProps(state) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'modal' does not exist on type 'DefaultRo... Remove this comment to see the full error message
        return state.modal;
    },
    function mapDispatchToProps(dispatch) {
        return bindActionCreators(
            {
                closeModal,
            },
            dispatch
        );
    }
)(Modals);
