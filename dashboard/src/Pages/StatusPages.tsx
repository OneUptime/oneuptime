import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';

import StatusPagesTable from '../components/status-page/StatusPagesTable';
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

interface StatusPagesProps {
    projectId: string;
    tutorialStat?: object;
    switchToProjectViewerNav?: boolean;
    currentProject?: object;
    location?: {
        pathname?: string
    };
    activeProjectId?: string;
}

class StatusPages extends Component<ComponentProps> {
    override render() {
        const {

            projectId,

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,

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

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem route={pathname} name="Status Pages" />

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

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({}, dispatch);
};

function mapStateToProps(state: RootState) {
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


StatusPages.displayName = 'StatusPages';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPages);
