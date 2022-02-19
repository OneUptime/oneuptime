import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import PropTypes from 'prop-types';
import ShouldRender from '../../components/basic/ShouldRender';
import TutorialBox from '../../components/tutorial/TutorialBox';
import BreadCrumbItem from '../../components/breadCrumb/BreadCrumbItem';
import { history } from '../../store';

class Page extends Component {
    constructor({
        pageName,
        friendlyPageName,
        pagePath,
        breadCrumbsProps,
        showTutorial,
        ...props
    }) {
        super({
            history,
            pageName,
            friendlyPageName,
            pagePath,
            breadCrumbsProps,
            showTutorial,
            ...props,
        });
    }

    goToPageInProject(pathName) {
        const { projectId } = this.props;

        this.goToPage(`/dashboard/${projectId}/${pathName}`);
    }

    goToPage(pathName) {
        this.props.history.push(pathName);
    }

    renderCommon(children) {
        const {
            projectId,
            project,
            friendlyPageName,
            pagePath,
            showTutorial,
            pageName,
        } = this.props;

        const projectName = project ? project.name : '';
        const projectSlug = project ? project.slug : '';

        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={projectSlug}
                />

                <BreadCrumbItem route={pagePath} name={friendlyPageName} />

                <ShouldRender if={showTutorial}>
                    <TutorialBox type={pageName} currentProjectId={projectId} />
                </ShouldRender>
                {/** Render Children */}
                {children}
            </Fade>
        );
    }
}

export const defaultMapDispatchToProps = () => {
    return {};
};

export const defaultMapStateToProps = state => {
    return {
        projectId: state.project?.currentProject?._id,
        subProjectId: state.subProject?.activeSubProject?._id,
        project: state.project?.currentProject,
        subproject: state.subProject?.activeSubProject,
        currentActiveProjectId:
            state.project?.currentProject?._id ||
            state.subProject?.activeSubProject?._id,
        currentActiveProject:
            state.project?.currentProject || state.subProject?.activeSubProject,
        user: state.user.user,
        userId: state.user.user._id,
        userRoleByCurrentActiveProject: null,
        userRoleByProject: null,
        userRoleBySubProject: null,
    };
};

Page.defaultPropTypes = {
    projectId: PropTypes.string,
    subProjectId: PropTypes.string,
    project: PropTypes.shape({
        name: PropTypes.string,
        slug: PropTypes.string,
    }),
    subproject: PropTypes.object,
    currentActiveProjectId: PropTypes.string,
    currentActiveProject: PropTypes.object,
    user: PropTypes.object,
    userId: PropTypes.string,
    userRoleByCurrentActiveProject: PropTypes.string,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),

    pageName: PropTypes.string,
    friendlyPageName: PropTypes.string,
    pagePath: PropTypes.string,
    breadCrumbsProps: PropTypes.object,
    showTutorial: PropTypes.bool,
};

Page.propTypes = {
    ...Page.defaultPropTypes,
};

Page.displayName = 'Page';

export default Page;
