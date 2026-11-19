import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import TeamMembershipRemoval, {
  TeamRemovalPlan,
} from "../../../Utils/TeamMembershipRemoval";
import PageComponentProps from "../../PageComponentProps";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import {
  DeleteConfirmation,
  ModalType,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Team from "Common/Models/DatabaseModels/Team";
import TeamElement from "../../../Components/Team/Team";
import {
  SERVER_EMAIL_COPY,
  ServerEmail,
  canGetInvitationLinks,
  canGetLinksOfInvitationsNotSent,
  canReadInvitationEmailsNotSent,
  canResendInvitations,
  cannotSendEmail,
  useServerEmail,
} from "../../../Utils/ServerEmail";
import InvitationLinkModal, {
  getInvitationLinkRowAction,
} from "Common/UI/Components/InvitationLink/InvitationLinkModal";
import { getResendInvitationRowAction } from "Common/UI/Components/InvitationLink/ResendInvitation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  MembersNotSignedUp,
  useMembersNotSignedUp,
} from "Common/UI/Components/InvitationLink/MembersNotSignedUp";
import {
  InvitationEmailsNotSent,
  useInvitationEmailsNotSent,
} from "Common/UI/Components/InvitationLink/InvitationEmailsNotSent";
import PendingInvitationPill from "../../../Components/User/PendingInvitationPill";

