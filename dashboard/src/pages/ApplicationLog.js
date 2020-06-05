import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import NewApplicationLog from '../components/application/NewApplicationLog';
import getParentRoute from '../utils/getParentRoute';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { fetchApplicationLogs } from '../actions/applicationLog';
import { bindActionCreators } from 'redux';
import { logEvent } from '../analytics';
import { loadPage } from '../actions/page';
import { ApplicationLogList } from '../components/application/ApplicationLogList';

class ApplicationLog extends Component {
    componentDidMount() {
        this.props.loadPage('Application Logs');
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > APPLICATION LOG LIST'
            );
        }
    }
    ready = () => {
        const componentId = this.props.match.params.componentId
            ? this.props.match.params.componentId
            : null;

        this.props.fetchApplicationLogs(componentId);
    };
    render() {
        const {
            location: { pathname },
            component,
            componentId,
        } = this.props;

        const applicationLogsList =
            this.props.applicationLog &&
            this.props.applicationLog.length > 0 ? (
                <div
                    id={`box_${componentId}`}
                    className="Box-root Margin-vertical--12"
                >
                    <div
                        className="db-Trends Card-root"
                        style={{ overflow: 'visible' }}
                    >
                        <ApplicationLogList
                            applicationLogs={this.props.applicationLog}
                        />
                    </div>
                </div>
            ) : (
                false
            );

        const componentName = component.length > 0 ? component[0].name : null;
        return (
            <Dashboard ready={this.ready}>
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name={componentName}
                />
                <BreadCrumbItem route={pathname} name="Application Log" />
                <div>
                    <div>
                        <div className="db-RadarRulesLists-page">
                            <ShouldRender
                                if={this.props.applicationLogTutorial.show}
                            >
                                <TutorialBox type="applicationLog" />
                            </ShouldRender>
                            {applicationLogsList}
                            <NewApplicationLog
                                index={2000}
                                formKey="NewApplicationLogForm"
                                componentId={this.props.componentId}
                            />
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchApplicationLogs,
            loadPage,
        },
        dispatch
    );
};
const mapStateToProps = (state, props) => {
    const { componentId } = props.match.params;

    const applicationLog =
        state.applicationLog.applicationLogsList.applicationLogs;

    const component = state.component.componentList.components.map(item => {
        return item.components.find(component => component._id === componentId);
    });
    return {
        applicationLogTutorial: state.tutorial.applicationLog,
        componentId,
        component,
        applicationLog,
    };
};
ApplicationLog.propTypes = {
    applicationLogTutorial: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    componentId: PropTypes.string,
    loadPage: PropTypes.func,
};
export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLog);
