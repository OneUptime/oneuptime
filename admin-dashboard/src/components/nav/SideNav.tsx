import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import NavItem from './SideNavItem';
import { allRoutes, groups } from '../../routes';
import { openModal, closeModal } from '../../actions/modal';
import { closeSideNav } from '../../actions/page';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter, Switch, Route } from 'react-router-dom';

class SideNav extends Component {
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return true;
            default:
                return false;
        }
    };

    render() {
        return (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeSideNav' does not exist on type 'Re... Remove this comment to see the full error message
            <ClickOutside onClickOutside={this.props.closeSideNav}>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className={`db-World-sideNavContainer${
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'sidenavopen' does not exist on type 'Rea... Remove this comment to see the full error message
                        this.props.sidenavopen ? ' open' : ''
                    }`}
                >
                    <div className="db-SideNav-container Box-root Box-background--surface Flex-flex Flex-direction--column Padding-top--20 Padding-right--2">
                        <div className="Box-root Margin-bottom--20">
                            <div>
                                <div>
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                                    <div tabIndex="-1" id="AccountSwitcherId">
                                        <div className="db-AccountSwitcherX-button Box-root Flex-flex Flex-alignItems--center">
                                            <div className="Box-root Margin-right--8">
                                                <img
                                                    style={{
                                                        marginLeft: 2,
                                                        verticalAlign: 'middle',
                                                        height: '30px',
                                                        width: '30px',
                                                        backgroundColor:
                                                            '#121212',
                                                        borderRadius: '50%',
                                                    }}
                                                    alt="warning"
                                                    src={
                                                        'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIGNvbnRlbnRTY3JpcHRUeXBlPSJ0ZXh0L2VjbWFzY3JpcHQiIHdpZHRoPSIzNzUiIHpvb21BbmRQYW49Im1hZ25pZnkiIGNvbnRlbnRTdHlsZVR5cGU9InRleHQvY3NzIiB2aWV3Qm94PSIwIDAgMzc1IDM3NC45OTk5OTEiIGhlaWdodD0iMzc0Ljk5OTk5MSIgcHJlc2VydmVBc3BlY3RSYXRpbz0ieE1pZFlNaWQgbWVldCIgdmVyc2lvbj0iMS4wIj48ZGVmcz48Zz48ZyBpZD0iZ2x5cGgtMC0wIi8+PGcgaWQ9ImdseXBoLTAtMSI+PHBhdGggZD0iTSA4MC45MDYyNSAtMTE2LjYwOTM3NSBMIDk5LjcxODc1IC0xMTYuNjA5Mzc1IEwgOTkuNzE4NzUgLTQzLjQyMTg3NSBDIDk5LjcxODc1IC0zNS45MjE4NzUgOTguNjQ0NTMxIC0yOS4xMTMyODEgOTYuNSAtMjMgQyA5NC4zNjMyODEgLTE2Ljg4MjgxMiA5MS4yNTM5MDYgLTExLjYyODkwNiA4Ny4xNzE4NzUgLTcuMjM0Mzc1IEMgODYuMzE2NDA2IC02LjM3ODkwNiA4NS40Mjk2ODggLTUuNTc4MTI1IDg0LjUxNTYyNSAtNC44MjgxMjUgQyA4My42MDkzNzUgLTQuMDc4MTI1IDgyLjY5NTMxMiAtMy4zMjgxMjUgODEuNzgxMjUgLTIuNTc4MTI1IEMgODAuODc1IC0xLjgyODEyNSA3OS45MTAxNTYgLTEuMTU2MjUgNzguODkwNjI1IC0wLjU2MjUgQyA3Ny44NjcxODggMC4wMzEyNSA3Ni44MjAzMTIgMC41OTM3NSA3NS43NSAxLjEyNSBDIDc0LjY4NzUgMS42NjQwNjIgNzMuNTYyNSAyLjE0ODQzOCA3Mi4zNzUgMi41NzgxMjUgQyA2Ni44MDA3ODEgNC44MjgxMjUgNjAuNTgyMDMxIDUuOTUzMTI1IDUzLjcxODc1IDUuOTUzMTI1IEMgMzkuNDU3MDMxIDUuOTUzMTI1IDI4LjI1MzkwNiAxLjcxODc1IDIwLjEwOTM3NSAtNi43NSBDIDEyLjA2NjQwNiAtMTUuMjI2NTYyIDguMDQ2ODc1IC0yNy4yMzgyODEgOC4wNDY4NzUgLTQyLjc4MTI1IEwgOC4wNDY4NzUgLTExNi42MDkzNzUgTCAzMS4zNTkzNzUgLTExNi42MDkzNzUgTCAzMS4zNTkzNzUgLTQ1LjIwMzEyNSBDIDMxLjM1OTM3NSAtMzUuMjIyNjU2IDMzLjI4OTA2MiAtMjcuNjYwMTU2IDM3LjE1NjI1IC0yMi41MTU2MjUgQyAzOC44NzUgLTIwLjE2MDE1NiA0MS4wNzAzMTIgLTE4LjM5MDYyNSA0My43NSAtMTcuMjAzMTI1IEMgNDYuNDI1NzgxIC0xNi4wMjM0MzggNDkuNzUgLTE1LjQzNzUgNTMuNzE4NzUgLTE1LjQzNzUgQyA2MS41NTA3ODEgLTE1LjQzNzUgNjcuMjg5MDYyIC0xNy43OTY4NzUgNzAuOTM3NSAtMjIuNTE1NjI1IEMgNzQuOTA2MjUgLTI3LjU1NDY4OCA3Ni44OTA2MjUgLTM1LjExNzE4OCA3Ni44OTA2MjUgLTQ1LjIwMzEyNSBMIDc2Ljg5MDYyNSAtMTE2LjYwOTM3NSBaIE0gODAuOTA2MjUgLTExNi42MDkzNzUgIi8+PC9nPjxnIGlkPSJnbHlwaC0wLTIiPjxwYXRoIGQ9Ik0gOS40ODQzNzUgLTg3LjY1NjI1IEMgMTEuNjI4OTA2IC04Ny42NTYyNSAxMy42MTMyODEgLTg3LjQ5MjE4OCAxNS40Mzc1IC04Ny4xNzE4NzUgQyAxNy4yNTc4MTIgLTg2Ljg0NzY1NiAxOSAtODYuMzM1OTM4IDIwLjY1NjI1IC04NS42NDA2MjUgQyAyMi4zMjAzMTIgLTg0Ljk1MzEyNSAyMy44NTE1NjIgLTg0LjA3MDMxMiAyNS4yNSAtODMgQyAyNi42NDQ1MzEgLTgxLjkyNTc4MSAyNy44MjgxMjUgLTgwLjY0MDYyNSAyOC43OTY4NzUgLTc5LjE0MDYyNSBDIDMwLjYxNzE4OCAtODAuOTYwOTM4IDMyLjcwNzAzMSAtODIuNTY2NDA2IDM1LjA2MjUgLTgzLjk1MzEyNSBDIDM1LjcwNzAzMSAtODQuMzkwNjI1IDM2LjM0NzY1NiAtODQuNzk2ODc1IDM2Ljk4NDM3NSAtODUuMTcxODc1IEMgMzcuNjI4OTA2IC04NS41NDY4NzUgMzguMzI4MTI1IC04NS44OTA2MjUgMzkuMDc4MTI1IC04Ni4yMDMxMjUgQyAzOS44MzU5MzggLTg2LjUyMzQzOCA0MC41OTM3NSAtODYuODIwMzEyIDQxLjM0Mzc1IC04Ny4wOTM3NSBDIDQyLjA5Mzc1IC04Ny4zNjMyODEgNDIuODQzNzUgLTg3LjY2MDE1NiA0My41OTM3NSAtODcuOTg0Mzc1IEMgNDUuMzAwNzgxIC04OC41MTU2MjUgNDcuMDY2NDA2IC04OC45MTQwNjIgNDguODkwNjI1IC04OS4xODc1IEMgNTAuNzEwOTM4IC04OS40NTcwMzEgNTIuNTkzNzUgLTg5LjU5Mzc1IDU0LjUzMTI1IC04OS41OTM3NSBDIDU5Ljg4MjgxMiAtODkuNTkzNzUgNjUuMDU0Njg4IC04OC41MTk1MzEgNzAuMDQ2ODc1IC04Ni4zNzUgQyA3NS4wMzUxNTYgLTg0LjIyNjU2MiA3OS40MDYyNSAtODEuMTE3MTg4IDgzLjE1NjI1IC03Ny4wNDY4NzUgQyA4Ni45MDYyNSAtNzIuOTcyNjU2IDg5Ljg1MTU2MiAtNjguMDM5MDYyIDkyIC02Mi4yNSBDIDkyLjc1IC02MC4zMTI1IDkzLjM2MzI4MSAtNTguMjY5NTMxIDkzLjg0Mzc1IC01Ni4xMjUgQyA5NC4zMzIwMzEgLTUzLjk4ODI4MSA5NC43MDcwMzEgLTUxLjc4OTA2MiA5NC45Njg3NSAtNDkuNTMxMjUgQyA5NS4yMzgyODEgLTQ3LjI4MTI1IDk1LjM3NSAtNDQuOTc2NTYyIDk1LjM3NSAtNDIuNjI1IEMgOTUuMzc1IC0zNS41NTA3ODEgOTQuMzAwNzgxIC0yOS4wMDc4MTIgOTIuMTU2MjUgLTIzIEMgOTEuMDkzNzUgLTIwLjEwMTU2MiA4OS44MzU5MzggLTE3LjM2NzE4OCA4OC4zOTA2MjUgLTE0Ljc5Njg3NSBDIDg2Ljk0MTQwNiAtMTIuMjIyNjU2IDg1LjI1IC05Ljg2MzI4MSA4My4zMTI1IC03LjcxODc1IEMgODIuNjc1NzgxIC02Ljg2MzI4MSA4MS45NTMxMjUgLTYuMDYyNSA4MS4xNDA2MjUgLTUuMzEyNSBDIDgwLjMzNTkzOCAtNC41NjI1IDc5LjUwMzkwNiAtMy44MTI1IDc4LjY0MDYyNSAtMy4wNjI1IEMgNzcuNzg1MTU2IC0yLjMxMjUgNzYuOTI5Njg4IC0xLjYxMzI4MSA3Ni4wNzgxMjUgLTAuOTY4NzUgQyA3NS4yMjI2NTYgLTAuMzIwMzEyIDc0LjMxMjUgMC4yNjU2MjUgNzMuMzQzNzUgMC43OTY4NzUgQyA3Mi4zNzUgMS4zMzU5MzggNzEuNDEwMTU2IDEuODIwMzEyIDcwLjQ1MzEyNSAyLjI1IEMgNjcuOTg0Mzc1IDMuNTM5MDYyIDY1LjQzNzUgNC40NzY1NjIgNjIuODEyNSA1LjA2MjUgQyA2MC4xODc1IDUuNjU2MjUgNTcuNTMxMjUgNS45NTMxMjUgNTQuODQzNzUgNS45NTMxMjUgQyA0OS4xNjQwNjIgNS45NTMxMjUgNDMuOTY4NzUgNC44MjgxMjUgMzkuMjUgMi41NzgxMjUgQyAzNy41MzEyNSAxLjgyODEyNSAzNS45MjE4NzUgMC45Njg3NSAzNC40MjE4NzUgMCBMIDM0LjQyMTg3NSAzOS40MDYyNSBMIDExLjkwNjI1IDM5LjQwNjI1IEwgMTEuOTA2MjUgLTYyLjI1IEMgMTEuOTA2MjUgLTY0LjcxODc1IDExLjQ3MjY1NiAtNjYuMzI4MTI1IDEwLjYwOTM3NSAtNjcuMDc4MTI1IEMgOS42NDg0MzggLTY3LjkyOTY4OCA4LjI1NzgxMiAtNjguMzU5Mzc1IDYuNDM3NSAtNjguMzU5Mzc1IEwgMS4xMjUgLTY4LjM1OTM3NSBMIDIuNTc4MTI1IC03My41IEwgNS42MjUgLTg0Ljc2NTYyNSBMIDYuNDM3NSAtODcuNjU2MjUgWiBNIDcyLjU0Njg3NSAtNDIuMTQwNjI1IEMgNzIuNTQ2ODc1IC00NC4zOTA2MjUgNzIuMzgyODEyIC00Ni40NzY1NjIgNzIuMDYyNSAtNDguNDA2MjUgQyA3MS43MzgyODEgLTUwLjM0Mzc1IDcxLjI4MTI1IC01Mi4xNDA2MjUgNzAuNjg3NSAtNTMuNzk2ODc1IEMgNzAuMTAxNTYyIC01NS40NjA5MzggNjkuNDI5Njg4IC01Ni45OTIxODggNjguNjcxODc1IC01OC4zOTA2MjUgQyA2Ny45MjE4NzUgLTU5Ljc4NTE1NiA2Ny4wNjY0MDYgLTYxLjA3MDMxMiA2Ni4xMDkzNzUgLTYyLjI1IEMgNjQuMTc5Njg4IC02NC41IDYxLjk1NzAzMSAtNjYuMTg3NSA1OS40Mzc1IC02Ny4zMTI1IEMgNTYuOTE0MDYyIC02OC40Mzc1IDU0LjIwNzAzMSAtNjkgNTEuMzEyNSAtNjkgQyA0OS4zNzUgLTY5IDQ3LjU0Njg3NSAtNjguNzUzOTA2IDQ1LjgyODEyNSAtNjguMjY1NjI1IEMgNDQuMTE3MTg4IC02Ny43ODUxNTYgNDIuNTE1NjI1IC02Ny4wNjY0MDYgNDEuMDE1NjI1IC02Ni4xMDkzNzUgQyAzOC4yMjI2NTYgLTY0LjM5MDYyNSAzNi4wMjM0MzggLTYyLjU2NjQwNiAzNC40MjE4NzUgLTYwLjY0MDYyNSBMIDM0LjQyMTg3NSAtMjIuNTE1NjI1IEMgMzYuNjcxODc1IC0yMC40ODQzNzUgMzkuMTMyODEyIC0xOC43Njk1MzEgNDEuODEyNSAtMTcuMzc1IEMgNDQuODIwMzEyIC0xNS43NTc4MTIgNDguMjAzMTI1IC0xNC45NTMxMjUgNTEuOTUzMTI1IC0xNC45NTMxMjUgQyA1NC45NTMxMjUgLTE0Ljk1MzEyNSA1Ny42ODc1IC0xNS41NDY4NzUgNjAuMTU2MjUgLTE2LjczNDM3NSBDIDYyLjYyNSAtMTguMDE1NjI1IDY0Ljc2OTUzMSAtMTkuNzgxMjUgNjYuNTkzNzUgLTIyLjAzMTI1IEMgNjcuNTUwNzgxIC0yMy4yMTg3NSA2OC4zNzg5MDYgLTI0LjUwMzkwNiA2OS4wNzgxMjUgLTI1Ljg5MDYyNSBDIDY5Ljc3MzQzOCAtMjcuMjg1MTU2IDcwLjM5MDYyNSAtMjguODQzNzUgNzAuOTIxODc1IC0zMC41NjI1IEMgNzEuNDYwOTM4IC0zMi4yODEyNSA3MS44NjcxODggLTM0LjEwMTU2MiA3Mi4xNDA2MjUgLTM2LjAzMTI1IEMgNzIuNDEwMTU2IC0zNy45NTcwMzEgNzIuNTQ2ODc1IC0zOS45OTIxODggNzIuNTQ2ODc1IC00Mi4xNDA2MjUgWiBNIDcyLjU0Njg3NSAtNDIuMTQwNjI1ICIvPjwvZz48L2c+PC9kZWZzPjxwYXRoIGZpbGw9InJnYig0OS40MDk0ODUlLCA4NS4wOTk3OTIlLCAzNC4xMTg2NTIlKSIgZD0iTSAzMzEuNzEwOTM4IDIzNS4yNTc4MTIgTCAyNjUuODEyNSAyMzUuMjU3ODEyIEMgMjYzLjEwMTU2MiAyMzUuMjU3ODEyIDI2MC44ODY3MTkgMjMzLjA0Njg3NSAyNjAuODg2NzE5IDIzMC4zMzIwMzEgTCAyNjAuODg2NzE5IDE2NC40MzM1OTQgQyAyNjAuODg2NzE5IDE2MS43MTg3NSAyNjMuMTAxNTYyIDE1OS41MDc4MTIgMjY1LjgxMjUgMTU5LjUwNzgxMiBMIDMzMS43MTA5MzggMTU5LjUwNzgxMiBDIDMzNC40MjU3ODEgMTU5LjUwNzgxMiAzMzYuNjM2NzE5IDE2MS43MTg3NSAzMzYuNjM2NzE5IDE2NC40MzM1OTQgTCAzMzYuNjM2NzE5IDIzMC4zMzIwMzEgQyAzMzYuNjM2NzE5IDIzMy4wNDY4NzUgMzM0LjQyNTc4MSAyMzUuMjU3ODEyIDMzMS43MTA5MzggMjM1LjI1NzgxMiBaIE0gMzMxLjcxMDkzOCAyMzUuMjU3ODEyICIgZmlsbC1vcGFjaXR5PSIxIiBmaWxsLXJ1bGU9Im5vbnplcm8iLz48ZyBmaWxsPSJyZ2IoMTAwJSwgMTAwJSwgMTAwJSkiIGZpbGwtb3BhY2l0eT0iMSI+PHVzZSB4PSIzOC4xMTMzNzYiIHk9IjI0MC45NzIyODkiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4bGluazpocmVmPSIjZ2x5cGgtMC0xIiB4bGluazp0eXBlPSJzaW1wbGUiIHhsaW5rOmFjdHVhdGU9Im9uTG9hZCIgeGxpbms6c2hvdz0iZW1iZWQiLz48L2c+PGcgZmlsbD0icmdiKDEwMCUsIDEwMCUsIDEwMCUpIiBmaWxsLW9wYWNpdHk9IjEiPjx1c2UgeD0iMTQ1Ljg3NjExIiB5PSIyNDAuOTcyMjg5IiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeGxpbms6aHJlZj0iI2dseXBoLTAtMiIgeGxpbms6dHlwZT0ic2ltcGxlIiB4bGluazphY3R1YXRlPSJvbkxvYWQiIHhsaW5rOnNob3c9ImVtYmVkIi8+PC9nPjwvc3ZnPg=='
                                                    }
                                                />
                                            </div>
                                            <div
                                                style={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--noWrap">
                                                    OneUptime Admin Dashboard
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isPublic' does not exist on type '{ grou... Remove this comment to see the full error message
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
                                                {group.routes.map((route: $TSFixMe) => {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SideNav.displayName = 'SideNav';

const mapStateToProps = function(state: $TSFixMe) {
    return {
        sidenavopen: state.page.sidenavopen,
    };
};

const mapDispatchToProps = function(dispatch: $TSFixMe) {
    return bindActionCreators(
        {
            openModal,
            closeModal,
            closeSideNav,
        },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SideNav.propTypes = {
    closeSideNav: PropTypes.func,
    sidenavopen: PropTypes.bool,
};
// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
SideNav.contextTypes = {};

// since sideNav is above page routes we have no access to the pages' props.match,
// we rebuild the routes here to enable access to these properties

const WrappedSideNav = (props: $TSFixMe) => {
    return (
        <Switch>
            {allRoutes
                .filter(route => route.visible)
                .map((route, index) => {
                    return (
                        <Route
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'exact' does not exist on type '{ title: ... Remove this comment to see the full error message
                            exact={route.exact}
                            path={route.path}
                            key={index}
                            render={(routeProps: $TSFixMe) => <SideNav {...props} {...routeProps} />}
                        />
                    );
                })}
        </Switch>
    );
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(WrappedSideNav)
);
