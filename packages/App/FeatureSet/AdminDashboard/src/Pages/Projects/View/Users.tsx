import AdminModelAPI from "../../../Utils/ModelAPI";
import { findProjectDefaultTeam } from "../../../Utils/DefaultProjectTeam";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { Green, Yellow } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import { useUserEmailRegistrationStatus } from "Common/UI/Utils/UserEmailRegistrationStatus";
import { InviteTeam } from "Common/UI/Utils/DefaultInviteTeam";
import { JSONObject } from "Common/Types/JSON";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useServerCanSendEmail } from "Common/UI/Utils/ServerSending";
import InvitationLinkModal, {
  INVITATION_LINK_COPY,
  getInvitationLinkRowAction,
} from "Common/UI/Components/InvitationLink/InvitationLinkModal";
import {
  MembersNotSignedUp,
  useMembersNotSignedUp,
} from "Common/UI/Components/InvitationLink/MembersNotSignedUp";
import {
  InvitationEmailsNotSent,
  useInvitationEmailsNotSent,
} from "Common/UI/Components/InvitationLink/InvitationEmailsNotSent";
import { getResendInvitationRowAction } from "Common/UI/Components/InvitationLink/ResendInvitation";
import PendingInvitationPill from "../../../Components/User/PendingInvitationPill";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const ProjectUsers: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const projectId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [showInviteUserModal, setShowInviteUserModal] =
    useState<boolean>(false);
  const [isFilterApplied, setIsFilterApplied] = useState<boolean>(false);

  /*
   * A server that cannot send email sends no invitation (#6825): the dialog
   * says so, and once the invitation is made this master admin is handed
   * the link to send - then goes on to the person's page. A pending row's
   * Get Invitation Link reads it again, and stays on the list (#7168).
   */
  const cannotSendEmail: boolean = useServerCanSendEmail() === false;

  /*
   * A member whose invitation was accepted for them before they had an
   * account still has to sign up (#8191): their row says so, and offers
   * their link.
   */
  const membersNotSignedUp: MembersNotSignedUp =
    useMembersNotSignedUp(cannotSendEmail);
  const [invitationLinkFor, setInvitationLinkFor] = useState<{
    teamMemberId: ObjectID;
    userPage: Route | null;
    // Their latest invitation email was not sent, on a server that sends email.
    isEmailNotSent: boolean;
  } | null>(null);

  /*
   * A pending person whose latest invitation email the mail service refused
   * says Email Not Sent, not Invitation Sent (#9518), read from the
   * project's Email Logs; their row offers the link, and Resend Invitation
   * (#9519).
   */
  const invitationEmailsNotSent: InvitationEmailsNotSent =
    useInvitationEmailsNotSent(!cannotSendEmail, { isAcrossProjects: true });

  /*
   * The team Invite User starts on: the project's members team, found by the
   * same rule as the Dashboard's Invite User (Utils/DefaultProjectTeam).
   * Looked up when the dialog is asked for, so it opens with the team picked;
   * a lookup that fails or is slow only means it opens with nothing picked.
   */
  const [defaultInviteTeam, setDefaultInviteTeam] = useState<InviteTeam | null>(
    null,
  );
  const [isPreparingInvite, setIsPreparingInvite] = useState<boolean>(false);

  const openInviteUserModal: () => Promise<void> = async (): Promise<void> => {
    setIsPreparingInvite(true);

    const team: InviteTeam | null = await findProjectDefaultTeam({
      projectId: projectId,
    });

    setDefaultInviteTeam(team);
    setIsPreparingInvite(false);
    setShowInviteUserModal(true);
  };

  // One object per lookup, so re-renders while typing hand the form the same.
  const inviteInitialValues: FormValues<TeamMember> | undefined = useMemo(():
    | FormValues<TeamMember>
    | undefined => {
    if (!defaultInviteTeam) {
      return undefined;
    }

    return {
      team: defaultInviteTeam.id,
    } as FormValues<TeamMember>;
  }, [defaultInviteTeam]);

  const { isEmailRegistered, checkEmail } = useUserEmailRegistrationStatus({
    getRequestHeaders: () => {
      return AdminModelAPI.getCommonHeaders();
    },
  });

  return (
    <ModelPage<Project>
      modelId={projectId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectUsers.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.projects"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECTS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.project"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_VIEW] as Route,
            { modelId: projectId },
          ),
        },
        {
          title: t("breadcrumbs.projectUsers"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_USERS] as Route,
            { modelId: projectId },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={projectId} />}
    >
      <Fragment>
        <ModelTable<TeamMember>
          modelType={TeamMember}
          modelAPI={AdminModelAPI}
          id="project-users-table"
          name="Admin > Project > Users"
          userPreferencesKey="admin-project-users-table"
          isDeleteable={true}
          bulkActions={{
            buttons: [ModalTableBulkDefaultActions.Delete],
          }}
          isEditable={false}
          isCreateable={false}
          isViewable={true}
          // Whose invitation email a pending row asks about, and in which project (#9518).
          selectMoreFields={{
            userId: true,
            projectId: true,
          }}
          actionButtons={[
            getInvitationLinkRowAction<TeamMember>({
              isAvailable: cannotSendEmail,
              isNotSignedUp: membersNotSignedUp.isNotSignedUp,
              isEmailNotSent: (item: TeamMember): boolean => {
                return Boolean(invitationEmailsNotSent.getNotSent(item));
              },
              onOpen: (teamMemberId: ObjectID, item: TeamMember) => {
                setInvitationLinkFor({
                  teamMemberId: teamMemberId,
                  userPage: null,
                  isEmailNotSent:
                    !cannotSendEmail &&
                    Boolean(invitationEmailsNotSent.getNotSent(item)),
                });
              },
            }),
            getResendInvitationRowAction<TeamMember>({
              isAvailable: !cannotSendEmail,
            }),
          ]}
          onFetchSuccess={(rows: Array<TeamMember>) => {
            membersNotSignedUp.onFetchSuccess(rows);
            invitationEmailsNotSent.onFetchSuccess(rows);
          }}
          onFilterApplied={(isApplied: boolean) => {
            setIsFilterApplied(isApplied);
          }}
          cardProps={{
            title: t("pages.projectUsers.cardTitle"),
            description: t("pages.projectUsers.listDescription"),
            buttons: [
              {
                title: t("pages.projectUsers.inviteUser"),
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.Add,
                isLoading: isPreparingInvite,
                onClick: () => {
                  if (isPreparingInvite) {
                    return;
                  }

                  void openInviteUserModal();
                },
              },
            ],
          }}
          noItemsMessage={
            isFilterApplied
              ? t("pages.projectUsers.noItemsFiltered")
              : t("pages.projectUsers.emptyMessage")
          }
          query={{
            projectId: projectId,
          }}
          showRefreshButton={true}
          onViewPage={(item: TeamMember) => {
            const userId: string = item.user?.id?.toString() || "";
            return Promise.resolve(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_USER_VIEW] as Route,
                { modelId: projectId, subModelId: new ObjectID(userId) },
              ),
            );
          }}
          filters={[
            {
              field: {
                user: true,
              },
              title: "User",
              type: FieldType.Entity,
              filterEntityType: User,
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
              fetchFilterDropdownOptions: async (): Promise<
                Array<DropdownOption>
              > => {
                /*
                 * The Users table is keyed on TeamMember, so name/email live on
                 * the related User. Build the dropdown from the project's team
                 * members and label each option with both name and email so an
                 * admin can find a user by typing either.
                 */
                const teamMembers: ListResult<TeamMember> =
                  await AdminModelAPI.getList<TeamMember>({
                    modelType: TeamMember,
                    query: { projectId: projectId },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: {
                      user: {
                        _id: true,
                        name: true,
                        email: true,
                      },
                    },
                    sort: {},
                  });

                const seenUserIds: Set<string> = new Set<string>();
                const options: Array<DropdownOption> = [];

                for (const teamMember of teamMembers.data) {
                  const userId: string = teamMember.user?._id?.toString() || "";
                  if (!userId || seenUserIds.has(userId)) {
                    continue;
                  }
                  seenUserIds.add(userId);

                  const name: string = teamMember.user?.name?.toString() || "";
                  const email: string =
                    teamMember.user?.email?.toString() || "";
                  const label: string =
                    name && email
                      ? `${name} (${email})`
                      : name || email || userId;

                  // A person's name and email, as they gave them.
                  options.push({
                    value: userId,
                    label: label,
                    isUserContent: true,
                  });
                }

                return options;
              },
            },
            {
              field: {
                team: {
                  name: true,
                },
              },
              title: "Team",
              type: FieldType.Entity,
              filterEntityType: Team,
              filterQuery: {
                projectId: projectId,
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
              title: "Status",
              type: FieldType.Boolean,
            },
            {
              field: {
                createdAt: true,
              },
              title: "Invited At",
              type: FieldType.Date,
            },
            {
              field: {
                invitationAcceptedAt: true,
              },
              title: "Accepted Invitation At",
              type: FieldType.Date,
            },
          ]}
          columns={[
            {
              field: {
                user: {
                  name: true,
                  email: true,
                },
              },
              title: "User",
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                if (!item.user) {
                  return <TableEmptyValue />;
                }
                const name: string =
                  item.user.name?.toString() ||
                  item.user.email?.toString() ||
                  "";
                return (
                  <div>
                    <p className="font-medium">{name || <TableEmptyValue />}</p>
                    {item.user.email ? (
                      <p className="text-xs text-gray-500">
                        {item.user.email.toString()}
                      </p>
                    ) : null}
                  </div>
                );
              },
            },
            {
              field: {
                team: {
                  name: true,
                },
              },
              title: "Team",
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                if (!item.team) {
                  return <TableEmptyValue />;
                }
                return (
                  <p>{item.team.name?.toString() || <TableEmptyValue />}</p>
                );
              },
            },
            {
              field: {
                hasAcceptedInvitation: true,
              },
              title: "Status",
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                if (item.hasAcceptedInvitation) {
                  return (
                    <div className="flex space-x-2">
                      <Pill text="Member" color={Green} />
                      {membersNotSignedUp.isNotSignedUp(item) && (
                        <Pill
                          text={INVITATION_LINK_COPY.notSignedUpPill}
                          color={Yellow}
                        />
                      )}
                    </div>
                  );
                }
                // Invited, Email Not Sent (#9518) or Invitation Sent.
                return (
                  <PendingInvitationPill
                    cannotSendEmail={cannotSendEmail}
                    notSent={invitationEmailsNotSent.getNotSent(item)}
                  />
                );
              },
            },
          ]}
        />

        {showInviteUserModal && (
          <ModelFormModal<TeamMember>
            modelType={TeamMember}
            modelAPI={AdminModelAPI}
            name="Invite New User"
            title={t("pages.projectUsers.inviteUserTitle")}
            isTitleTranslated={true}
            description={t("pages.projectUsers.inviteUserDescription")}
            onClose={() => {
              setShowInviteUserModal(false);
            }}
            submitButtonText={t("pages.projectUsers.inviteUserSubmit")}
            initialValues={inviteInitialValues}
            onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
              item.projectId = projectId;
              return Promise.resolve(item);
            }}
            onSuccess={(teamMember: TeamMember) => {
              const userId: string =
                teamMember.user?.id?.toString() ||
                teamMember.userId?.toString() ||
                "";
              const userPage: Route | null = userId
                ? RouteUtil.populateRouteParams(
                    RouteMap[PageMap.PROJECT_USER_VIEW] as Route,
                    {
                      modelId: projectId,
                      subModelId: new ObjectID(userId),
                    },
                  )
                : null;

              // No email went out: the link to send first, then the page.
              if (cannotSendEmail && teamMember.id) {
                setInvitationLinkFor({
                  teamMemberId: teamMember.id,
                  userPage: userPage,
                  isEmailNotSent: false,
                });
              } else if (userPage) {
                Navigation.navigate(userPage);
              }
              setShowInviteUserModal(false);
            }}
            formProps={{
              name: "Invite User",
              modelType: TeamMember,
              modelAPI: AdminModelAPI,
              id: "invite-user-form",
              /*
               * One page, as the Dashboard's Invite User is: the email (and a
               * name when the address has no account yet), the team - the
               * members team to start with, named in its description - and
               * the master admin's auto-accept box. It was two steps (User,
               * Team), whose Invite could be pressed on the first one without
               * ever seeing which team the invitation was for.
               */
              fields: [
                {
                  field: {
                    user: true,
                  },
                  title: "Email",
                  description: cannotSendEmail
                    ? INVITATION_LINK_COPY.inviteDescriptionForAdmin
                    : "Enter the email of the user you would like to invite. We will send them an email letting them know they have been invited to the team you selected.",
                  fieldType: FormFieldSchemaType.Email,
                  required: true,
                  placeholder: "member@company.com",
                  overrideFieldKey: "email",
                  onChange: (value: string) => {
                    checkEmail(value);
                  },
                },
                {
                  field: {
                    user: true,
                  },
                  title: "Name",
                  description:
                    "This email is not registered on OneUptime yet. Enter the name of the user you would like to invite — we will use it to set up their new account.",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "John Smith",
                  overrideFieldKey: "name",
                  showIf: (values: FormValues<TeamMember>): boolean => {
                    return (
                      Boolean((values as JSONObject)["email"]) &&
                      isEmailRegistered === false
                    );
                  },
                },
                {
                  field: {
                    team: true,
                  },
                  title: "Team",
                  /*
                   * Picked to start with (inviteInitialValues), so Invite
                   * needs only the email.
                   */
                  description: defaultInviteTeam
                    ? t("pages.projectUsers.inviteTeamDescriptionWithDefault", {
                        teamName: defaultInviteTeam.name,
                      })
                    : "Select the team you would like to add this user to.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  required: true,
                  fetchDropdownOptions: async (): Promise<
                    Array<DropdownOption>
                  > => {
                    const teams: ListResult<Team> =
                      await AdminModelAPI.getList<Team>({
                        modelType: Team,
                        query: { projectId: projectId },
                        limit: LIMIT_PER_PROJECT,
                        skip: 0,
                        select: {
                          _id: true,
                          name: true,
                        },
                        sort: { name: SortOrder.Ascending },
                      });
                    return teams.data.map((team: Team) => {
                      return {
                        label: team.name?.toString() || "",
                        value: team._id?.toString() || "",
                        // A team's name is its project's, drawn as written.
                        isUserContent: true,
                      };
                    });
                  },
                  placeholder: "Select a team",
                },
                {
                  field: {
                    hasAcceptedInvitation: true,
                  },
                  title: "Accept the invitation automatically",
                  description:
                    "Add this user as a member now, without waiting for them to accept.",
                  fieldType: FormFieldSchemaType.Checkbox,
                  required: false,
                  defaultValue: false,
                },
              ],
              formType: FormType.Create,
            }}
          />
        )}

        {invitationLinkFor && (
          <InvitationLinkModal
            teamMemberId={invitationLinkFor.teamMemberId}
            isEmailNotSent={invitationLinkFor.isEmailNotSent}
            onClose={() => {
              const userPage: Route | null = invitationLinkFor.userPage;
              setInvitationLinkFor(null);

              if (userPage) {
                Navigation.navigate(userPage);
              }
            }}
          />
        )}
      </Fragment>
    </ModelPage>
  );
};

export default ProjectUsers;