const UserViewTeams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const userId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * A server that cannot send email sent no invitation (Utils/ServerEmail):
   * a master admin reads a pending team's invitation link from its row - or
   * a member's, who has not signed up yet (#8191) - and is handed it once
   * Invite has added this person to another team (#8192).
   */
  const serverEmail: ServerEmail = useServerEmail();
  const [invitationLinkFor, setInvitationLinkFor] = React.useState<{
    teamMemberId: ObjectID;
    // Their latest invitation email was not sent, on a server that sends email.
    isEmailNotSent: boolean;
  } | null>(null);
  const membersNotSignedUp: MembersNotSignedUp = useMembersNotSignedUp(
    canGetInvitationLinks(serverEmail),
  );

  /*
   * Their latest invitation email was refused by the mail service (#9511):
   * a pending team's row says Email Not Sent, for a reader who may read the
   * project's Email Logs, and a master admin gets the link from it.
   */
  const invitationEmailsNotSent: InvitationEmailsNotSent =
    useInvitationEmailsNotSent(canReadInvitationEmailsNotSent(serverEmail));

  /*
   * A user is in the project only through their teams, so removing their last
   * membership here removed them from the project as well - and then left the
   * admin on this page, with a still-live "Remove from Project" in the menu,
   * unsure whether the user was gone. The confirmation now says so up front;
   * once it has happened, go where the result can be seen.
   */
  const onMembershipRemoved: () => Promise<void> = async (): Promise<void> => {
    const isStillInProject: boolean =
      await TeamMembershipRemoval.isUserStillInProject({
        userId: userId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      });

    if (!isStillInProject) {
      Navigation.navigate(
        RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
      );
    }
  };

  return (
    <Fragment>
      <ModelTable<TeamMember>
        modelType={TeamMember}
        id="table-User-member"
        userPreferencesKey="user-member-table"
        saveFilterProps={{
          tableId: "settings-user-view-members-table",
        }}
        isDeleteable={true}
        name="Settings > User > Member"
        createVerb={"Invite"}
        isCreateable={true}
        isViewable={false}
        query={{
          userId: userId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        /*
         * Whose invitation email a pending row asks about (#9511), and the
         * address Resend Invitation names before it sends it (#9519).
         */
        selectMoreFields={{
          userId: true,
          user: {
            email: true,
          },
        }}
        onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.userId = userId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        onCreateSuccess={async (
          item: TeamMember,
          modalType?: ModalType,
        ): Promise<TeamMember> => {
          // No email went out: a master admin is handed the link to send.
          if (
            modalType !== ModalType.Edit &&
            canGetInvitationLinks(serverEmail) &&
            item.id
          ) {
            setInvitationLinkFor({
              teamMemberId: item.id,
              isEmailNotSent: false,
            });
          }

          return item;
        }}
        singularName=" "
        pluralName=" "
        cardProps={{
          title: "Teams",
          description: "See a list of teams this user is a member of.",
        }}
        noItemsMessage={"This user is not a member of any team."}
        formFields={[
          {
            field: {
              team: true,
            },
            title: "Team",
            /*
             * A server that cannot send email says so, as every other invite
             * form does (#8192): nobody is emailed, and a master admin is
             * handed the link once the invitation is made.
             */
            description: cannotSendEmail(serverEmail)
              ? serverEmail.isMasterAdmin
                ? SERVER_EMAIL_COPY.inviteEmailDescriptionForAdmin
                : SERVER_EMAIL_COPY.inviteEmailDescription
              : "Select the team you would like to add this user to.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Team",
          },
        ]}
        showRefreshButton={true}
        deleteButtonText="Remove"
        getDeleteConfirmation={async (
          item: TeamMember,
        ): Promise<DeleteConfirmation> => {
          const plan: TeamRemovalPlan =
            await TeamMembershipRemoval.getTeamRemovalPlan({
              membership: item,
              userId: userId,
              projectId: ProjectUtil.getCurrentProjectId()!,
            });

          return plan.confirmation;
        }}
        onItemDeleted={() => {
          onMembershipRemoved().catch(() => {
            // The table has already refreshed; staying put is a safe fallback.
          });
        }}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        actionButtons={[
          getInvitationLinkRowAction<TeamMember>({
            isAvailable: canGetInvitationLinks(serverEmail),
            isNotSignedUp: membersNotSignedUp.isNotSignedUp,
            isEmailNotSent: canGetLinksOfInvitationsNotSent(serverEmail)
              ? (item: TeamMember): boolean => {
                  return Boolean(invitationEmailsNotSent.getNotSent(item));
                }
              : undefined,
            onOpen: (teamMemberId: ObjectID, item: TeamMember) => {
              setInvitationLinkFor({
                teamMemberId: teamMemberId,
                isEmailNotSent:
                  !cannotSendEmail(serverEmail) &&
                  Boolean(invitationEmailsNotSent.getNotSent(item)),
              });
            },
          }),
          // A pending team's invitation email, sent again (#9519).
          getResendInvitationRowAction<TeamMember>({
            isAvailable: canResendInvitations(serverEmail),
            getRequestHeaders: () => {
              return ModelAPI.getCommonHeaders();
            },
          }),
        ]}
        onFetchSuccess={(rows: Array<TeamMember>) => {
          membersNotSignedUp.onFetchSuccess(rows);
          invitationEmailsNotSent.onFetchSuccess(rows);
        }}
        filters={[
          /*
           * The table lists the project's teams for this filter itself, by
           * name and id. A fetchFilterDropdownOptions here would replace that
           * list: the people fetcher once did, so the menu offered people and
           * picking one emptied the table (#7820).
           */
          {
            field: {
              team: true,
            },
            type: FieldType.Entity,
            title: "Team",
            filterEntityType: Team,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              team: {
                name: true,
                _id: true,
              },
            },
            title: "Team",
            type: FieldType.Element,
            getElement: (item: TeamMember): ReactElement => {
              if (item["team"]) {
                return <TeamElement team={item["team"]!} />;
              }

              return <></>;
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: TeamMember): ReactElement => {
              if (item["hasAcceptedInvitation"]) {
                return (
                  <div className="flex space-x-2">
                    <Pill text="Member" color={Green} />
                    {membersNotSignedUp.isNotSignedUp(item) && (
                      <Pill
                        text={SERVER_EMAIL_COPY.notSignedUpPill}
                        color={Yellow}
                      />
                    )}
                  </div>
                );
              }
              // Invited, Email Not Sent (#9511) or Invitation Sent.
              return (
                <PendingInvitationPill
                  serverEmail={serverEmail}
                  notSent={invitationEmailsNotSent.getNotSent(item)}
                />
              );
            },
          },
        ]}
      />
      {invitationLinkFor && (
        <InvitationLinkModal
          teamMemberId={invitationLinkFor.teamMemberId}
          isEmailNotSent={invitationLinkFor.isEmailNotSent}
          onClose={() => {
            setInvitationLinkFor(null);
          }}
        />
      )}
    </Fragment>
  );
};

export default UserViewTeams;
