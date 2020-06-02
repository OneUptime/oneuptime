import React, { Component } from 'react'
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import NewApplicationLog from '../components/application/NewApplicationLog';
import getParentRoute from '../utils/getParentRoute';



class ApplicationLog extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }
    render() {
        const {
            location: { pathname },
            component,
        } = this.props;

        const componentName = component.length > 0 ? component[0].name : null;
        return (
            <Dashboard>
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name={componentName}
                />
                <BreadCrumbItem route={pathname} name="Application Log" />
                <div>
                    <div>
                        <div className="db-RadarRulesLists-page">
                            <ShouldRender if={this.props.applicationLogTutorial.show}>
                                <TutorialBox type="applicationLog" />
                            </ShouldRender>
                            <NewApplicationLog/>
                        </div>
                    </div>
                </div>
            </Dashboard>
        )
    }
}
const mapStateToProps = (state,props) => {
    const { componentId } = props.match.params;
    
    const component = state.component.componentList.components.map(item => {
        return item.components.find(component => component._id === componentId);
    });
    return {
        applicationLogTutorial: state.tutorial.incident,
        componentId,
        component,
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
};
export default connect(mapStateToProps)(ApplicationLog);
