import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';

class DashboardView extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('Main page Loaded');
        }
    }

    render() {
        return (
            <Dashboard ready={this.ready}>
                <div className="db-World-contentPane Box-root Padding-bottom--48">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="dashboard-home-view react-view">
                                    <div>
                                        <div>
                                            <span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ destroy }, dispatch)
}

const mapStateToProps = state => {

    return {
    };
}

DashboardView.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

DashboardView.propTypes = {
}

DashboardView.displayName = 'DashboardView'

export default connect(mapStateToProps, mapDispatchToProps)(DashboardView);