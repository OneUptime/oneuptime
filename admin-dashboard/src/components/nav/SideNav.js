import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import NavItem from './SideNavItem';
import { groups } from '../../routes';
import { openModal, closeModal } from '../../actions/modal';

class SideNav extends Component {

	handleKeyBoard = (e) => {
		switch (e.key) {
			case 'Escape':
				return true;
			default:
				return false;
		}
	}

	render() {
		
		return (
			<div className="db-World-scrollWrapper"> 
			<div onKeyDown={this.handleKeyBoard}  className="db-World-sideNavContainer">
				<div className="db-SideNav-container Box-root Box-background--surface Flex-flex Flex-direction--column Padding-top--20 Padding-right--2">
					<div className="Box-root Margin-bottom--20">
						<div>
							<div>
								<div tabIndex="-1" id="AccountSwitcherId">
									<div
										className="db-AccountSwitcherX-button Box-root Flex-flex Flex-alignItems--center"
									>

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
											<span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--noWrap">Fyipe Admin Dashboard</span>
										</div>
										<div className="Box-root Margin-left--8">
											{/* <div className="db-AccountSwitcherX-chevron" /> */}
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
			</div>
		);
	}
}

SideNav.displayName = 'SideNav';

const mapStateToProps = function (state_Ignored) {
	return { };
}

const mapDispatchToProps = function (dispatch) {
	return bindActionCreators(
		{
			openModal, closeModal
		},
		dispatch
	);
}

SideNav.propTypes = {
}
SideNav.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};
export default connect(mapStateToProps, mapDispatchToProps)(SideNav);
