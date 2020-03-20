import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import NavItem from './SideNavItem';
import { groups } from '../../routes';
import { openModal, closeModal } from '../../actions/modal';
import { closeSideNav } from '../../actions/page';
import ProjectSwitcher from '../project/ProjectSwitcher';
import ClickOutside from 'react-click-outside';
import {
    showProjectSwitcher,
    hideProjectSwitcher,
    hideForm,
} from '../../actions/project';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

class SideNav extends Component {
    hideSwitcher = () => {
        if (this.props.project.projectSwitcherVisible) {
            this.props.hideProjectSwitcher();
            if (!IS_DEV) {
                logEvent('Project Switcher hidden', {});
            }
        }
    };

    showSwitcher = () => {
        if (!this.props.project.projectSwitcherVisible) {
            this.props.showProjectSwitcher();
            if (!IS_DEV) {
                logEvent('Project Switcher Visible', {});
            }
        }
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.hideSwitcher();
                this.props.hideForm();
                return true;
            default:
                return false;
        }
    };

    render() {
        const { location, selectedComponent } = this.props;
        const switchToComponentDetailNav =
            location.pathname.match(
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/monitoring/
            ) ||
            location.pathname.match(
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/incident-log/
            ) ||
            location.pathname.match(
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/incidents\/([0-9]|[a-z])*/
            );

        let groupsToRender = [];

        if (switchToComponentDetailNav) {
            groupsToRender = groups
                .filter(group => group.visibleOnComponentDetail)
                .map((group, index) => {
                    if (index === 0 && selectedComponent) {
                        group.routes[0].title = selectedComponent.name;
                    }
                    return group;
                });
        } else {
            groupsToRender = groups
                .filter(group => !group.isPublic)
                .filter(group => !group.visibleOnComponentDetail)
                .filter(group => group.visible);
        }

        return (
            <ClickOutside onClickOutside={this.props.closeSideNav}>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className={`db-World-sideNavContainer${
                        this.props.sidenavopen ? ' open' : ''
                    }`}
                >
                    <div className="db-SideNav-container Box-root Box-background--surface Flex-flex Flex-direction--column Padding-top--20 Padding-right--2">
                        <div className="Box-root Margin-bottom--20">
                            <div>
                                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                    <div tabIndex="-1">
                                        <div
                                            id="AccountSwitcherId"
                                            className="db-AccountSwitcherX-button Box-root Flex-flex Flex-alignItems--center"
                                            onClick={this.showSwitcher}
                                        >
                                            <ClickOutside
                                                onClickOutside={
                                                    this.hideSwitcher
                                                }
                                            >
                                                <ProjectSwitcher
                                                    visible={
                                                        this.props.project
                                                            .projectSwitcherVisible
                                                    }
                                                />
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
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {this.props.project
                                                    .currentProject && (
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--noWrap">
                                                        {
                                                            this.props.project
                                                                .currentProject
                                                                .name
                                                        }
                                                    </span>
                                                )}
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
                            {groupsToRender.map((group, index, array) => {
                                const marginClass =
                                    index === array.length - 1
                                        ? 'Box-root '
                                        : 'Box-root Margin-bottom--16';
                                return (
                                    <div
                                        key={group.group}
                                        className={marginClass}
                                    >
                                        <ul>
                                            {group.routes.map(route => {
                                                return (
                                                    <li key={route.index}>
                                                        <NavItem
                                                            route={route}
                                                        />
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
            </ClickOutside>
        );
    }
}

SideNav.displayName = 'SideNav';

const mapStateToProps = function(state, props) {
    const { componentId } = props.match.params;
    const allIndividualComponents = state.component.componentList.components.reduce(
        (acc, curr) => acc.concat(curr.components || []),
        []
    );
    const selectedComponent = allIndividualComponents.find(
        component => component._id === componentId
    );
    return {
        selectedComponent,
        project: state.project,
        sidenavopen: state.page.sidenavopen,
    };
};

const mapDispatchToProps = function(dispatch) {
    return bindActionCreators(
        {
            openModal,
            closeModal,
            showProjectSwitcher,
            hideProjectSwitcher,
            hideForm,
            closeSideNav,
        },
        dispatch
    );
};

SideNav.propTypes = {
    project: PropTypes.object.isRequired,
    hideProjectSwitcher: PropTypes.func.isRequired,
    showProjectSwitcher: PropTypes.func.isRequired,
    hideForm: PropTypes.func.isRequired,
    closeSideNav: PropTypes.func,
    sidenavopen: PropTypes.bool,
    selectedComponent: PropTypes.object,
    location: PropTypes.object,
    match: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(SideNav);
