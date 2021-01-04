import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import NavItem from './SideNavItem';
import { groups } from '../../routes';
import { openModal, closeModal } from '../../actions/modal';
import { closeSideNav } from '../../actions/page';
import ClickOutside from 'react-click-outside';

class SideNav extends Component {
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return true;
            default:
                return false;
        }
    };

    render() {
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
                                <div>
                                    <div tabIndex="-1" id="AccountSwitcherId">
                                        <div className="db-AccountSwitcherX-button Box-root Flex-flex Flex-alignItems--center">
                                            <div className="Box-root Margin-right--8">
                                                <div className="db-AccountSwitcherX-activeImage">
                                                    <div
                                                        className="db-AccountSwitcherX-accountImage Box-root Box-background--white"
                                                        style={{
                                                            borderRadius: '50%',
                                                            width: '25px',
                                                            height: '25px',
                                                        }}
                                                    >
                                    
                                                        <img
                                                            width="17"
                                                            style={{
                                                                marginLeft: 5,
                                                                verticalAlign:
                                                                    'middle',
                                                                height: '100%',
                                                                borderRadius: '50%'
                                                            }}
                                                            alt="warning"
                                                            src={
                                                                'data:image/svg+xml;base64,77u/PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+DQo8c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZlcnNpb249IjEuMSIgYmFzZVByb2ZpbGU9ImZ1bGwiIHdpZHRoPSIyNzkuODQ3IiBoZWlnaHQ9IjI3OS44NDciIHZpZXdCb3g9IjAgMCAyNzkuODUgMjc5Ljg1IiBlbmFibGUtYmFja2dyb3VuZD0ibmV3IDAgMCAyNzkuODUgMjc5Ljg1IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCgk8cmVjdCB4PSIwIiB5PSItNi4xMDM1MmUtMDA1IiBmaWxsPSIjMDAwMDAwIiBmaWxsLW9wYWNpdHk9IjEiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHdpZHRoPSIyNzkuODQ3IiBoZWlnaHQ9IjI3OS44NDciLz4NCgk8cGF0aCBmaWxsPSIjRkZGRkZGIiBmaWxsLW9wYWNpdHk9IjEiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Ik0gMjEwLjY0OSwxMDMuNTAxQyAyMDguNDMxLDEwMi41NzMgMjA1LjkwMSwxMDIuMTA5IDIwMy4wNTksMTAyLjEwOUMgMTk1LjA4NSwxMDIuMTA5IDE5MS4wOTcsMTA2LjQwOCAxOTEuMDk3LDExNS4wMDZMIDE5MS4wOTcsMTI0LjM3OUwgMjA3Ljg2NSwxMjQuMzc5TCAyMDcuODY1LDEzNi45MDZMIDE5MS4xNjMsMTM2LjkwNkwgMTkxLjE2MywxOTMuOTczTCAxNzUuODUyLDE5My45NzNMIDE3NS44NTIsMTM2LjkwNkwgMTYzLjMyNSwxMzYuOTA2TCAxNjMuMzI1LDEyNC4zNzlMIDE3NS44NTIsMTI0LjM3OUwgMTc1Ljg1MiwxMTMuMTU3QyAxNzUuODUyLDEwNS44NjUgMTc4LjI3NywxMDAuMTEyIDE4My4xMjcsOTUuOTAwM0MgMTg3Ljk3Nyw5MS42ODg0IDE5NC4wNDEsODkuNTgyNiAyMDEuMzE5LDg5LjU4MjZDIDIwNS4yNDgsODkuNTgyNiAyMDguMzU4LDg5Ljk5NTggMjEwLjY0OSw5MC44MjIyTCAyMTAuNjQ5LDEwMy41MDEgWiAiLz4NCgk8cmVjdCB4PSIyMTcuNjA4IiB5PSIxMjQuMzc5IiBmaWxsPSIjRkZGRkZGIiBmaWxsLW9wYWNpdHk9IjEiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHdpZHRoPSIxNS4zMTA1IiBoZWlnaHQ9IjY5LjU5MzQiLz4NCgk8cGF0aCBmaWxsPSIjNkNEQjU2IiBmaWxsLW9wYWNpdHk9IjEiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Ik0gMTI5LjYwMSw5Ny44MThMIDE0NC4xLDk3LjgxOEMgMTQ2LjMwOSw5Ny44MTggMTQ4LjEsOTkuNjA4OCAxNDguMSwxMDEuODE4TCAxNDguMSwxODkuODEzQyAxNDguMSwxOTIuMDIyIDE0Ni4zMDksMTkzLjgxMyAxNDQuMSwxOTMuODEzTCAxMjkuNjAxLDE5My44MTNDIDEyNy4zOTIsMTkzLjgxMyAxMjUuNjAxLDE5Mi4wMjIgMTI1LjYwMSwxODkuODEzTCAxMjUuNjAxLDEwMS44MThDIDEyNS42MDEsOTkuNjA4OCAxMjcuMzkyLDk3LjgxOCAxMjkuNjAxLDk3LjgxOCBaICIvPg0KCTxwYXRoIGZpbGw9IiM2Q0RCNTYiIGZpbGwtb3BhY2l0eT0iMSIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0iTSA5NS44NTMxLDk4LjU2NzdMIDExMC4zNTIsOTguNTY3N0MgMTEyLjU2MSw5OC41Njc3IDExNC4zNTIsMTAwLjM1OCAxMTQuMzUyLDEwMi41NjhMIDExNC4zNTIsMTkwLjU2M0MgMTE0LjM1MiwxOTIuNzcyIDExMi41NjEsMTk0LjU2MyAxMTAuMzUyLDE5NC41NjNMIDk1Ljg1MzEsMTk0LjU2M0MgOTMuNjQ0LDE5NC41NjMgOTEuODUzMSwxOTIuNzcyIDkxLjg1MzEsMTkwLjU2M0wgOTEuODUzMSwxMDIuNTY4QyA5MS44NTMxLDEwMC4zNTggOTMuNjQ0LDk4LjU2NzcgOTUuODUzMSw5OC41Njc3IFogIi8+DQoJPHBhdGggZmlsbD0iIzZDREI1NiIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNIDYwLjM1NSw5OC4wNjc0TCA3NC44NTM5LDk4LjA2NzRDIDc3LjA2Myw5OC4wNjc0IDc4Ljg1MzksOTkuODU4MyA3OC44NTM5LDEwMi4wNjdMIDc4Ljg1MzksMTkwLjA2M0MgNzguODUzOSwxOTIuMjcyIDc3LjA2MywxOTQuMDYzIDc0Ljg1MzksMTk0LjA2M0wgNjAuMzU1LDE5NC4wNjNDIDU4LjE0NTgsMTk0LjA2MyA1Ni4zNTUsMTkyLjI3MiA1Ni4zNTUsMTkwLjA2M0wgNTYuMzU1LDEwMi4wNjdDIDU2LjM1NSw5OS44NTgzIDU4LjE0NTgsOTguMDY3NCA2MC4zNTUsOTguMDY3NCBaICIvPg0KPC9zdmc+DQo='
                                                            }
                                                        />
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
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--noWrap">
                                                    Fyipe Admin Dashboard
                                                </span>
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

const mapStateToProps = function (state) {
    return {
        sidenavopen: state.page.sidenavopen,
    };
};

const mapDispatchToProps = function (dispatch) {
    return bindActionCreators(
        {
            openModal,
            closeModal,
            closeSideNav,
        },
        dispatch
    );
};

SideNav.propTypes = {
    closeSideNav: PropTypes.func,
    sidenavopen: PropTypes.bool,
};
SideNav.contextTypes = {
    mixpanel: PropTypes.object.isRequired,
};
export default connect(mapStateToProps, mapDispatchToProps)(SideNav);
