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
import AdminNotes from '../components/adminNote/AdminNotes';
import { fetchUserProjects } from '../actions/project';
import { addUserNote, fetchUser } from '../actions/user';

class User extends Component {
    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('User page Loaded');
        }
    }

    ready = async () => {
        await this.props.fetchUserProjects(this.props.match.params.userId);
        await this.props.fetchUser(this.props.match.params.userId);
    };

    render() {
        return (
            <Dashboard ready={this.ready}>
                <div className="Box-root Margin-vertical--12">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span data-reactroot="">
                                        <div>
                                            <div>
                                                <div className="Box-root Margin-bottom--12">
                                                    <UserSetting />
                                                </div>
                                                <div className="Box-root Margin-bottom--12">
                                                    <UserProject />
                                                </div>
                                                <div className="Box-root Margin-bottom--12">
                                                    <AdminNotes
                                                        id={
                                                            this.props.match
                                                                .params.userId
                                                        }
                                                        addNote={
                                                            this.props
                                                                .addUserNote
                                                        }
                                                        initialValues={
                                                            this.props
                                                                .initialValues
                                                        }
                                                    />
                                                </div>
                                                <ShouldRender
                                                    if={
                                                        this.props.user &&
                                                        !this.props.user
                                                            .deleted &&
                                                        !this.props.user
                                                            .isBlocked
                                                    }
                                                >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserBlockBox />
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.props.user &&
                                                        !this.props.user
                                                            .deleted &&
                                                        this.props.user
                                                            .isBlocked
                                                    }
                                                >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserUnblockBox />
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.props.user &&
                                                        !this.props.user.deleted
                                                    }
                                                >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserDeleteBox />
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        this.props.user &&
                                                        this.props.user.deleted
                                                    }
                                                >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserRestoreBox />
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

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { fetchUserProjects, addUserNote, fetchUser },
        dispatch
    );
};

const mapStateToProps = state => {
    const user = state.user.user.user || {};

    return {
        user,
        initialValues: { adminNotes: user.adminNotes || [] },
    };
};

User.contextTypes = {
    mixpanel: PropTypes.object.isRequired,
};

User.propTypes = {
    match: PropTypes.object.isRequired,
    fetchUserProjects: PropTypes.func.isRequired,
    fetchUser: PropTypes.func.isRequired,
    user: PropTypes.object.isRequired,
    addUserNote: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
};

User.displayName = 'User';

export default connect(mapStateToProps, mapDispatchToProps)(User);
