import AdminModelAPI from "../../../Utils/ModelAPI";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Yellow } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Card from "Common/UI/Components/Card/Card";
import Detail from "Common/UI/Components/Detail/Detail";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
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
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const ProjectUserView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  /*
   * A server that cannot send email sent no invitation (#6825): a pending
   * team's row offers its invitation link (#7168), and Add to Team says no
   * email goes out and hands the link over (#8192).
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
    // Their latest invitation email was not sent, on a server that sends email.
    isEmailNotSent: boolean;
  } | null>(null);

  /*
   * Their latest invitation email was refused by the mail service (#9518):
   * a pending team's row says Email Not Sent, and offers the link and
   * Resend Invitation (#9519).
   */
  const invitationEmailsNotSent: InvitationEmailsNotSent =
    useInvitationEmailsNotSent(!cannotSendEmail, { isAcrossProjects: true });
  const userId: ObjectID = Navigation.getLastParamAsObjectID(0);
  const projectId: ObjectID = Navigation.getLastParamAsObjectID(2);

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadUser: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const teamMembers: ListResult<TeamMember> =
        await AdminModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: {
            userId: userId,
            projectId: projectId,
          },
          select: {
            user: {
              _id: true,
              name: true,
              email: true,
            },
          },
          sort: {},
          skip: 0,
          limit: 1,
        });

      if (teamMembers.data.length === 0 || !teamMembers.data[0]?.user) {
        setError("User not found in this project.");
        return;
      }

      setUser(teamMembers.data[0].user);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUser().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Exception));
    });
  }, []);

  return (
    <ModelPage<Project>
      modelId={projectId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectUserView.title")}
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
        {
          title: t("breadcrumbs.projectUser"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_USER_VIEW] as Route,
            { modelId: projectId, subModelId: userId },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={projectId} />}
    >
      <Fragment>
        {isLoading && <PageSkeleton />}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && user && (
          <Fragment>
            <Card
              title={
                user.name?.toString() ||
                user.email?.toString() ||
                t("pages.projectUserView.cardTitle")
              }
              description={t("pages.projectUserView.cardDescription")}
            >
              <Detail<User>
                item={user}
                fields={[
                  {
                    key: "name",
                    title: "Name",
                    fieldType: FieldType.Name,
                  },
                  {
                    key: "email",
                    title: "Email",
                    fieldType: FieldType.Email,
                  },
                  {
                    key: "_id",
                    title: "User ID",
                    fieldType: FieldType.ObjectID,
                  },
                ]}
              />
            </Card>

            <ModelTable<TeamMember>
              modelType={TeamMember}
              modelAPI={AdminModelAPI}
              id="project-user-teams-table"
              userPreferencesKey="admin-project-user-teams-table"
              isDeleteable={true}
              name="Admin > Project > User > Teams"
              createVerb="Add to Team"
              isCreateable={true}
              isEditable={false}
              isViewable={false}
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
              query={{
                userId: userId,
                projectId: projectId,
              }}
              onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
                if (!projectId) {
                  throw new BadDataException("Project ID cannot be null");
                }
                item.userId = userId;
                item.projectId = projectId;
                return Promise.resolve(item);
              }}
              onCreateSuccess={async (
                item: TeamMember,
                modalType?: ModalType,
              ): Promise<TeamMember> => {
                // No email went out: the link to send (#8192).
                if (
                  modalType !== ModalType.Edit &&
                  cannotSendEmail &&
                  item.id
                ) {
                  setInvitationLinkFor({
                    teamMemberId: item.id,
                    isEmailNotSent: false,
                  });
                }

                return item;
              }}
              cardProps={{
                title: t("pages.projectUserView.teamsCardTitle"),
                description: t("pages.projectUserView.teamsCardDescription"),
              }}
              noItemsMessage={t("pages.projectUserView.teamsNoItems")}
              formFields={[
                {
                  field: {
                    team: true,
                  },
                  title: "Team",
                  /*
                   * A server that cannot send email says so, as every other
                   * invite form does (#8192).
                   */
                  description: cannotSendEmail
                    ? INVITATION_LINK_COPY.inviteDescriptionForAdmin
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
                  placeholder: "Select Team",
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
              ]}
              showRefreshButton={true}
              deleteButtonText="Remove"
              filters={[
                {
                  field: {
                    team: {
                      name: true,
                    },
                  },
                  type: FieldType.Entity,
                  title: "Team",
                  filterEntityType: Team,
                  filterQuery: {
                    projectId: projectId,
                  },
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
        )}
      </Fragment>
    </ModelPage>
  );
};

export default ProjectUserView;
