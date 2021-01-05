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
                                                            style={{
                                                                marginLeft: 2,
                                                                verticalAlign:
                                                                    'middle',
                                                                height: '100%',
                                                                width: '80%'
                                                            }}
                                                            alt="warning"
                                                            src={
                                                                'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+DQo8c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZlcnNpb249IjEuMSIgYmFzZVByb2ZpbGU9ImZ1bGwiIHdpZHRoPSIyNzkuODQ3IiBoZWlnaHQ9IjI3OS44NDciIHZpZXdCb3g9IjAgMCAyNzkuODUgMjc5Ljg1IiBlbmFibGUtYmFja2dyb3VuZD0ibmV3IDAgMCAyNzkuODUgMjc5Ljg1IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCgk8Y2lyY2xlIGN4PSIxNTAiIGN5PSIxMzUiIHI9IjEzMCIgZmlsbD0iYmxhY2siIC8+DQoJPHBhdGggZmlsbD0iI0ZGRkZGRiIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNIDIxMC42NDksMTAzLjUwMUMgMjA4LjQzMSwxMDIuNTczIDIwNS45MDEsMTAyLjEwOSAyMDMuMDU5LDEwMi4xMDlDIDE5NS4wODUsMTAyLjEwOSAxOTEuMDk3LDEwNi40MDggMTkxLjA5NywxMTUuMDA2TCAxOTEuMDk3LDEyNC4zNzlMIDIwNy44NjUsMTI0LjM3OUwgMjA3Ljg2NSwxMzYuOTA2TCAxOTEuMTYzLDEzNi45MDZMIDE5MS4xNjMsMTkzLjk3M0wgMTc1Ljg1MiwxOTMuOTczTCAxNzUuODUyLDEzNi45MDZMIDE2My4zMjUsMTM2LjkwNkwgMTYzLjMyNSwxMjQuMzc5TCAxNzUuODUyLDEyNC4zNzlMIDE3NS44NTIsMTEzLjE1N0MgMTc1Ljg1MiwxMDUuODY1IDE3OC4yNzcsMTAwLjExMiAxODMuMTI3LDk1LjkwMDNDIDE4Ny45NzcsOTEuNjg4NCAxOTQuMDQxLDg5LjU4MjYgMjAxLjMxOSw4OS41ODI2QyAyMDUuMjQ4LDg5LjU4MjYgMjA4LjM1OCw4OS45OTU4IDIxMC42NDksOTAuODIyMkwgMjEwLjY0OSwxMDMuNTAxIFogIi8+DQoJPHJlY3QgeD0iMjE3LjYwOCIgeT0iMTI0LjM3OSIgZmlsbD0iI0ZGRkZGRiIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiB3aWR0aD0iMTUuMzEwNSIgaGVpZ2h0PSI2OS41OTM0Ii8+DQoJPHBhdGggZmlsbD0iIzZDREI1NiIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNIDEyOS42MDEsOTcuODE4TCAxNDQuMSw5Ny44MThDIDE0Ni4zMDksOTcuODE4IDE0OC4xLDk5LjYwODggMTQ4LjEsMTAxLjgxOEwgMTQ4LjEsMTg5LjgxM0MgMTQ4LjEsMTkyLjAyMiAxNDYuMzA5LDE5My44MTMgMTQ0LjEsMTkzLjgxM0wgMTI5LjYwMSwxOTMuODEzQyAxMjcuMzkyLDE5My44MTMgMTI1LjYwMSwxOTIuMDIyIDEyNS42MDEsMTg5LjgxM0wgMTI1LjYwMSwxMDEuODE4QyAxMjUuNjAxLDk5LjYwODggMTI3LjM5Miw5Ny44MTggMTI5LjYwMSw5Ny44MTggWiAiLz4NCgk8cGF0aCBmaWxsPSIjNkNEQjU2IiBmaWxsLW9wYWNpdHk9IjEiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Ik0gOTUuODUzMSw5OC41Njc3TCAxMTAuMzUyLDk4LjU2NzdDIDExMi41NjEsOTguNTY3NyAxMTQuMzUyLDEwMC4zNTggMTE0LjM1MiwxMDIuNTY4TCAxMTQuMzUyLDE5MC41NjNDIDExNC4zNTIsMTkyLjc3MiAxMTIuNTYxLDE5NC41NjMgMTEwLjM1MiwxOTQuNTYzTCA5NS44NTMxLDE5NC41NjNDIDkzLjY0NCwxOTQuNTYzIDkxLjg1MzEsMTkyLjc3MiA5MS44NTMxLDE5MC41NjNMIDkxLjg1MzEsMTAyLjU2OEMgOTEuODUzMSwxMDAuMzU4IDkzLjY0NCw5OC41Njc3IDk1Ljg1MzEsOTguNTY3NyBaICIvPg0KCTxwYXRoIGZpbGw9IiM2Q0RCNTYiIGZpbGwtb3BhY2l0eT0iMSIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0iTSA2MC4zNTUsOTguMDY3NEwgNzQuODUzOSw5OC4wNjc0QyA3Ny4wNjMsOTguMDY3NCA3OC44NTM5LDk5Ljg1ODMgNzguODUzOSwxMDIuMDY3TCA3OC44NTM5LDE5MC4wNjNDIDc4Ljg1MzksMTkyLjI3MiA3Ny4wNjMsMTk0LjA2MyA3NC44NTM5LDE5NC4wNjNMIDYwLjM1NSwxOTQuMDYzQyA1OC4xNDU4LDE5NC4wNjMgNTYuMzU1LDE5Mi4yNzIgNTYuMzU1LDE5MC4wNjNMIDU2LjM1NSwxMDIuMDY3QyA1Ni4zNTUsOTkuODU4MyA1OC4xNDU4LDk4LjA2NzQgNjAuMzU1LDk4LjA2NzQgWiAiLz4NCjwvc3ZnPg=='
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
