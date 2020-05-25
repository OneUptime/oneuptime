import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
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
            logEvent('StatusPage Settings Loaded');
        }
    }

    render() {
        const {
            projectId,
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <BreadCrumbItem route={pathname} name="Status Pages" />
                <ShouldRender if={this.props.statusPageTutorial.show}>
                    <TutorialBox type="status-page" />
                </ShouldRender>

                <StatusPagesTable projectId={projectId} />
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({}, dispatch);
};

function mapStateToProps(state, props) {
    const { projectId } = props.match.params;

    return {
        statusPage: state.statusPage,
        projectId,
        statusPageTutorial: state.tutorial.statusPage,
    };
}

StatusPage.propTypes = {
    projectId: PropTypes.string.isRequired,
    statusPageTutorial: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

StatusPage.displayName = 'StatusPage';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPage);
