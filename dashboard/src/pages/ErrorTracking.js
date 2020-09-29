import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import Dashboard from '../components/Dashboard';
import getParentRoute from '../utils/getParentRoute';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';

class ErrorTracking extends Component {
    render() {
        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
        }
        const {
            location: { pathname },
            component,
        } = this.props;

        const componentName = component ? component.name : '';
        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name={componentName}
                    />
                    <BreadCrumbItem route={pathname} name="Error Tracking" />
                    <div>Content to be here</div>
                </Fade>
            </Dashboard>
        );
    }
}

ErrorTracking.displayName = 'ErrorTracking';
const mapStateToProps = (state, ownProps) => {
    const { componentId } = ownProps.match.params;
    const currentProject = state.project.currentProject;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });
    return {
        currentProject,
        component,
    };
};

export default connect(mapStateToProps)(ErrorTracking);
