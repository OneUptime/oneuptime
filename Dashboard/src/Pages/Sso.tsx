import React, { Component } from 'react';
import { connect } from 'react-redux';

import { PropTypes } from 'prop-types';

import { Fade } from 'react-awesome-reveal';

import { User, PricingPlan } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../Utils/getParentRoute';
import Sso from '../components/settings/Sso';
import { history } from '../store';

interface SsoPageProps {
    location?: {
        pathname?: string
    };
    currentProject: object;
    switchToProjectViewerNav?: boolean;
}

class SsoPage extends Component<ComponentProps> {
    override componentDidMount() {

        const currentProject = JSON.parse(User.getProject());
        const isScalePlan = currentProject?.stripePlanId

            ? PricingPlan.getPlanById(currentProject.stripePlanId).category ===
            'Scale'
            : false;
        if (!isScalePlan) {
            history.push(`/dashboard/project/${currentProject.slug}`);
        }
    }
    override render() {
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
                <BreadCrumbItem route={pathname} name="Sso" />

                <Sso projectId={projectId} />
            </Fade>
        );
    }
}


SsoPage.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};


SsoPage.displayName = 'SsoPage';

const mapStateToProps: Function = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

export default connect(mapStateToProps)(SsoPage);
