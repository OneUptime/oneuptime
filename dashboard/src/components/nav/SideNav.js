import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import NavItem from './SideNavItem';
import { groups } from '../../routes';
import { openModal, closeModal } from '../../actions/modal';
import ProjectSwitcher from '../project/ProjectSwitcher'
import ClickOutside from 'react-click-outside';
import { showProjectSwitcher, hideProjectSwitcher, hideForm } from '../../actions/project'

class SideNav extends Component {

	hideSwitcher = () => {
		if (this.props.project.projectSwitcherVisible) {
			this.props.hideProjectSwitcher();
			if (window.location.href.indexOf('localhost') <= -1) {
				this.context.mixpanel.track('Project Switcher hidden', {});
			}
		}
	}

	showSwitcher = () => {
		if (!this.props.project.projectSwitcherVisible) {
			this.props.showProjectSwitcher();
			if (window.location.href.indexOf('localhost') <= -1) {
				this.context.mixpanel.track('Project Switcher Visible', {});
			}
		}
	}

	handleKeyBoard = (e) => {
		switch (e.key) {
			case 'Escape':
				this.hideSwitcher()
				this.props.hideForm()
				return true;
			default:
				return false;
		}
	}

	render() {

		return (
			<div onKeyDown={this.handleKeyBoard} className="db-World-sideNavContainer">
				<div className="db-SideNav-container Box-root Box-background--surface Flex-flex Flex-direction--column Padding-top--20 Padding-right--2">
					<div className="Box-root Margin-bottom--20">
						<div>
							<div>
								<div tabIndex="-1" id="AccountSwitcherId">
									<div
										className="db-AccountSwitcherX-button Box-root Flex-flex Flex-alignItems--center"
										onClick={this.showSwitcher}
									>
										<ClickOutside onClickOutside={this.hideSwitcher}>
											<ProjectSwitcher visible={this.props.project.projectSwitcherVisible} />
										</ClickOutside>

										<div className="Box-root Margin-right--8">
											<div className="db-AccountSwitcherX-activeImage">
												<div className="db-AccountSwitcherX-accountImage Box-root Box-background--white">
													<div className="db-AccountSwitcherX-accountImage--content db-AccountSwitcherX-accountImage--fallback" />
												</div>
											</div>
										</div>
										<div
											style={{
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap'
											}}
										>
											{this.props.project.currentProject && <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--noWrap">
												{this.props.project.currentProject.name}
											</span>
											}
										</div>
										<div className="Box-root Margin-left--8">
											<div className="db-AccountSwitcherX-chevron" />
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>

					<div className="db-SideNav-navSections Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStaIt">
						{groups
							.filter(group => !group.isPublic)
							.filter(group => group.visible)
							.map((group, index, array) => {
								const marginClass =
									index === array.length - 1
										? 'Box-root '
										: 'Box-root Margin-bottom--16';
								return (
									<div key={group.group} className={marginClass}>
										<ul>
											{group.routes.map(route => {

												return (
													<li key={route.index}>
														<NavItem route={route} />
													</li>
												);
											})}
										</ul>
									</div>
								);
							})}
					</div>
				</div>
			</div>
		);
	}
}

SideNav.displayName = 'SideNav'

let mapStateToProps = function (state) {
	return { project: state.project };
}

let mapDispatchToProps = function (dispatch) {
	return bindActionCreators(
		{
			openModal, closeModal, showProjectSwitcher, hideProjectSwitcher, hideForm
		},
		dispatch
	);
}

SideNav.propTypes = {
	project: PropTypes.object.isRequired,
	hideProjectSwitcher: PropTypes.func.isRequired,
	showProjectSwitcher: PropTypes.func.isRequired,
	hideForm: PropTypes.func.isRequired
}
SideNav.contextTypes = {
	mixpanel: PropTypes.object.isRequired
};
export default connect(mapStateToProps, mapDispatchToProps)(SideNav);
