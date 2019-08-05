import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { Link, withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';

export class SidebarNavItem extends Component {

    constructor(props) {
        super(props);

        this.RenderListItems = this.RenderListItems.bind(this);
    }
    
    camalize = function camalize(str) {
        return str.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase());
    }

    render() {
        const { RenderListItems } = this;
        const { route, location, schedule, match, currentProject } = this.props;
        var path = route.path.replace(':projectId', match.params.projectId || (currentProject || {})._id);
        path = path.replace(':subProjectId', match.params.subProjectId);
        const isLinkActive = location.pathname === path 
        
        const isChildLinkActive = false

        const routeStyle = {
            position: 'relative'
        };

        return (
            <div id={this.camalize(route.title)} style={routeStyle}>
                <ShouldRender if={!route.invisible}>
                    <Link to={path}>
                        <div style={{ outline: 'none' }}>
                            <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--4">
                                <div className="Box-root Flex-flex Flex-alignItems--center">
                                    <div className="Box-root Flex-flex Flex-alignItems--center Margin-right--12">
                                        <span
                                            className={`db-SideNav-icon db-SideNav-icon--${route.icon} ${(isLinkActive ? 'db-SideNav-icon--selected' : null)}`}
                                        />
                                    </div>
                                    <span className={'Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap' + (isLinkActive ? ' Text-color--fyipeblue Text-fontWeight--bold' : ' Text-color--dark')}>
                                        <span>{route.title}</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </Link>
                </ShouldRender>
                <div>
                    <span>
                        <ShouldRender if={(isLinkActive && route.subRoutes.length) || isChildLinkActive}>
                            <ul style={{ marginBottom: '8px' }}>
                                <RenderListItems
                                    projectId={match.params.projectId}
                                    schedule={schedule}
                                    active={match.url}
                                />
                            </ul>
                        </ShouldRender>
                    </span>
                </div>
            </div>
        );
    }

    RenderListItems({ active, link }) {
        return this.props.route.subRoutes.map((child, index) => {
            if (child.visible) {
                return (
                    <li id={this.camalize(child.title)} key={`nav ${index}`}>
                        <div style={{ position: 'relative' }}>
                            <Link to={link}>
                                <div style={{ outline: 'none' }}>
                                    <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--2">
                                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-left--32">
                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span className={link === active ? 'Text-color--fyipeblue Text-fontWeight--bold' : ''}>
                                                    {child.title}
                                                </span>
                                            </span>
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
            else {
                return null;
            }
        });
    }
}

SidebarNavItem.displayName = 'SidebarNavItem'

let mapStateToProps = state => ({})

SidebarNavItem.propTypes = {
    match: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    route: PropTypes.object.isRequired,
}

export default withRouter(connect(mapStateToProps)(SidebarNavItem));