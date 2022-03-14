import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module '../components/status-page/Stat... Remove this comment to see the full error message
import StatusPagesTable from '../components/status-page/StatusPagesTable';
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

class StatusPages extends Component {
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
            activeProjectId,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem route={pathname} name="Status Pages" />
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                <ShouldRender if={this.props.tutorialStat.statusPage.show}>
                    <TutorialBox
                        type="status-page"
                        currentProjectId={projectId}
                    />
                </ShouldRender>

                <StatusPagesTable projectId={activeProjectId} />
            </Fade>
        );
    }
}

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({}, dispatch);
};

function mapStateToProps(state: $TSFixMe) {
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
        statusPage: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    return {
        statusPage: state.statusPage,
        projectId,
        tutorialStat,
        currentProject:
            state.project.currentProject && state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject?.activeSubProject,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
StatusPages.propTypes = {
    projectId: PropTypes.string.isRequired,
    tutorialStat: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
    currentProject: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    activeProjectId: PropTypes.string,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
StatusPages.displayName = 'StatusPages';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPages);
