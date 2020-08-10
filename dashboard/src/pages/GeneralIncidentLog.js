import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
// import getParentRoute from '../utils/getParentRoute';
import TutorialBox from '../components/tutorial/TutorialBox';
import { connect } from 'react-redux';
import { PropTypes } from 'prop-types';

class GeneralIncidentLog extends Component {
    render() {
        const {
            location: { pathname },
            component,
        } = this.props;
        // const componentName = component ? component.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem route={pathname} name="Incident Log" />
                    <div>
                        <div>
                            <div className="db-RadarRulesLists-page">
                                <TutorialBox type="incident" />
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

GeneralIncidentLog.displayName = 'GeneralIncidentLog';

const mapStateToProps = (state, props) => {
    const { componentId } = props.match.params;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });

    return {
        component,
    };
};

const mapDispatchToProps = dispatch => {
    return {};
};

GeneralIncidentLog.propTypes = {
    component: PropTypes.shape({ name: PropTypes.string }),
    location: PropTypes.shape({ pathname: PropTypes.string }),
};

export default connect(mapStateToProps, mapDispatchToProps)(GeneralIncidentLog);
