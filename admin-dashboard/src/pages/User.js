import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import UserSetting from '../components/user/UserSetting';
import UserProject from '../components/user/UserProject';
import { fetchUserProjects } from '../actions/user';


class User extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('User page Loaded');
        }
    }

    ready = () => {
        this.props.fetchUserProjects(this.props.match.params.userId);
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
                                                <div className="Box-root Margin-bottom--12">
                                                    <UserSetting userId={this.props.match.params.userId} />
                                                </div>
                                                <div className="Box-root Margin-bottom--12">
                                                    <UserProject userId={this.props.match.params.userId} />
                                                </div>
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
    return bindActionCreators({ fetchUserProjects }, dispatch)
}

const mapStateToProps = state => {
    return {
    }
}

User.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

User.propTypes = {
    match: PropTypes.object.isRequired,
    fetchUserProjects: PropTypes.func.isRequired,
}

User.displayName = 'User'

export default connect(mapStateToProps, mapDispatchToProps)(User);
