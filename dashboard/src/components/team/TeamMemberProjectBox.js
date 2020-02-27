import React from 'react';
import ShouldRender from '../basic/ShouldRender';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import DataPathHoC from '../DataPathHoC';
import TeamMember from '../team/TeamMember';
import InviteTeamMemberModal from '../modals/inviteTeamMember.js';
import moment from 'moment';
import PropTypes from 'prop-types';

const TeamMemberProjectBox = props => (
    <div className="Box-root">
        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                    <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                        <span style={{ textTransform: 'capitalize' }}>
                            {props.currentProjectId !== props.teamMembers._id
                                ? props.subProjectName
                                : props.subProjects.length > 0
                                ? 'Project'
                                : ''}{' '}
                            Team Members
                        </span>
                    </span>
                    <span
                        style={{ textTransform: 'lowercase' }}
                        className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                    >
                        <span>
                            Here are all the members who belong to{' '}
                            {props.currentProjectId !== props.teamMembers._id
                                ? `${props.subProjectName} sub-project`
                                : `${props.subProjectName} project`}
                            .
                        </span>
                    </span>
                </div>
                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                    <div className="Box-root">
                        <RenderIfSubProjectAdmin
                            subProjectId={props.teamMembers._id}
                        >
                            <button
                                id={`btn_${props.subProjectName}`}
                                onClick={() =>
                                    props.openModal({
                                        id: props.inviteModalId,
                                        content: DataPathHoC(
                                            InviteTeamMemberModal,
                                            {
                                                subProjectId:
                                                    props.teamMembers._id,
                                                subProjectName:
                                                    props.subProjectName,
                                            }
                                        ),
                                    })
                                }
                                className="Button bs-ButtonLegacy ActionIconParent"
                                type="button"
                            >
                                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                    <div className="Box-root Margin-right--8">
                                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                    </div>
                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Invite Team Member</span>
                                    </span>
                                </div>
                            </button>
                        </RenderIfSubProjectAdmin>
                    </div>
                </div>
            </div>
        </div>
        <div className="bs-ContentSection-content Box-root">
            <div className="bs-ObjectList db-UserList">
                <div className="bs-ObjectList-rows">
                    <header className="bs-ObjectList-row bs-ObjectList-row--header">
                        <div className="bs-ObjectList-cell">Team Member</div>
                        <div className="bs-ObjectList-cell">Role</div>
                        <div className="bs-ObjectList-cell">Status</div>
                        <div className="bs-ObjectList-cell"></div>
                        <div className="bs-ObjectList-cell"></div>
                    </header>

                    {props.teamMembers.teamMembers.map((i, o) => {
                        if (
                            o >=
                                (props.pages[props.teamMembers._id] || 1) *
                                    props.membersPerPage -
                                    props.membersPerPage &&
                            o <
                                (props.pages[props.teamMembers._id] || 1) *
                                    props.membersPerPage
                        ) {
                            return (
                                <TeamMember
                                    inviteModalId
                                    userId={i.userId}
                                    key={i.userId}
                                    index={i.userId}
                                    name={i.name}
                                    email={i.email}
                                    role={i.role}
                                    lastActive={moment(i.lastActive).fromNow()}
                                    subProjectId={props.teamMembers._id}
                                />
                            );
                        } else return null;
                    })}
                </div>
            </div>
        </div>

        <div className="bs-Tail bs-Tail--separated bs-Tail--short">
            <ShouldRender if={props.team.teamdelete.error}>
                <div className="bs-Tail-copy">
                    <div
                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                        style={{ marginTop: '10px' }}
                    >
                        <div className="Box-root Margin-right--8">
                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                        </div>
                        <div className="Box-root">
                            <span style={{ color: 'red' }}>
                                {props.team.teamdelete.error}
                            </span>
                        </div>
                    </div>
                </div>
            </ShouldRender>
            <ShouldRender if={props.team.teamUpdateRole.error}>
                <div className="bs-Tail-copy">
                    <div
                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                        style={{ marginTop: '10px' }}
                    >
                        <div className="Box-root Margin-right--8">
                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                        </div>
                        <div className="Box-root">
                            <span style={{ color: 'red' }}>
                                {props.team.teamUpdateRole.error}
                            </span>
                        </div>
                    </div>
                </div>
            </ShouldRender>
            <ShouldRender
                if={
                    !props.team.teamdelete.error &&
                    !props.team.teamUpdateRole.error
                }
            >
                <div className="bs-Tail-copy">
                    <span>
                        {props.teamMembers.count} Team Member
                        {props.teamMembers.count > 1 ? 's' : ''}
                    </span>
                </div>
            </ShouldRender>
            <div className="bs-Tail-actions">
                <div className="ButtonGroup Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                    <div className="Box-root Margin-right--8">
                        <button
                            data-test="TeamSettings-paginationButton"
                            className={`Button bs-ButtonLegacy ${
                                !props.canPaginateBackward ? 'Is--disabled' : ''
                            }`}
                            disabled={!props.canPaginateBackward}
                            type="button"
                            onClick={() =>
                                props.paginate('prev', props.teamMembers._id)
                            }
                        >
                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                    <span>Previous</span>
                                </span>
                            </div>
                        </button>
                    </div>
                    <div className="Box-root">
                        <button
                            data-test="TeamSettings-paginationButton"
                            className={`Button bs-ButtonLegacy ${
                                !props.canPaginateForward ? 'Is--disabled' : ''
                            }`}
                            disabled={!props.canPaginateForward}
                            type="button"
                            onClick={() =>
                                props.paginate('next', props.teamMembers._id)
                            }
                        >
                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                    <span>Next</span>
                                </span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

TeamMemberProjectBox.displayName = 'TeamMemberProjectBox';

TeamMemberProjectBox.propTypes = {
    openModal: PropTypes.func.isRequired,
    paginate: PropTypes.func.isRequired,
    teamMembers: PropTypes.object.isRequired,
    team: PropTypes.object.isRequired,
    pages: PropTypes.object.isRequired,
    canPaginateBackward: PropTypes.bool.isRequired,
    canPaginateForward: PropTypes.bool.isRequired,
    subProjectName: PropTypes.string.isRequired,
    currentProjectId: PropTypes.string.isRequired,
    inviteModalId: PropTypes.string.isRequired,
    membersPerPage: PropTypes.number.isRequired,
    subProjects: PropTypes.array,
};

export default TeamMemberProjectBox;
