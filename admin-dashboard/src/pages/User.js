import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import UserSetting from '../components/user/UserSetting';
import UserProject from '../components/user/UserProject';
import UserDeleteBox from '../components/user/UserDeleteBox';
import UserRestoreBox from '../components/user/UserRestoreBox';
import UserBlockBox from '../components/user/UserBlockBox';
import UserUnblockBox from '../components/user/UserUnblockBox';
import { fetchUserProjects } from '../actions/project';


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
                                                <ShouldRender if={this.props.user && !this.props.user.deleted && !this.props.user.isBlocked} >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserBlockBox userId={this.props.match.params.userId} />
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender if={this.props.user && !this.props.user.deleted && this.props.user.isBlocked} >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserUnblockBox userId={this.props.match.params.userId} />
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender if={this.props.user && !this.props.user.deleted} >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserDeleteBox userId={this.props.match.params.userId} />
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender if={this.props.user && this.props.user.deleted} >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserRestoreBox userId={this.props.match.params.userId} />
                                                    </div>
                                                </ShouldRender>
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

const mapStateToProps = (state, props) => {
    const user = state.user.users.users.find(user => user._id === props.match.params.userId);
    return {
        user
    }
}

User.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

User.propTypes = {
    match: PropTypes.object.isRequired,
    fetchUserProjects: PropTypes.func.isRequired,
    user: PropTypes.object.isRequired,
}

User.displayName = 'User'

export default connect(mapStateToProps, mapDispatchToProps)(User);
