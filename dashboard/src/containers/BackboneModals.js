import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Modal from '../components/Modal';
import { closeModal } from '../actions/modal';

export class Modals extends Component {
	render() {
		const modals = this.props.modals.map((item, i) => {
			const ModalComponent = Modal(item.content);
			return (
			<ModalComponent
				item={item}
				key={i}
				zIndex={i}
				onClose={item => this.props.closeModal(item)}
				title={item.title}
				body={item.body}
			/>
		)});
		return <div id="backboneModals">{modals}</div>;
	}
}

Modals.propTypes = {
	modals: PropTypes.array.isRequired,
	closeModal: PropTypes.func.isRequired
}

Modals.displayName = 'BlackBoneModals'

export default connect(
	function mapStateToProps(state) {
		return state.modal
	},
	function mapDispatchToProps(dispatch) {
		return bindActionCreators({
			closeModal
		}, dispatch);
	}
)(Modals);