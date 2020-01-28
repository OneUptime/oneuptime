import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';

class Modal extends Component {
	handleKeyBoard = (e) => {
		switch (e.key) {
			case 'Escape': {
				if (this.props.closeThisDialog)
					return this.props.closeThisDialog()
				break;
			}
			default:
				return false;
		}
	}

	render() {
		var { title, closeButtonLabel, affirmativeButtonLabel, isLoading } = this.props;

		return (
			<div onKeyDown={this.handleKeyBoard} className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
				<div
					className="ModalLayer-contents"
					tabIndex={-1}
					style={{ marginTop: 40 }}
				>
					<div className="bs-BIM">
						<div className="bs-Modal bs-Modal--medium">
							<div className="bs-Modal-header">
								<div className="bs-Modal-header-copy">
									<span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
										<span>{title}</span>
									</span>
								</div>
							</div>
							<div className="bs-Modal-content">
								{this.props.children}
							</div>
							<div className="bs-Modal-footer">
								<div className="bs-Modal-footer-actions">
									{this.props.closeThisDialog && <button className="bs-Button bs-DeprecatedButton bs-Button--grey" type="button" onClick={
										this.props.closeThisDialog
									}>
										<span>{closeButtonLabel || "Close"}</span>
									</button>}
									{this.props.confirmThisDialog && <button
										id="deleteMonitor"
										className="bs-Button bs-DeprecatedButton bs-Button--red"
										type="button"
										onClick={this.props.confirmThisDialog}
										disabled={isLoading}
									>
										{!isLoading && <span>{affirmativeButtonLabel}</span>}
										{isLoading && <FormLoader />}
									</button>}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}
}

Modal.displayName = 'Modal'

Modal.propTypes = {
	confirmThisDialog: PropTypes.func,
	closeModal: PropTypes.func,
	children: PropTypes.object
}

const mapStateToProps = state => {
	return {

	}
}

const mapDispatchToProps = dispatch => {
	return {};
};

export default connect(mapStateToProps, mapDispatchToProps)(Modal);
