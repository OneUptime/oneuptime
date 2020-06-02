import React, { Component } from 'react'
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';



class ApplicationLog extends Component {
    render() {
        return (
            <Dashboard>
                <BreadCrumbItem route="#" name="Test"/>
                <BreadCrumbItem route="#" name="Application Log" />
                <div>
                    <div>
                        <div className="db-RadarRulesLists-page">
                            <ShouldRender if={this.props.applicationLogTutorial.show}>
                                <TutorialBox type="applicationLog" />
                            </ShouldRender>

                        </div>
                    </div>
                </div>
            </Dashboard>
        )
    }
}
const mapStateToProps = (state) => {
    return {
        applicationLogTutorial: state.tutorial.incident,
    };
};
ApplicationLog.propTypes = {
    applicationLogTutorial: PropTypes.object,
};
export default connect(mapStateToProps)(ApplicationLog);
