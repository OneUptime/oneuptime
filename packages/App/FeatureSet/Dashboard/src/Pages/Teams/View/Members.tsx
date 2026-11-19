import UserElement from "../../../Components/User/User";
import ProjectUtil from "Common/UI/Utils/Project";
import ProjectUser from "../../../Utils/ProjectUser";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import TeamMembershipRemoval, {
  TeamRemovalPlan,
} from "../../../Utils/TeamMembershipRemoval";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import UserUtil from "Common/UI/Utils/User";
import Banner from "Common/UI/Components/Banner/Banner";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import {
  drawInviteeEmailField,
  getInviteeEmailError,
} from "Common/UI/Components/InviteeEmailField/InviteeEmailFormField";
import {
  INVITEE_NAME_DESCRIPTION,
  shouldAskForInviteeName,
} from "Common/UI/Utils/InviteeName";
import { InviteSuggestion } from "Common/Types/Team/InviteSuggestions";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  DeleteConfirmation,
  ModalTableBulkDefaultActions,
  ModalType,
} from "Common/UI/Components/ModelTable/BaseModelTable";
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
import {
  MembersNotSignedUp,
  useMembersNotSignedUp,
} from "Common/UI/Components/InvitationLink/MembersNotSignedUp";
import {
  InvitationEmailsNotSent,
  useInvitationEmailsNotSent,
} from "Common/UI/Components/InvitationLink/InvitationEmailsNotSent";
import PendingInvitationPill from "../../../Components/User/PendingInvitationPill";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";

