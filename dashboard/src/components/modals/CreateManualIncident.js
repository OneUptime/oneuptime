import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class CreateManualIncident extends Component {

  /*  submitForm = () => {

		const { createNewIncident, closeThisDialog, currentProject, data } = this.props;

		createNewIncident(currentProject._id, data)
			.then(function () {
				closeThisDialog();
			}, function () {
				//do nothing.
			});
	}
*/
	handleKeyBoard = (e) => {
		switch (e.key) {
			case 'Escape':
				return this.props.closeThisDialog()
			default:
				return false;
		}
	}

	render() {
		const { closeThisDialog } = this.props;

		return (
			<div onKeyDown={this.handleKeyBoard} className="ModalLayer-contents" tabIndex="-1" style={{ marginTop: '40px' }}>
				<div className="bs-BIM">
					<div className="bs-Modal bs-Modal--medium">
						<div className="bs-Modal-header">
							<div className="bs-Modal-header-copy"
							style={{ marginBottom: '10px',marginTop:'10px' }}>
							<span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
								<span>Create New Incident</span>
								</span>
							</div>
						</div>

							<div className="bs-Modal-content bs-u-paddingless">
								<div className="bs-Modal-block bs-u-paddingless">

									<div className="bs-Modal-content">
										<span className="bs-Fieldset">

											<div className="bs-Fieldset-rows">
												<div className="bs-Fieldset-row">
													<span> Do you want to create a new incident? </span>
												</div>
											</div>

										</span>
									</div>
								</div>
							</div>
							<div className="bs-Modal-footer">
								<div className="bs-Modal-footer-actions">
									<ShouldRender if={this.props.newIncident && this.props.newIncident.error}>
										<div className="bs-Tail-copy">
											<div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
												<div className="Box-root Margin-right--8">
													<div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
													</div>
												</div>
												<div className="Box-root">
													<span style={{ color: 'red' }}>{this.props.newIncident.error}</span>
												</div>
											</div>
										</div>
									</ShouldRender>
									<button className="bs-Button bs-DeprecatedButton" type="button" onClick={closeThisDialog}><span>Cancel</span></button>
									<button
										id="createIncident"
										className="bs-Button bs-DeprecatedButton bs-Button--blue"
										disabled={this.props.newIncident && this.props.newIncident.requesting}
										type="button"  onClick={this.props.confirmThisDialog}>
										{this.props.newIncident && !this.props.newIncident.requesting && <span>Create</span>}
										{this.props.newIncident && this.props.newIncident.requesting && <FormLoader />}
									</button>
								</div>
							</div>

					</div>
				</div>
			</div>
		);
	}
}

CreateManualIncident.displayName = 'CreateManualIncidentModal'

const mapDispatchToProps = (dispatch) => {
	return bindActionCreators({}, dispatch)
}

function mapStateToProps(state) {

	return {
		newIncident: state.incident.newIncident,
	};
}

CreateManualIncident.propTypes = {
	closeThisDialog: PropTypes.func.isRequired,
	confirmThisDialog: PropTypes.func.isRequired,
	newIncident: PropTypes.object,
	error: PropTypes.object,
	requesting: PropTypes.bool,
}

export default connect(mapStateToProps, mapDispatchToProps)(CreateManualIncident);