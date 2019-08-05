import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import FeedBackModal from '../FeedbackModal';
import { showProfileMenu } from '../../actions/profile';
import { openNotificationMenu } from '../../actions/notification';
import { openFeedbackModal, closeFeedbackModal } from '../../actions/feedback';
import ClickOutside from 'react-click-outside';
import { userSettings } from '../../actions/profile';
import { API_URL,User } from '../../config';

class TopContent extends Component {

	componentDidMount() {
		this.props.userSettings();
	}

	showFeedbackModal =()=> {
		this.props.openFeedbackModal();
		if(window.location.href.indexOf('localhost') <= -1){
			this.context.mixpanel.track('Feedback Modal Opened', {});
		}
	}

	hideFeedbackModal =()=> {
		this.props.closeFeedbackModal();
		if(window.location.href.indexOf('localhost') <= -1){
			this.context.mixpanel.track('Feedback Modal Closed', {});
		}
	}

	showProfileMenu =()=> {
		this.props.showProfileMenu();
		if(window.location.href.indexOf('localhost') <= -1){
			this.context.mixpanel.track('Profile Menu Opened', {});
		}
	}

	showNotificationsMenu =()=> {
		this.props.openNotificationMenu();
		if(window.location.href.indexOf('localhost') <= -1){
			this.context.mixpanel.track('Notification Menu Opened', {});
		}
	}

	handleKeyBoard = (e)=>{
		switch(e.key){
			case 'Escape':
			this.hideFeedbackModal()
			return true;
			default:
			return false;
		}
	}

	render() {
		const IMG_URL = this.props.profilePic && this.props.profilePic !== '' ? `url(${API_URL}/file/${this.props.profilePic})` : 'url(https://secure.gravatar.com/avatar/0c44b8877b1dccab3029ba37888a1686?s=60&amp;d=https%3A%2F%2Fb.stripecdn.com%2Fmanage%2Fassets%2F404)';
		var userId = User.getUserId();
		var count = 0;
        if(this.props.notifications && this.props.notifications.notifications && this.props.notifications.notifications.length){
            this.props.notifications.notifications.map(notification => {
				if(notification.read.indexOf(userId) > -1){
					return notification;
				}
				else {
					count++;
					return notification;
				}
            })
		}
		
		return (
			<div tabIndex="0" onKeyDown={this.handleKeyBoard} style={{zIndex:'2'}} className="db-World-topContent Box-root Box-background--surface Padding-vertical--20">

				<div  className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
					<ClickOutside onClickOutside={this.hideFeedbackModal}>
						<FeedBackModal />
					</ClickOutside>
					<div className="db-SearchField db-SearchField--tokenizable">

						<span />
					</div>
					<div className="Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
						<div className="Box-root Margin-right--16">
							<div
								id="feedback-div"
								className="db-FeedbackInput-container Card-root Card-shadow--small"
								onClick={this.showFeedbackModal}
							>
								<div className="db-FeedbackInput-box Box-root Box-background--offset Flex-flex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--4">
									<div className="Box-root Flex-flex Margin-right--8">
										<span className="db-FeedbackInput-defaultIcon" />
									</div>

									<div
										style={{
											overflow: 'hidden',
											textOveerflow: 'ellipsis',
											whiteSpace: 'nowrap'
										}}
									>
										<span className="Text-color--disabled Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
											{(this.props.feedback.feedback.success || this.props.feedback.feedback.requesting) && (!this.props.feedback.feedback.error) ? <span>Thank you for your feedback.</span> : <span>Feedback about this page?</span>}
											{
												(this.props.feedback.feedback.error) ? <span>Sorry, Please try again.</span> : null
											}
										</span>

									</div>
									<span />
								</div>
								<span />
							</div>
						</div>
						
						<div className="Box-root Flex-flex">
							<div tabIndex="-1" style={{ outline: 'none',marginRight:'15px' }}>
								<button className={count ? 'db-Notifications-button active-notification' : 'db-Notifications-button'} onClick={this.showNotificationsMenu}>
									<span className="db-Notifications-icon db-Notifications-icon--empty" />
								</button>
							</div>
						</div> 
						<div className="Box-root" >
							<div>
								<div className="Box-root Flex-flex">
									<div className="Box-root Flex-flex">
										<button
											className="bs-Button bs-DeprecatedButton db-UserMenuX"
											id="profile-menu"
											type="button"
											tabIndex="-1"
											onClick={this.showProfileMenu}
										>
											<div
												className="db-GravatarImage db-UserMenuX-image"
												style={{ backgroundImage: IMG_URL}}
											/>
										</button>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
				<span className="db-World-topContent--left" />
				<span className="db-World-topContent--right" />
			</div>
		)
	}
}

TopContent.displayName = 'TopContent'

const mapStateToProps = (state) => {
	const settings = state.profileSettings.profileSetting.data;
	const profilePic = settings ? settings.profilePic : '';

	return {
		profilePic,
		feedback: state.feedback,
		notifications : state.notifications.notifications
	}
}

const mapDispatchToProps = dispatch => bindActionCreators(
	{ showProfileMenu, openFeedbackModal, closeFeedbackModal, userSettings,openNotificationMenu }
	, dispatch)

TopContent.propTypes = {
	userSettings: PropTypes.func.isRequired,
	openFeedbackModal: PropTypes.func.isRequired,
	closeFeedbackModal: PropTypes.func.isRequired,
	showProfileMenu: PropTypes.func.isRequired,
	openNotificationMenu : PropTypes.func.isRequired,
	feedback: PropTypes.object.isRequired,
	profilePic: PropTypes.oneOfType([
		PropTypes.string,
		PropTypes.oneOf([null,undefined])
	]),
	notifications: PropTypes.oneOfType([
		PropTypes.object,
		PropTypes.oneOf([null,undefined])
	]),
	length : PropTypes.number,
	map : PropTypes.func
}

TopContent.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(TopContent);
