import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';

class Project extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('Project page Loaded');
        }
    }

    ready = () => {
    }

    render() {
        return (
            <Dashboard ready={this.ready}>
                <div className="db-World-contentPane Box-root Padding-bottom--48">

                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span data-reactroot="">
                                        <div>
                                            <div>
                                                
                                            </div>
                                        </div>
                                    </span>
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
    return bindActionCreators({ }, dispatch)
}

const mapStateToProps = (state) => {
    return {
        
    }
}

Project.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

Project.propTypes = {
}

Project.displayName = 'Project'

export default connect(mapStateToProps, mapDispatchToProps)(Project);
