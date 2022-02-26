import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link, withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { loadPage } from '../../actions/page';
import { navKeyBind, cleanBind } from '../../utils/keybinding';

export class SidebarNavItem extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.RenderListItems = this.RenderListItems.bind(this);
    }

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { route } = this.props;
        navKeyBind(route);

        route.subRoutes.map((subRoute: $TSFixMe) => {
            navKeyBind(subRoute);
            return subRoute;
        });
    }

    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { route } = this.props;
        cleanBind(route);

        route.subRoutes.map((subRoute: $TSFixMe) => {
            cleanBind(subRoute);
            return subRoute;
        });
    }

    camalize = function camalize(str: $TSFixMe) {
        return str
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]+(.)/g, (m: $TSFixMe, chr: $TSFixMe) => chr.toUpperCase());
    };

    routeInnerDiv = (route: $TSFixMe, isLinkActive: $TSFixMe) => {
        const routes = route.shortcut && route.shortcut.split('+');

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

    render() {
        const { RenderListItems } = this;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { route, location, match, loadPage } = this.props;
        const path = route.path;
        const isLinkActive =
            location.pathname === path ||
            (location.pathname.match(/users\/([0-9]|[a-z])*/) &&
                route.title === 'Users') ||
            (location.pathname.match(/projects\/([0-9]|[a-z])*/) &&
                route.title === 'Projects');

        const isChildLinkActive = route.subRoutes.some((link: $TSFixMe) => {
            return link.path === match.url ? true : false;
        });

        const routeStyle = {
            position: 'relative',
        };

        return (
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ position: string; }' is not assignable to ... Remove this comment to see the full error message
            <div id={this.camalize(route.title)} style={routeStyle}>
                <ShouldRender if={!route.invisible}>
                    <ShouldRender if={route.external}>
                        <a href={route.path}>
                            {this.routeInnerDiv(route, isLinkActive)}
                        </a>
                    </ShouldRender>
                    <ShouldRender if={!route.external}>
                        <Link to={path} onClick={() => loadPage(route.title)}>
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
                                    onLoad={(title: $TSFixMe) => loadPage(title)}
                                />
                            </ul>
                        </ShouldRender>
                    </span>
                </div>
            </div>
        );
    }

    RenderListItems({
        active,
        onLoad
    }: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'route' does not exist on type 'Readonly<... Remove this comment to see the full error message
        return this.props.route.subRoutes.map((child: $TSFixMe, index: $TSFixMe) => {
            const routes = child.shortcut && child.shortcut.split('+');

            const removedLinks = ['User', 'Project'];
            if (removedLinks.some(link => link === child.title)) return null;

            if (child.visible) {
                const link = child.path.replace(
                    ':userId',
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                    this.props.match.params.userId
                );
                return (
                    <li id={this.camalize(child.title)} key={`nav ${index}`}>
                        <div style={{ position: 'relative' }}>
                            <Link to={link} onClick={() => onLoad(child.title)}>
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
                                                    <strong>{routes[0]}</strong>
                                                    <span> then </span>
                                                    <strong>{routes[1]}</strong>
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
            } else {
                return null;
            }
        });
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SidebarNavItem.displayName = 'SidebarNavItem';

const mapStateToProps = () => ({});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ loadPage }, dispatch);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SidebarNavItem.propTypes = {
    match: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    route: PropTypes.object.isRequired,
    loadPage: PropTypes.func.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(SidebarNavItem)
);
