import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
// @ts-expect-error ts-migrate(2613) FIXME: Module '"/home/nawazdhandala/Projects/OneUptime/ap... Remove this comment to see the full error message
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

class User extends Component {
    componentDidMount = async () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserProjects' does not exist on typ... Remove this comment to see the full error message
        await this.props.fetchUserProjects(this.props.match.params.userId);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUser' does not exist on type 'Reado... Remove this comment to see the full error message
        await this.props.fetchUser(this.props.match.params.userId);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserloginHistory' does not exist on... Remove this comment to see the full error message
        await this.props.fetchUserloginHistory(this.props.match.params.userId);
    };

    render() {
        return (
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
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ id: any; addNote: any; initialValues: any;... Remove this comment to see the full error message
                                                    id={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                        this.props.match.params
                                                            .userId
                                                    }
                                                    addNote={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addUserNote' does not exist on type 'Rea... Remove this comment to see the full error message
                                                        this.props.addUserNote
                                                    }
                                                    initialValues={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                                                        this.props.initialValues
                                                    }
                                                />
                                            </div>
                                            <ShouldRender
                                                if={
                                                    LsUser.getUserId() !==
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                    this.props.match.params
                                                        .userId
                                                }
                                            >
                                                <div className="Box-root Margin-bottom--12">
                                                    <ShouldRender
                                                        if={
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                            !this.props?.user
                                                                ?.isAdminMode &&
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                            !this.props?.user
                                                                .deleted
                                                        }
                                                    >
                                                        <UserAdminModeEnableBox />
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                            this.props?.user
                                                                ?.isAdminMode &&
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ history: any; userId: any; }' is not assig... Remove this comment to see the full error message
                                                    history={this.props.history}
                                                    userId={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                        this.props.match.params
                                                            .userId
                                                    }
                                                />
                                            </div>
                                            <ShouldRender
                                                if={
                                                    LsUser.getUserId() !==
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                    this.props.match.params
                                                        .userId
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        this.props.user &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        !this.props.user
                                                            .deleted &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        this.props.user &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        !this.props.user
                                                            .deleted &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        this.props.user &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        !this.props.user.deleted
                                                    }
                                                >
                                                    <div className="Box-root Margin-bottom--12">
                                                        <UserDeleteBox />
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        this.props.user &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { fetchUserProjects, addUserNote, fetchUser, fetchUserloginHistory },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe) => {
    const user = state.user.user.user || {};
    const history = state.user.loginHistory.history;

    return {
        user,
        history,
        initialValues: { adminNotes: user.adminNotes || [] },
    };
};

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
User.contextTypes = {};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
User.displayName = 'User';

export default connect(mapStateToProps, mapDispatchToProps)(User);
