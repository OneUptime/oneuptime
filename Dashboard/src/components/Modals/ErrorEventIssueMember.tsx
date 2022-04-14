import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { FormLoader2 } from '../basic/Loader';

interface ErrorEventIssueMemberProps {
    data?: object;
    closeThisDialog?: Function;
    deleting?: boolean;
    errorTrackerIssueMembers?: object;
}

class ErrorEventIssueMember extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            default:
                return false;
        }
    };
    manageMemberInIssue = (member: $TSFixMe) => {

        const { updateErrorEventMember, errorTrackerIssue }: $TSFixMe = this.props.data;
        const memberInIssue: $TSFixMe = this.isTeamMemberAssigned(member);
        updateErrorEventMember(
            errorTrackerIssue._id,
            member.userId,
            memberInIssue ? 'unassign' : 'assign'
        );
    };
    isTeamMemberAssigned = (teamMember: $TSFixMe) => {

        const { errorTrackerIssue }: $TSFixMe = this.props.data;
        const memberExist: $TSFixMe = errorTrackerIssue.members.find(
            (member: $TSFixMe) => member.userId._id === teamMember.userId
        );
        return memberExist ? true : false;
    };
    override render() {

        const { data, closeThisDialog, errorTrackerIssueMembers }: $TSFixMe = this.props;

        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM db-InviteSetting">
                    <div className="bs-Modal bs-Modal--xlarge">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-content bs-u-paddingless">
                                <div className="bs-Modal-block bs-u-paddingless">
                                    <div>
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
                                                                List of team
                                                                members
                                                                available in
                                                                your
                                                                organization
                                                                that can be
                                                                assigned
                                                                to/unassigned
                                                                from error event{' '}
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
                                                            {data.allTeamMembers &&
                                                                data.allTeamMembers
                                                                    .length > 0 ? (
                                                                data.allTeamMembers.map(
                                                                    (
                                                                        member: $TSFixMe,
                                                                        i: $TSFixMe
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
                                                                                                        : member.email
                                                                                                            ? member.email
                                                                                                            : 'N/A'}
                                                                                                </span>
                                                                                            </span>
                                                                                        }
                                                                                    </div>
                                                                                </div>

                                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                    <div
                                                                                        className={`Badge ${this.isTeamMemberAssigned(
                                                                                            member
                                                                                        )
                                                                                            ? 'Badge--color--green'
                                                                                            : 'Badge--color--red'
                                                                                            } Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                                                    >
                                                                                        <span
                                                                                            className={`Badge-text ${this.isTeamMemberAssigned(
                                                                                                member
                                                                                            )
                                                                                                ? 'Text-color--green'
                                                                                                : 'Text-color--red '
                                                                                                } Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
                                                                                        >
                                                                                            <span>
                                                                                                {this.isTeamMemberAssigned(
                                                                                                    member
                                                                                                )
                                                                                                    ? 'Assigned'
                                                                                                    : 'Unassigned'}
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
                                                                                                className="bs-Button"
                                                                                                type="button"
                                                                                                onClick={() =>
                                                                                                    this.manageMemberInIssue(
                                                                                                        member
                                                                                                    )
                                                                                                }
                                                                                            >
                                                                                                {errorTrackerIssueMembers &&
                                                                                                    errorTrackerIssueMembers[
                                                                                                    member
                                                                                                        .userId
                                                                                                    ] &&
                                                                                                    errorTrackerIssueMembers[
                                                                                                        member
                                                                                                            .userId
                                                                                                    ]
                                                                                                        .requesting ? (
                                                                                                    <FormLoader2 />
                                                                                                ) : (
                                                                                                    <span>
                                                                                                        {this.isTeamMemberAssigned(
                                                                                                            member
                                                                                                        )
                                                                                                            ? 'Unassign'
                                                                                                            : 'Assign'}
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
                                                                            is
                                                                            available
                                                                            in
                                                                            your
                                                                            organization
                                                                            yet
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
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
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}
const mapStateToProp: Function = (state: RootState, ownProps: $TSFixMe) => {
    const errorTrackerIssueMembers: $TSFixMe =
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
