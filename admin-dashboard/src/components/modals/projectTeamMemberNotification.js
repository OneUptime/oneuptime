import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

class ProjectTeamMemberNotification extends Component {
	

	handleKeyBoard = (e)=>{
		switch(e.key){
			case 'Escape':
			return this.props.closeThisDialog()
			default:
			return false;
		}
	}
	
	render() {
		const {team} = this.props;
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
							<span>Confirm Invite</span>
						</span>
					</div>
				</div>
				<div className="bs-Modal-content">
					<span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
					You’re inviting a user to a project, this will also invite this user to all the sub-projects.
					</span>
				</div>
				<div className="bs-Modal-footer">
					<div className="bs-Modal-footer-actions">
						<button className="bs-Button bs-DeprecatedButton bs-Button--grey" type="button" onClick={this.props.closeThisDialog}>
							<span>Cancel</span>
						</button>
						<button id="btnConfirmInvite" className="bs-Button bs-DeprecatedButton bs-Button--blue" type="button"  onClick={this.props.confirmThisDialog}
							disabled = {team.teamCreate.requesting}
						>
						{ !team.teamCreate.requesting && <span>Continue</span> }
						{ team.teamCreate.requesting && <FormLoader />}
						</button>
					</div>
				</div>
			</div>
				</div>
			</div>
		</div>	
		);
	}
}

ProjectTeamMemberNotification.displayName = 'ProjectTeamMemberNotificationFormModal'

ProjectTeamMemberNotification.propTypes = {
	confirmThisDialog: PropTypes.func.isRequired,
	closeThisDialog: PropTypes.func.isRequired,
	team: PropTypes.object.isRequired,
}

const mapDispatchToProps = (dispatch) => {
	return bindActionCreators({}, dispatch)
}

function mapStateToProps(state) {

	return {
		team: state.team,
	};
}

export default connect(mapStateToProps, mapDispatchToProps)(ProjectTeamMemberNotification);