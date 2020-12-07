import React, { Component } from 'react';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

class ErrorEventIssueMember extends Component {
    constructor(props) {
        super(props);
        this.state = {
            isViewAssigned: true,
        };
    }
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };
    removeMemberFromIssue = member => {
        const { updateErrorEventMember, errorTrackerIssue } = this.props.data;
        updateErrorEventMember(
            errorTrackerIssue._id,
            member.userId._id,
            'unassign'
        );
    };
    addMemberToIssue = member => {
        const { updateErrorEventMember, errorTrackerIssue } = this.props.data;
        updateErrorEventMember(errorTrackerIssue._id, member.userId, 'assign');
    };
    toggleBoxState = () => {
        this.setState(state => ({
            isViewAssigned: !state.isViewAssigned,
        }));
    };
    render() {
        const { isViewAssigned } = this.state;
        const { data, closeThisDialog, errorTrackerIssueMembers } = this.props;

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM db-InviteSetting">
                    <div className="bs-Modal bs-Modal--xlarge">
                        <div className="bs-Modal-content bs-u-paddingless">
                            <div className="bs-Modal-block bs-u-paddingless">
                                <div>
                                    <ShouldRender if={isViewAssigned}>
                                        <div className="Box-root">
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                            <span
                                                                style={{
                                                                    textTransform:
                                                                        'capitalize',
                                                                }}
                                                            >
                                                                Team Members
                                                                Assigned (
                                                                {
                                                                    data
                                                                        .errorTrackerIssue
                                                                        .members
                                                                        .length
                                                                }
                                                                )
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                List on team
                                                                members assigned
                                                                to error event{' '}
                                                                <span
                                                                    style={{
                                                                        fontWeight:
                                                                            'bold',
                                                                    }}
                                                                >
                                                                    {
                                                                        data
                                                                            .errorTrackerIssue
                                                                            .name
                                                                    }
                                                                </span>
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                        <div className="Box-root">
                                                            {/* <RenderIfAdmin
                                                                if={true}
                                                            > */}
                                                            <button
                                                                id={`btn_${data.errorTrackerIssue.name}`}
                                                                onClick={() =>
                                                                    this.toggleBoxState()
                                                                }
                                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                                type="button"
                                                            >
                                                                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                    <div className="Box-root Margin-right--8">
                                                                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                                                    </div>

                                                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                        <span>
                                                                            Assign
                                                                            New
                                                                            Team
                                                                            Member
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                            </button>
                                                            {/* </RenderIfAdmin> */}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-ContentSection-content Box-root">
                                                <div className="bs-ObjectList db-UserList">
                                                    <div>
                                                        <div className="bs-ObjectList-rows">
                                                            <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                                                <div className="bs-ObjectList-cell">
                                                                    Member
                                                                </div>
                                                                <div className="bs-ObjectList-cell">
                                                                    Status
                                                                </div>
                                                                <div className="bs-ObjectList-cell"></div>
                                                                <div
                                                                    className="bs-ObjectList-cell"
                                                                    style={{
                                                                        float:
                                                                            'right',
                                                                        marginRight:
                                                                            '10px',
                                                                    }}
                                                                >
                                                                    Action
                                                                </div>
                                                            </header>
                                                            {data.errorTrackerIssue &&
                                                            data
                                                                .errorTrackerIssue
                                                                .members &&
                                                            data
                                                                .errorTrackerIssue
                                                                .members
                                                                .length > 0 ? (
                                                                data.errorTrackerIssue.members.map(
                                                                    (
                                                                        member,
                                                                        i
                                                                    ) => {
                                                                        return (
                                                                            <div
                                                                                className="bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                                                key={
                                                                                    i
                                                                                }
                                                                            >
                                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                    <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                                                                        {
                                                                                            <span>
                                                                                                <img
                                                                                                    src="/dashboard/assets/img/profile-user.svg"
                                                                                                    className="userIcon"
                                                                                                    style={{
                                                                                                        marginRight:
                                                                                                            '5px',
                                                                                                    }}
                                                                                                    alt=""
                                                                                                />
                                                                                                <span>
                                                                                                    {member
                                                                                                        .userId
                                                                                                        .name
                                                                                                        ? member
                                                                                                              .userId
                                                                                                              .name
                                                                                                        : member
                                                                                                              .userId
                                                                                                              .email
                                                                                                        ? member
                                                                                                              .userId
                                                                                                              .email
                                                                                                        : 'N/A'}
                                                                                                </span>
                                                                                            </span>
                                                                                        }
                                                                                    </div>
                                                                                </div>

                                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                Assigned
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="bs-ObjectList-cell bs-u-v-middle"></div>
                                                                                <div className="bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween">
                                                                                    <div>
                                                                                        <div className="Flex-flex Flex-alignContent--spaceBetween">
                                                                                            <button
                                                                                                title="delete"
                                                                                                disabled={
                                                                                                    this
                                                                                                        .props
                                                                                                        .deleting
                                                                                                }
                                                                                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                                                                type="button"
                                                                                                onClick={() =>
                                                                                                    this.removeMemberFromIssue(
                                                                                                        member
                                                                                                    )
                                                                                                }
                                                                                            >
                                                                                                {!(
                                                                                                    errorTrackerIssueMembers &&
                                                                                                    errorTrackerIssueMembers[
                                                                                                        member
                                                                                                            .userId
                                                                                                            ._id
                                                                                                    ] &&
                                                                                                    errorTrackerIssueMembers[
                                                                                                        member
                                                                                                            .userId
                                                                                                            ._id
                                                                                                    ]
                                                                                                        .requesting
                                                                                                ) && (
                                                                                                    <span>
                                                                                                        Remove
                                                                                                    </span>
                                                                                                )}
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    }
                                                                )
                                                            ) : (
                                                                <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withName">
                                                                    <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                        <span>
                                                                            {' '}
                                                                            No
                                                                            Team
                                                                            Member
                                                                            has
                                                                            been
                                                                            assigned
                                                                            to
                                                                            this
                                                                            Issue
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <ShouldRender if={!isViewAssigned}>
                                        <div className="Box-root">
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                            <span
                                                                style={{
                                                                    textTransform:
                                                                        'capitalize',
                                                                }}
                                                            >
                                                                Assign New Team
                                                                Members
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                instruction on
                                                                how to add
                                                                member to the
                                                                error issue{' '}
                                                                <span
                                                                    style={{
                                                                        textTransform:
                                                                            'lowercase',
                                                                    }}
                                                                >
                                                                    error event
                                                                    description
                                                                    .
                                                                </span>
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                        <div className="Box-root">
                                                            {/* <RenderIfSubProjectAdmin
                                        subProjectId={props.teamMembers._id}
                                    > */}
                                                            <button
                                                                // id={`btn_${props.subProjectName}`}
                                                                onClick={() =>
                                                                    this.toggleBoxState()
                                                                }
                                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                                type="button"
                                                            >
                                                                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                    <div className="Box-root Margin-right--8">
                                                                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                                                    </div>
                                                                    {/* {props.allTeamLength === 1 ? (
                                                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                                    <span>
                                                        Invite Team Member
                                                    </span>
                                                    <span className="new-btn__keycode">
                                                        N
                                                    </span>
                                                </span>
                                            ) : ( */}
                                                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--more">
                                                                        <span>
                                                                            View
                                                                            Existing
                                                                            Team
                                                                            Member
                                                                        </span>
                                                                    </span>
                                                                    {/* )} */}
                                                                </div>
                                                            </button>
                                                            {/* </RenderIfSubProjectAdmin> */}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-ContentSection-content Box-root">
                                                <div className="bs-ObjectList db-UserList">
                                                    <div>
                                                        <div className="bs-ObjectList-rows">
                                                            <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                                                <div className="bs-ObjectList-cell">
                                                                    Team Member
                                                                </div>
                                                                <div className="bs-ObjectList-cell">
                                                                    Status
                                                                </div>
                                                                <div className="bs-ObjectList-cell"></div>
                                                                <div
                                                                    className="bs-ObjectList-cell"
                                                                    style={{
                                                                        float:
                                                                            'right',
                                                                        marginRight:
                                                                            '10px',
                                                                    }}
                                                                >
                                                                    Action
                                                                </div>
                                                            </header>
                                                            {data.errorTrackerIssue &&
                                                            data
                                                                .errorTrackerIssue
                                                                .memberNotAssignedToIssue &&
                                                            data
                                                                .errorTrackerIssue
                                                                .memberNotAssignedToIssue
                                                                .length > 0 ? (
                                                                data.errorTrackerIssue.memberNotAssignedToIssue.map(
                                                                    (
                                                                        member,
                                                                        i
                                                                    ) => {
                                                                        return (
                                                                            <div
                                                                                className="bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                                                key={
                                                                                    i
                                                                                }
                                                                            >
                                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                    <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                                                                        {
                                                                                            <span>
                                                                                                <img
                                                                                                    src="/dashboard/assets/img/profile-user.svg"
                                                                                                    className="userIcon"
                                                                                                    style={{
                                                                                                        marginRight:
                                                                                                            '5px',
                                                                                                    }}
                                                                                                    alt=""
                                                                                                />
                                                                                                <span>
                                                                                                    {member.name
                                                                                                        ? member.name
                                                                                                        : member.email}
                                                                                                </span>
                                                                                            </span>
                                                                                        }
                                                                                    </div>
                                                                                </div>

                                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                Unassigned
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="bs-ObjectList-cell bs-u-v-middle"></div>
                                                                                <div className="bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween">
                                                                                    <div>
                                                                                        <div className="Flex-flex Flex-alignContent--spaceBetween">
                                                                                            <button
                                                                                                title="add"
                                                                                                disabled={
                                                                                                    this
                                                                                                        .props
                                                                                                        .deleting
                                                                                                }
                                                                                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                                                                type="button"
                                                                                                onClick={() =>
                                                                                                    this.addMemberToIssue(
                                                                                                        member
                                                                                                    )
                                                                                                }
                                                                                            >
                                                                                                {!this
                                                                                                    .props
                                                                                                    .deleting && (
                                                                                                    <span>
                                                                                                        Assign
                                                                                                    </span>
                                                                                                )}
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    }
                                                                )
                                                            ) : (
                                                                <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withName">
                                                                    <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                        <span>
                                                                            {' '}
                                                                            All
                                                                            Team
                                                                            Members
                                                                            have
                                                                            been
                                                                            assigned
                                                                            to
                                                                            this
                                                                            Issue
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                        </div>
                        <div className="bs-Modal-footer">
                            <div className="bs-Modal-footer-actions">
                                <button
                                    className="bs-Button bs-DeprecatedButton btn__modal"
                                    type="button"
                                    onClick={closeThisDialog}
                                >
                                    <span>Close</span>
                                    <span className="cancel-btn__keycode">
                                        Esc
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
const mapStateToProp = (state, ownProps) => {
    const errorTrackerIssueMembers =
        state.errorTracker.errorTrackerIssueMembers[
            ownProps.data.errorTrackerIssue._id
        ];
    return {
        errorTrackerIssueMembers,
    };
};
ErrorEventIssueMember.displayName = 'ErrorEventIssueMember';
ErrorEventIssueMember.propTypes = {
    data: PropTypes.object,
    closeThisDialog: PropTypes.func,
    deleting: PropTypes.bool,
    errorTrackerIssueMembers: PropTypes.object,
};
export default connect(mapStateToProp)(ErrorEventIssueMember);
