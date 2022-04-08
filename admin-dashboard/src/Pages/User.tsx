import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';

import UserSetting from '../components/user/UserSetting';
import UserProject from '../components/user/UserProject';
import UserHistory from '../components/user/UserHistory';
import UserDeleteBox from '../components/user/UserDeleteBox';
import UserRestoreBox from '../components/user/UserRestoreBox';
import UserBlockBox from '../components/user/UserBlockBox';
import UserUnblockBox from '../components/user/UserUnblockBox';
import AdminNotes from '../components/adminNote/AdminNotes';
import { fetchUserProjects } from '../actions/project';
import { addUserNote, fetchUser, fetchUserloginHistory } from '../actions/user';
import UserAdminModeEnableBox from '../components/user/UserAdminModeEnableBox';
import UserAdminModeDisableBox from '../components/user/UserAdminModeDisableBox';
import { User as LsUser } from '../config';

class User extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    componentDidMount = async () => {

        await this.props.fetchUserProjects(this.props.match.params.userId);

        await this.props.fetchUser(this.props.match.params.userId);

        await this.props.fetchUserloginHistory(this.props.match.params.userId);
    };

    override render() {
        return (
            <div className="Box-root Margin-vertical--12" >
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

                                                        this.props.match.params
                                                            .userId
                                                    }
                                                    addNote={

                                                        this.props.addUserNote
                                                    }
                                                    initialValues={

                                                        this.props.initialValues
                                                    }
                                                />
                                            </div>
                                            <ShouldRender
                                                if={
                                                    LsUser.getUserId() !==

                                                    this.props.match.params
                                                        .userId
                                                }
                                            >
                                                <div className="Box-root Margin-bottom--12">
                                                    <ShouldRender
                                                        if={

                                                            !this.props?.user
                                                                ?.isAdminMode &&

                                                            !this.props?.user
                                                                .deleted
                                                        }
                                                    >
                                                        <UserAdminModeEnableBox />
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={

                                                            this.props?.user
                                                                ?.isAdminMode &&

                                                            !this.props?.user
                                                                .deleted
                                                        }
                                                    >
                                                        <UserAdminModeDisableBox />
                                                    </ShouldRender>
                                                </div>
                                            </ShouldRender>
                                            <div className="Box-root Margin-bottom--12">
                                                <UserHistory

                                                    history={this.props.history}
                                                    userId={

                                                        this.props.match.params
                                                            .userId
                                                    }
                                                />
                                            </div>
                                            <ShouldRender
                                                if={
                                                    LsUser.getUserId() !==

                                                    this.props.match.params
                                                        .userId
                                                }
                                            >
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
                                            </ShouldRender>
                                        </div>
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        { fetchUserProjects, addUserNote, fetchUser, fetchUserloginHistory },
        dispatch
    );
};

const mapStateToProps = (state: RootState) => {
    const user = state.user.user.user || {};
    const history = state.user.loginHistory.history;

    return {
        user,
        history,
        initialValues: { adminNotes: user.adminNotes || [] },
    };
};


User.contextTypes = {};


User.propTypes = {
    match: PropTypes.object.isRequired,
    fetchUserProjects: PropTypes.func.isRequired,
    fetchUser: PropTypes.func.isRequired,
    user: PropTypes.object.isRequired,
    history: PropTypes.object,
    addUserNote: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
    fetchUserloginHistory: PropTypes.func,
};


User.displayName = 'User';

export default connect(mapStateToProps, mapDispatchToProps)(User);
