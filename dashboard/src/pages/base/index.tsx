import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
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
    }: $TSFixMe) {
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

    goToPageInProject(pathName: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId } = this.props;

        this.goToPage(`/dashboard/${projectId}/${pathName}`);
    }

    goToPage(pathName: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
        this.props.history.push(pathName);
    }

    renderCommon(children: $TSFixMe) {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            project,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'friendlyPageName' does not exist on type... Remove this comment to see the full error message
            friendlyPageName,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'pagePath' does not exist on type 'Readon... Remove this comment to see the full error message
            pagePath,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showTutorial' does not exist on type 'Re... Remove this comment to see the full error message
            showTutorial,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'pageName' does not exist on type 'Readon... Remove this comment to see the full error message
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

export const defaultMapStateToProps = (state: $TSFixMe) => {
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
        user: state.user?.user,
        userId: state.user?.user?._id,
        userRoleByCurrentActiveProject: null,
        userRoleByProject: null,
        userRoleBySubProject: null,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'defaultPropTypes' does not exist on type... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Page.propTypes = {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'defaultPropTypes' does not exist on type... Remove this comment to see the full error message
    ...Page.defaultPropTypes,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Page.displayName = 'Page';

export default Page;