const TeamViewMembers: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const currentUserId: ObjectID | null = (() => {
    const id: ObjectID = UserUtil.getUserId();
    return id && id.toString() ? id : null;
  })();

  const [isPushGroupsManaged, setIsPushGroupsManaged] =
    React.useState<boolean>(false);

  /*
   * Whether the server can send the invitation email (Utils/ServerEmail):
   * the dialog says so, and a master admin is handed the link to send.
   */
  const serverEmail: ServerEmail = useServerEmail();
  const [invitationLinkFor, setInvitationLinkFor] = React.useState<{
    teamMemberId: ObjectID;
    // Their latest invitation email was not sent, on a server that sends email.
    isEmailNotSent: boolean;
  } | null>(null);

  // A member who has not signed up yet, for a master admin (#8191).
  const membersNotSignedUp: MembersNotSignedUp = useMembersNotSignedUp(
    canGetInvitationLinks(serverEmail),
  );

  /*
   * A pending member whose latest invitation email the mail service refused
   * says Email Not Sent (#9511), for a reader who may read the project's
   * Email Logs; a master admin gets the link from the row.
   */
  const invitationEmailsNotSent: InvitationEmailsNotSent =
    useInvitationEmailsNotSent(canReadInvitationEmailsNotSent(serverEmail));

  /*
   * The address of the person last picked from the email box's
   * suggestions: someone with an account the reader may see, so Invite New
   * Team Member asks no name for them (Common/UI/Utils/InviteeName).
   */
  const [pickedInviteeEmail, setPickedInviteeEmail] =
    React.useState<string>("");

  React.useEffect(() => {
    const checkScim: () => Promise<void> = async () => {
      if (!props.currentProject || !props.currentProject._id) {
        return;
      }
      try {
        const scimCount: number = await ModelAPI.count<ProjectSCIM>({
          modelType: ProjectSCIM,
          query: {
            projectId: props.currentProject._id,
            enablePushGroups: true,
          },
        });
        setIsPushGroupsManaged(scimCount > 0);
      } catch {
        // ignore
      }
    };
    checkScim();
  }, [props.currentProject]);

  return (
    <Fragment>
      {isPushGroupsManaged && (
        <Banner
          title="Team membership is managed by SCIM Push Groups"
          description="Add and remove this team's members in your identity provider. To change them here instead, turn off Push Groups in Project Settings > Security > SCIM."
        />
      )}

      <ModelTable<TeamMember>
        modelType={TeamMember}
        id="table-team-member"
        userPreferencesKey="team-member-table"
        saveFilterProps={{
          tableId: "settings-team-view-members-table",
        }}
        isDeleteable={!isPushGroupsManaged}
        bulkActions={
          !isPushGroupsManaged
            ? {
                buttons: [ModalTableBulkDefaultActions.Delete],
                /*
                 * A user is in the project only through their teams, so for
                 * anyone this is the last team of, removing them from it
                 * removes them from the project.
                 */
                deleteConfirmationWarning:
                  "Anyone for whom this is their only team will also be removed from the project and lose access to it immediately.",
              }
            : undefined
        }
        name="Settings > Team > Member"
        createVerb={"Invite"}
        isCreateable={!isPushGroupsManaged}
        isViewable={false}
        query={{
          teamId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        // Whose invitation email a pending row asks about (#9511).
        selectMoreFields={{
          userId: true,
        }}
        onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot invite users while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.teamId = modelId;
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
            cannotSendEmail(serverEmail) &&
            serverEmail.isMasterAdmin &&
            item.id
          ) {
            setInvitationLinkFor({
              teamMemberId: item.id,
              isEmailNotSent: false,
            });
          }

          return item;
        }}
        onBeforeDelete={async (item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot remove team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          return item;
        }}
        getDeleteConfirmation={async (
          item: TeamMember,
        ): Promise<DeleteConfirmation> => {
          const plan: TeamRemovalPlan =
            await TeamMembershipRemoval.getTeamRemovalPlan({
              membership: item,
              projectId: ProjectUtil.getCurrentProjectId()!,
            });

          return plan.confirmation;
        }}
        cardProps={{
          title: "Team Members",
          description: "See a list of members or invite them to this team. ",
        }}
        noItemsMessage={"No members in this team yet."}
        formFields={[
          {
            field: {
              user: true,
            },
            title: "Email",
            description: cannotSendEmail(serverEmail)
              ? serverEmail.isMasterAdmin
                ? SERVER_EMAIL_COPY.inviteEmailDescriptionForAdmin
                : SERVER_EMAIL_COPY.inviteEmailDescription
              : "We email them an invitation to this team.",
            /*
             * The form's text box, which suggests the project's people as
             * it is typed in, each with where they stand for this team
             * (#9701, Common/UI/Components/InviteeEmailField).
             */
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            placeholder: "member@company.com",
            overrideFieldKey: "email",
            customValidation: getInviteeEmailError,
            getCustomElement: (
              _values: FormValues<TeamMember>,
              customProps: CustomElementProps,
            ): ReactElement => {
              return drawInviteeEmailField({
                customProps: customProps,
                teamId: modelId.toString(),
                onPick: (suggestion: InviteSuggestion) => {
                  setPickedInviteeEmail(suggestion.email);
                },
              });
            },
          },
          {
            field: {
              user: true,
            },
            /*
             * Asked for every address typed, never only for one with no
             * account: whether an address has one is nobody's to learn here
             * (#9745). The server uses it only for an account nobody has
             * signed up to yet.
             */
            title: "Name",
            description: INVITEE_NAME_DESCRIPTION,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "John Smith",
            overrideFieldKey: "name",
            showIf: (values: FormValues<TeamMember>): boolean => {
              return shouldAskForInviteeName({
                email: (values as JSONObject)["email"],
                pickedEmail: pickedInviteeEmail,
              });
            },
          },
        ]}
        showRefreshButton={true}
        deleteButtonText="Remove Member"
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        actionButtons={[
          // A pending member's invitation link, for a master admin (#7168).
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
          // A pending member's invitation email, sent again (#9519).
          getResendInvitationRowAction<TeamMember>({
            isAvailable: canResendInvitations(serverEmail),
            getRequestHeaders: () => {
              return ModelAPI.getCommonHeaders();
            },
          }),
          {
            title: "Leave Team",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Logout,
            isVisible: (item: TeamMember): boolean => {
              if (isPushGroupsManaged) {
                return false;
              }
              if (!currentUserId) {
                return false;
              }
              return item.userId?.toString() === currentUserId.toString();
            },
            onClick: async (
              item: TeamMember,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                if (!item._id) {
                  throw new BadDataException("Team member id is missing");
                }
                const url: URL = URL.fromString(APP_API_URL.toString())
                  .addRoute("/team-member")
                  .addRoute(`/${item._id.toString()}/leave`);

                const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                  await API.post({
                    url,
                    data: {},
                    headers: { ...ModelAPI.getCommonHeaders() },
                  });

                if (response instanceof HTTPErrorResponse) {
                  throw response;
                }

                onCompleteAction();
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.HOME] as Route,
                  ),
                  { forceNavigate: true },
                );
              } catch (err) {
                onError(err as Error);
              }
            },
          },
        ]}
        onFetchSuccess={(rows: Array<TeamMember>) => {
          membersNotSignedUp.onFetchSuccess(rows);
          invitationEmailsNotSent.onFetchSuccess(rows);
        }}
        filters={[
          {
            field: {
              user: true,
            },
            type: FieldType.Entity,
            title: "User",
            filterEntityType: User,
            fetchFilterDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            type: FieldType.Boolean,
            title: "Accepted Invite",
          },
        ]}
        columns={[
          {
            field: {
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Text,
            getElement: (item: TeamMember): ReactElement => {
              if (item["user"]) {
                return <UserElement user={item["user"]} />;
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

export default TeamViewMembers;
