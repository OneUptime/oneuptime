import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import StatusPagesTable from '../components/statusPage/StatusPagesTable'
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';

class StatusPage extends Component {

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('StatusPage Settings Loaded');
        }
    }

    render() {

        const { projectId } = this.props;

        return (
            <Dashboard>
                <div className="db-World-contentPane Box-root Padding-bottom--48">
                    <ShouldRender if={true}>
                        <TutorialBox type="status-page" />
                    </ShouldRender>

                    <StatusPagesTable projectId={projectId} />
                </div>
            </Dashboard>
        );
    }
}


const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({}, dispatch)
}


function mapStateToProps(state, props) {
    const { projectId } = props.match.params;
    return {
        statusPage: state.statusPage,
        projectId
    };
}

StatusPage.propTypes = {
    projectId: PropTypes.string.isRequired,
}

StatusPage.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

StatusPage.displayName = 'StatusPage'

export default connect(mapStateToProps, mapDispatchToProps)(StatusPage);