import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import StatusPagesTable from '../components/statusPage/StatusPagesTable';
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

class StatusPage extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > STATUS PAGE LIST');
        }
    }

    render() {
        const {
            projectId,
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem route={pathname} name="Status Pages" />
                    <ShouldRender if={this.props.tutorialStat.statusPage.show}>
                        <TutorialBox
                            type="status-page"
                            currentProjectId={projectId}
                        />
                    </ShouldRender>

                    <StatusPagesTable projectId={projectId} />
                </Fade>
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({}, dispatch);
};

function mapStateToProps(state) {
    const projectId =
        state.project.currentProject !== null &&
        state.project.currentProject._id;
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
    };
}

StatusPage.propTypes = {
    projectId: PropTypes.string.isRequired,
    tutorialStat: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

StatusPage.displayName = 'StatusPage';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPage);
