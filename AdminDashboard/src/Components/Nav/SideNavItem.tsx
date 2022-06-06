import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import { Link, withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { loadPage } from '../../actions/page';
import { navKeyBind, cleanBind } from '../../utils/keybinding';

export class SidebarNavItem extends Component<ComponentProps> {
    public static displayName = '';
    public static propTypes = {};

    constructor(props: $TSFixMe) {
        super(props);

        this.RenderListItems = this.RenderListItems.bind(this);
    }

    override componentDidMount() {
        const { route }: $TSFixMe = this.props;
        navKeyBind(route);

        route.subRoutes.map((subRoute: $TSFixMe) => {
            navKeyBind(subRoute);
            return subRoute;
        });
    }

    override componentWillUnmount() {
        const { route }: $TSFixMe = this.props;
        cleanBind(route);

        route.subRoutes.map((subRoute: $TSFixMe) => {
            cleanBind(subRoute);
            return subRoute;
        });
    }

    camalize = function camalize(str: $TSFixMe) {
        return str
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]+(.)/g, (m: $TSFixMe, chr: $TSFixMe) => {
                return chr.toUpperCase();
            });
    };

    routeInnerDiv = (route: $TSFixMe, isLinkActive: $TSFixMe) => {
        const routes: $TSFixMe = route.shortcut && route.shortcut.split('+');

        return (
            <div style={{ outline: 'none' }}>
                <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--4">
                    <div className="Box-root Flex-flex Flex-alignItems--center tooltip">
                        <div className="Box-root Flex-flex Flex-alignItems--center Margin-right--12">
                            <span
                                className={`db-SideNav-icon db-SideNav-icon--${
                                    route.icon
                                } ${
                                    isLinkActive
                                        ? 'db-SideNav-icon--selected'
                                        : null
                                }`}
                            />
                        </div>
                        <span
                            className={
                                'Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap' +
                                (isLinkActive
                                    ? ' Text-color--oneuptimeblue Text-fontWeight--bold'
                                    : ' Text-color--dark')
                            }
                        >
                            <span>{route.title}</span>
                        </span>
                        {route.shortcut && (
                            <span className="tooltiptext">
                                <strong>{routes[0]}</strong>
                                <span> then </span>
                                <strong>{routes[1]}</strong>
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    override render() {
        const { RenderListItems }: $TSFixMe = this;

        const { route, location, match, loadPage }: $TSFixMe = this.props;
        const path: $TSFixMe = route.path;
        const isLinkActive: $TSFixMe =
            location.pathname === path ||
            (location.pathname.match(/users\/([0-9]|[a-z])*/) &&
                route.title === 'Users') ||
            (location.pathname.match(/projects\/([0-9]|[a-z])*/) &&
                route.title === 'Projects');

        const isChildLinkActive = route.subRoutes.some((link: $TSFixMe) => {
            return link.path === match.url ? true : false;
        });

        const routeStyle: $TSFixMe = {
            position: 'relative',
        };

        return (
            <div id={this.camalize(route.title)} style={routeStyle}>
                <ShouldRender if={!route.invisible}>
                    <ShouldRender if={route.external}>
                        <a href={route.path}>
                            {this.routeInnerDiv(route, isLinkActive)}
                        </a>
                    </ShouldRender>
                    <ShouldRender if={!route.external}>
                        <Link
                            to={path}
                            onClick={() => {
                                return loadPage(route.title);
                            }}
                        >
                            {this.routeInnerDiv(route, isLinkActive)}
                        </Link>
                    </ShouldRender>
                </ShouldRender>
                <div>
                    <span>
                        <ShouldRender
                            if={
                                (isLinkActive && route.subRoutes.length) ||
                                isChildLinkActive
                            }
                        >
                            <ul style={{ marginBottom: '8px' }}>
                                <RenderListItems
                                    active={match.url}
                                    onLoad={(title: $TSFixMe) => {
                                        return loadPage(title);
                                    }}
                                />
                            </ul>
                        </ShouldRender>
                    </span>
                </div>
            </div>
        );
    }

    RenderListItems({ active, onLoad }: $TSFixMe) {
        return this.props.route.subRoutes.map(
            (child: $TSFixMe, index: $TSFixMe) => {
                const routes: $TSFixMe =
                    child.shortcut && child.shortcut.split('+');

                const removedLinks: $TSFixMe = ['User', 'Project'];
                if (
                    removedLinks.some(link => {
                        return link === child.title;
                    })
                ) {
                    return null;
                }

                if (child.visible) {
                    const link: $TSFixMe = child.path.replace(
                        ':userId',

                        this.props.match.params.userId
                    );
                    return (
                        <li
                            id={this.camalize(child.title)}
                            key={`nav ${index}`}
                        >
                            <div style={{ position: 'relative' }}>
                                <Link
                                    to={link}
                                    onClick={() => {
                                        return onLoad(child.title);
                                    }}
                                >
                                    <div style={{ outline: 'none' }}>
                                        <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--2">
                                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-left--32 tooltip">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span
                                                        className={
                                                            link === active
                                                                ? 'Text-color--oneuptimeblue Text-fontWeight--bold'
                                                                : ''
                                                        }
                                                    >
                                                        {child.title}
                                                    </span>
                                                </span>
                                                {child.shortcut && (
                                                    <span className="tooltiptext">
                                                        <strong>
                                                            {routes[0]}
                                                        </strong>
                                                        <span> then </span>
                                                        <strong>
                                                            {routes[1]}
                                                        </strong>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                                <div className="db-SideNav-item--root">
                                    <span></span>
                                </div>
                            </div>
                        </li>
                    );
                }
                return null;
            }
        );
    }
}

SidebarNavItem.displayName = 'SidebarNavItem';

const mapStateToProps: Function = () => {
    return {};
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators({ loadPage }, dispatch);
};

SidebarNavItem.propTypes = {
    match: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    route: PropTypes.object.isRequired,
    loadPage: PropTypes.func.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(SidebarNavItem)
);
