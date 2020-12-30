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
                                                            }}
                                                            alt="warning"
                                                            src={
                                                                'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE4LjEuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgMTYuMzc3IDE2LjM3NyIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMTYuMzc3IDE2LjM3NzsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIHN0eWxlPSJmaWxsOiMwMzAxMDQ7IiBkPSJNNC4zMzEsNS4wNDNjMC4wNDIsMC4yNTYsMC4xNDEsMC40MTcsMC4yMzgsMC41MmMwLjIzMSwxLjU0LDEuNTIxLDIuOTcsMi42OTgsMi45Nw0KCQkJYzEuMzczLDAsMi42MjMtMS41NDcsMi44NjUtMi45NjdjMC4wOTgtMC4xMDEsMC4xOTktMC4yNjQsMC4yNDItMC41MjJjMC4wNzgtMC4yODksMC4xOC0wLjc5MSwwLjAwMi0xLjAyNQ0KCQkJYy0wLjAxLTAuMDEyLTAuMDItMC4wMjMtMC4wMjktMC4wMzRjMC4xNjYtMC42MDYsMC4zNzctMS44NTgtMC4zNzUtMi43MTFDOS45MDYsMS4xODgsOS40ODYsMC42ODYsOC41ODUsMC40Mkw4LjE1OCwwLjI3MQ0KCQkJQzcuNDUsMC4wNTIsNy4wMDQsMC4wMDQsNi45ODYsMC4wMDFjLTAuMDMxLTAuMDAzLTAuMDY1LDAtMC4wOTYsMC4wMDhDNi44NjUsMC4wMTYsNi43ODIsMC4wMzgsNi43MTYsMC4wMw0KCQkJQzYuNTQ3LDAuMDA2LDYuMjkzLDAuMDkzLDYuMjQ4LDAuMTFjLTAuMDYsMC4wMjMtMS40MywwLjU3My0xLjg0NiwxLjg0OUM0LjM2MywyLjA2Myw0LjE5NywyLjYwNSw0LjQxOCwzLjkzNg0KCQkJQzQuMzg1LDMuOTU4LDQuMzU1LDMuOTg1LDQuMzMsNC4wMTlDNC4xNTIsNC4yNTMsNC4yNTIsNC43NTQsNC4zMzEsNS4wNDN6IE00Ljg2OSwyLjE0MUM0Ljg3MiwyLjEzNSw0Ljg3NCwyLjEyOCw0Ljg3NywyLjEyDQoJCQljMC4zMzktMS4wNTIsMS41NDEtMS41MzgsMS41NDktMS41NDJjMC4wNTUtMC4wMjEsMC4xNjItMC4wNTEsMC4yMTktMC4wNTFjMC4xMTgsMC4wMTYsMC4yNTQtMC4wMDUsMC4zMjgtMC4wMjINCgkJCUM3LjA5NCwwLjUyMiw3LjQ3LDAuNTgzLDguMDAxLDAuNzQ3bDAuNDMyLDAuMTQ4YzAuODAxLDAuMjM3LDEuMTQxLDAuNjgxLDEuMTQzLDAuNjg0YzAuMDA2LDAuMDA3LDAuMDEyLDAuMDEzLDAuMDE2LDAuMDE5DQoJCQljMC42OTUsMC43ODMsMC4zMzgsMi4wNzksMC4yMTEsMi40NTdDOS43NzQsNC4xNDQsOS43OTUsNC4yNDIsOS44Niw0LjMwOGMwLjAzMywwLjAzNCwwLjA3MiwwLjA1NywwLjExNSwwLjA2OQ0KCQkJQzkuOTc3LDQuNSw5Ljk0Miw0LjcyNSw5Ljg4Nyw0LjkyMkM5Ljg4NSw0LjkzMSw5Ljg4Myw0Ljk0MSw5Ljg4MSw0Ljk1QzkuODYsNS4wODksOS44MTMsNS4xOSw5Ljc1LDUuMjM2DQoJCQljLTAuMDUzLDAuMDQtMC4wOSwwLjEwMS0wLjEsMC4xNjdjLTAuMTY2LDEuMTktMS4yNjgsMi42MjktMi4zODIsMi42MjljLTAuOTM4LDAtMi4wNTUtMS4zMjUtMi4yMTMtMi42MjQNCgkJCUM1LjA0Nyw1LjM0LDUuMDEyLDUuMjc5LDQuOTU2LDUuMjM4Yy0wLjA2My0wLjA0OC0wLjExLTAuMTUtMC4xMzEtMC4yODdjLTAuMDAxLTAuMDEtMC4wMDMtMC4wMi0wLjAwNi0wLjAyOQ0KCQkJQzQuNzY4LDQuNzM5LDQuNzM1LDQuNTMsNC43MzIsNC40MDRjMC4wNDctMC4wMDUsMC4wOTQtMC4wMjEsMC4xMzQtMC4wNTNjMC4wNzQtMC4wNTgsMC4xMS0wLjE1MiwwLjA5Mi0wLjI0NQ0KCQkJQzQuNjgzLDIuNjYyLDQuODY5LDIuMTQxLDQuODY5LDIuMTQxeiIvPg0KCQk8cGF0aCBzdHlsZT0iZmlsbDojMDMwMTA0OyIgZD0iTTEyLjIyNCw5LjM2M2MtMC43MzgtMC40ODctMS44NTUtMC44NC0xLjg1NS0wLjg0QzkuMjQ4LDguMTI3LDkuMjQsNy43MzMsOS4yNCw3LjczMw0KCQkJYy0yLjIwMyw0LjM0NC0zLjg3NiwwLjAxNC0zLjg3NiwwLjAxNEM1LjIxLDguMzMzLDIuOTQxLDkuMDIxLDIuOTQxLDkuMDIxQzIuMjc4LDkuMjc1LDEuOTk4LDkuNjU3LDEuOTk4LDkuNjU3DQoJCQljLTAuOTgsMS40NTQtMS4wOTYsNC42ODktMS4wOTYsNC42ODljMC4wMTMsMC43MzksMC4zMzIsMC44MTYsMC4zMzIsMC44MTZjMi4yNTQsMS4wMDYsNS43OTIsMS4xODUsNS43OTIsMS4xODUNCgkJCWMwLjk4NSwwLjAyMSwxLjg5NC0wLjA0NywyLjcwMS0wLjE1NGMtMC43NzMtMC43MjMtMS4yNjItMS43NDgtMS4yNjItMi44ODdDOC40NjQsMTEuMTkyLDEwLjEzNCw5LjQ2NSwxMi4yMjQsOS4zNjN6Ii8+DQoJCTxwYXRoIHN0eWxlPSJmaWxsOiMwMzAxMDQ7IiBkPSJNMTIuMjY5LDkuOTYzYy0xLjc2OCwwLTMuMjA3LDEuNDM4LTMuMjA3LDMuMjA3YzAsMS43NzEsMS40MzksMy4yMDcsMy4yMDcsMy4yMDcNCgkJCWMxLjc3LDAsMy4yMDctMS40MzcsMy4yMDctMy4yMDdDMTUuNDc2LDExLjQwMiwxNC4wMzgsOS45NjMsMTIuMjY5LDkuOTYzeiBNMTIuMDU4LDE0Ljc0N2MtMC4wNjgsMC4wNjctMC4xNzgsMC4wNjctMC4yNDYsMA0KCQkJbC0xLjU0My0xLjU1NWMtMC4wNjgtMC4wNjYtMC4wNjgtMC4xNzgsMC0wLjI0NWwwLjM2OS0wLjM2OWMwLjA2OC0wLjA2NywwLjE3OC0wLjA2NywwLjI0NiwwbDEuMDUzLDEuMDYxbDIuMDQ1LTIuMDQ0DQoJCQljMC4wNjYtMC4wNjgsMC4xNzgtMC4wNjgsMC4yNDYsMGwwLjM2NywwLjM2N2MwLjA2OCwwLjA2OCwwLjA2OCwwLjE4LDAsMC4yNDhMMTIuMDU4LDE0Ljc0N3oiLz4NCgk8L2c+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg=='
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

const mapStateToProps = function(state) {
    return {
        sidenavopen: state.page.sidenavopen,
    };
};

const mapDispatchToProps = function(dispatch) {
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
