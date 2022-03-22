import React, { Component } from 'react';
import { connect } from 'react-redux';

import { PropTypes } from 'prop-types';

import { Fade } from 'react-awesome-reveal';

import ResourceCategories from '../components/settings/ResourceCategories';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';

class Resources extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
    }

    render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem

                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Resources" />
                <div className="Margin-vertical--12">
                    <div>
                        <div
                            id="resourceCategories"
                            className="db-BackboneViewContainer"
                        >
                            <div className="react-settings-view react-view">
                                <span>
                                    <div>
                                        <ResourceCategories />
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}


Resources.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};


Resources.displayName = 'Resources';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};
export default connect(mapStateToProps)(Resources);
