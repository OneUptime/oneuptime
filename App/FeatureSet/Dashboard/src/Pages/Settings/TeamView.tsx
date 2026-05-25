import LabelsElement from "Common/UI/Components/Label/Labels";
import UserElement from "../../Components/User/User";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import ProjectUser from "../../Utils/ProjectUser";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import UserUtil from "Common/UI/Utils/User";
import Banner from "Common/UI/Components/Banner/Banner";
import { FormProps } from "Common/UI/Components/Forms/BasicForm";
import PermissionPicker from "Common/UI/Components/Forms/Fields/PermissionPicker";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import User from "Common/Models/DatabaseModels/User";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useState,
} from "react";
import TeamComplianceStatusTable, {
  TeamComplianceStatusTableRef,
} from "../../Components/Team/TeamComplianceStatusTable";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import EnterpriseFeatureUpgrade, {
  isEnterpriseFeatureEligible,
} from "../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

enum CreatePermissionType {
  RoleBased = "RoleBased",
  Granular = "Granular",
}

const TeamView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const complianceStatusTableRef: React.Ref<TeamComplianceStatusTableRef> =
    React.useRef<TeamComplianceStatusTableRef>(null);

  const isComplianceEnterpriseEligible: boolean = useMemo(() => {
    return isEnterpriseFeatureEligible();
  }, []);

  const currentUserId: ObjectID | null = (() => {
    const id: ObjectID = UserUtil.getUserId();
    return id && id.toString() ? id : null;
  })();

  const [isPushGroupsManaged, setIsPushGroupsManaged] =
    React.useState<boolean>(false);

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

  type TeamPermissionTableProps = {
    permissionType: PermissionType;
  };

  const TeamPermissionTable: FunctionComponent<TeamPermissionTableProps> = (
    data: TeamPermissionTableProps,
  ) => {
    const { permissionType } = data;

    const formRef: MutableRefObject<FormProps<FormValues<TeamPermission>>> =
      React.useRef<FormProps<FormValues<TeamPermission>>>() as MutableRefObject<
        FormProps<FormValues<TeamPermission>>
      >;

    const [createPermissionType, setCreatePermissionType] =
      useState<CreatePermissionType>(CreatePermissionType.RoleBased);

    const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

    let tableTitle: string = "Allow Permissions";

    if (permissionType === PermissionType.BlockPermissions) {
      tableTitle = "Block Permissions";
    }

    let tableDescription: string =
      "Here you can manage allow permissions for this team.";

    if (permissionType === PermissionType.BlockPermissions) {
      tableDescription =
        "Here you can manage block permissions for this team. This will override any allow permissions set for this team.";
    }

    const roleIconMap: Record<string, IconProp> = {
      [Permission.ProjectOwner]: IconProp.ShieldCheck,
      [Permission.ProjectAdmin]: IconProp.User,
      [Permission.ProjectMember]: IconProp.Team,
      [Permission.Viewer]: IconProp.Eye,

      [Permission.IncidentAdmin]: IconProp.Alert,
      [Permission.IncidentMember]: IconProp.Alert,
      [Permission.IncidentViewer]: IconProp.Alert,

      [Permission.AlertAdmin]: IconProp.BellAlert,
      [Permission.AlertMember]: IconProp.BellAlert,
      [Permission.AlertViewer]: IconProp.BellAlert,

      [Permission.MonitorAdmin]: IconProp.Activity,
      [Permission.MonitorMember]: IconProp.Activity,
      [Permission.MonitorViewer]: IconProp.Activity,

      [Permission.StatusPageAdmin]: IconProp.Globe,
      [Permission.StatusPageMember]: IconProp.Globe,
      [Permission.StatusPageViewer]: IconProp.Globe,

      [Permission.OnCallAdmin]: IconProp.Phone,
      [Permission.OnCallMember]: IconProp.Phone,
      [Permission.OnCallViewer]: IconProp.Phone,

      [Permission.ScheduledMaintenanceAdmin]: IconProp.Calendar,
      [Permission.ScheduledMaintenanceMember]: IconProp.Calendar,
      [Permission.ScheduledMaintenanceViewer]: IconProp.Calendar,

      [Permission.TelemetryAdmin]: IconProp.ChartBar,
      [Permission.TelemetryMember]: IconProp.ChartBar,
      [Permission.TelemetryViewer]: IconProp.ChartBar,

      [Permission.SettingsAdmin]: IconProp.Settings,
      [Permission.SettingsMember]: IconProp.Settings,
      [Permission.SettingsViewer]: IconProp.Settings,

      [Permission.BillingAdmin]: IconProp.CreditCard,
      [Permission.BillingMember]: IconProp.CreditCard,
      [Permission.BillingViewer]: IconProp.CreditCard,

      [Permission.WorkflowAdmin]: IconProp.Workflow,
      [Permission.WorkflowMember]: IconProp.Workflow,
      [Permission.WorkflowViewer]: IconProp.Workflow,

      [Permission.RunbookAdmin]: IconProp.PlayCircle,
      [Permission.RunbookMember]: IconProp.PlayCircle,
      [Permission.RunbookViewer]: IconProp.PlayCircle,
    };

    const ownerRoles: Array<CardSelectOption> = [];
    const projectRoles: Array<CardSelectOption> = [];
    const administrationRoles: Array<CardSelectOption> = [];
    const domainRoles: Array<CardSelectOption> = [];

    for (const p of PermissionHelper.getRolePermissionProps()) {
      const option: CardSelectOption = {
        value: p.permission,
        title: p.title,
        description: p.description,
        icon: roleIconMap[p.permission] || IconProp.Lock,
      };

      if (
        /*
         * Top-level project grants. Unconditional project-wide access;
         * surfaced as scope-exempt (see PermissionHelper.isScopeApplicable).
         */
        p.permission === Permission.ProjectOwner ||
        p.permission === Permission.ProjectAdmin
      ) {
        ownerRoles.push(option);
      } else if (
        p.permission === Permission.ProjectMember ||
        p.permission === Permission.Viewer
      ) {
        projectRoles.push(option);
      } else if (
        /*
         * Project-wide admin roles — manage settings/billing, not
         * resources. Grouped separately and surfaced as scope-exempt
         * (see PermissionHelper.isScopeApplicable).
         */
        p.permission === Permission.SettingsAdmin ||
        p.permission === Permission.SettingsMember ||
        p.permission === Permission.SettingsViewer ||
        p.permission === Permission.BillingAdmin ||
        p.permission === Permission.BillingMember ||
        p.permission === Permission.BillingViewer
      ) {
        administrationRoles.push(option);
      } else {
        domainRoles.push(option);
      }
    }

    const roleCardSelectOptions: Array<
      CardSelectOption | CardSelectOptionGroup
    > = [
      {
        label: "Owner",
        options: ownerRoles,
      },
      {
        label: "Project Roles",
        options: projectRoles,
      },
      {
        label: "Administration",
        options: administrationRoles,
      },
      {
        label: "Domain Roles",
        options: domainRoles,
      },
    ];

    const createButtons: Array<CardButtonSchema> = [
      {
        title: "Add Role",
        icon: IconProp.User,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: () => {
          setCreatePermissionType(CreatePermissionType.RoleBased);
          setShowCreateForm(false);
          setTimeout(() => {
            setShowCreateForm(true);
          }, 0);
        },
      },
      {
        title: "Add Permission",
        icon: IconProp.Lock,
        buttonStyle: ButtonStyleType.OUTLINE,
        onClick: () => {
          setCreatePermissionType(CreatePermissionType.Granular);
          setShowCreateForm(false);
          setTimeout(() => {
            setShowCreateForm(true);
          }, 0);
        },
      },
    ];

    return (
      <ModelTable<TeamPermission>
        modelType={TeamPermission}
        userPreferencesKey={"team-permission-table-" + permissionType}
        id={"table-team-permission-" + permissionType}
        isDeleteable={true}
        isEditable={true}
        isCreateable={false}
        showCreateForm={showCreateForm}
        name={"Settings > Team > Permissions-" + permissionType}
        createEditModalWidth={ModalWidth.Large}
        isViewable={false}
        createEditFromRef={formRef}
        query={{
          teamId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
          isBlockPermission: permissionType === PermissionType.BlockPermissions,
        }}
        onBeforeCreate={(item: TeamPermission): Promise<TeamPermission> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.teamId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          item.isBlockPermission =
            permissionType === PermissionType.BlockPermissions;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: tableTitle,
          description: tableDescription,
          buttons: createButtons,
        }}
        noItemsMessage={"No permissions created for this team so far."}
        formFields={
          createPermissionType === CreatePermissionType.RoleBased
            ? [
                {
                  field: {
                    permission: true,
                  },
                  onChange: async (value: any): Promise<void> => {
                    await formRef.current.setFieldValue("labels", [], true);
                    /*
                     * For scope-exempt roles (Project Owner, Settings
                     * Admin/Member/Viewer, Billing Admin/Member/Viewer)
                     * force scope to All since these are unconditional
                     * project-wide grants. The scope dropdown is hidden
                     * in that case, so without this the form would submit
                     * the default (Owned) and wrongly narrow the role.
                     */
                    if (
                      value &&
                      !PermissionHelper.isScopeApplicable(value as Permission)
                    ) {
                      await formRef.current.setFieldValue(
                        "scope",
                        PermissionScope.All,
                        true,
                      );
                    }
                  },
                  title: "Role",
                  description:
                    "Select a role to assign to this team. Roles provide a predefined set of permissions.",
                  fieldType: FormFieldSchemaType.CardSelect,
                  cardSelectOptions: roleCardSelectOptions,
                  required: true,
                  placeholder: "Select a role",
                },
                {
                  field: {
                    scope: true,
                  },
                  title: "Scope",
                  description:
                    "Which resources this role applies to. All (recommended): every resource in the project. Owned: resources where this team or its members are listed as owners. Labels: restrict by labels (advanced).",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownOptions: [
                    {
                      value: PermissionScope.All,
                      label: "All resources in the project",
                    },
                    {
                      value: PermissionScope.Owned,
                      label: "Owned by this team or its members",
                    },
                    {
                      value: PermissionScope.Labels,
                      label: "Restrict by labels (advanced)",
                    },
                  ],
                  defaultValue: PermissionScope.All,
                  required: true,
                  showIf: (values: FormValues<TeamPermission>): boolean => {
                    if (!values["permission"]) {
                      return false;
                    }
                    return PermissionHelper.isScopeApplicable(
                      values["permission"] as Permission,
                    );
                  },
                },
                {
                  field: {
                    labels: true,
                  },
                  title: "Restrict to Labels",
                  description:
                    "If you want to restrict this role to specific labels, you can select them here. Advanced.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Label,
                    labelField: "name",
                    valueField: "_id",
                  },
                  showIf: (values: FormValues<TeamPermission>): boolean => {
                    if (!values["permission"]) {
                      return false;
                    }
                    const scope: PermissionScope | undefined = values[
                      "scope"
                    ] as PermissionScope | undefined;
                    return scope === PermissionScope.Labels;
                  },
                  required: false,
                  placeholder: "Labels",
                },
              ]
            : [
                {
                  field: {
                    permission: true,
                  },
                  onChange: async (value: any): Promise<void> => {
                    await formRef.current.setFieldValue("labels", [], true);
                    /*
                     * Match the role-flow behavior: force scope=All when
                     * the user picks a scope-exempt permission so the
                     * hidden scope dropdown can't submit Owned.
                     */
                    if (
                      value &&
                      !PermissionHelper.isScopeApplicable(value as Permission)
                    ) {
                      await formRef.current.setFieldValue(
                        "scope",
                        PermissionScope.All,
                        true,
                      );
                    }
                  },
                  title: "Permission",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: true,
                  placeholder: "Search permissions...",
                  getCustomElement: (
                    _values: FormValues<TeamPermission>,
                    customElementProps: CustomElementProps,
                  ) => {
                    return (
                      <PermissionPicker
                        onChange={(value: Permission | null) => {
                          customElementProps.onChange?.(value);
                        }}
                        onBlur={customElementProps.onBlur}
                        tabIndex={customElementProps.tabIndex}
                        initialValue={
                          customElementProps.initialValue as
                            | Permission
                            | undefined
                        }
                        placeholder={customElementProps.placeholder}
                        error={customElementProps.error}
                      />
                    );
                  },
                },
                {
                  field: {
                    scope: true,
                  },
                  title: "Scope",
                  description:
                    "Which resources this permission applies to. All (recommended): every resource in the project. Owned: resources where this team or its members are listed as owners. Labels: restrict by labels (advanced).",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownOptions: [
                    {
                      value: PermissionScope.All,
                      label: "All resources in the project",
                    },
                    {
                      value: PermissionScope.Owned,
                      label: "Owned by this team or its members",
                    },
                    {
                      value: PermissionScope.Labels,
                      label: "Restrict by labels (advanced)",
                    },
                  ],
                  defaultValue: PermissionScope.All,
                  required: true,
                  showIf: (values: FormValues<TeamPermission>): boolean => {
                    if (!values["permission"]) {
                      return false;
                    }
                    if (
                      !PermissionHelper.isAccessControlPermission(
                        values["permission"] as Permission,
                      )
                    ) {
                      return false;
                    }
                    /*
                     * Scope-exempt permissions (ProjectOwner, Settings
                     * Admin/Member/Viewer, Billing Admin/Member/Viewer)
                     * are unconditional grants.
                     */
                    if (
                      !PermissionHelper.isScopeApplicable(
                        values["permission"] as Permission,
                      )
                    ) {
                      return false;
                    }
                    return true;
                  },
                },
                {
                  field: {
                    labels: true,
                  },
                  title: "Restrict to Labels",
                  description:
                    "If you want to restrict this permission to specific labels, you can select them here. This is an optional and an advanced feature.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Label,
                    labelField: "name",
                    valueField: "_id",
                  },
                  showIf: (values: FormValues<TeamPermission>): boolean => {
                    if (!values["permission"]) {
                      return false;
                    }

                    if (
                      values["permission"] &&
                      !PermissionHelper.isAccessControlPermission(
                        values["permission"] as Permission,
                      )
                    ) {
                      return false;
                    }

                    /*
                     * Labels apply only in Labels scope mode. Owned/All do
                     * their filtering elsewhere and would ignore labels.
                     */
                    const scope: PermissionScope | undefined = values[
                      "scope"
                    ] as PermissionScope | undefined;
                    if (scope && scope !== PermissionScope.Labels) {
                      return false;
                    }

                    return true;
                  },
                  required: false,
                  placeholder: "Labels",
                },
              ]
        }
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              permission: true,
            },
            type: FieldType.Text,
            title: "Permission",
          },
          {
            field: {
              labels: {
                name: true,
              },
            },
            type: FieldType.EntityArray,
            title: "Labels",
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
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
              permission: true,
            },
            title: "Permission",
            type: FieldType.Text,

            getElement: (item: TeamPermission): ReactElement => {
              return (
                <p>
                  {PermissionHelper.getTitle(item["permission"] as Permission)}
                </p>
              );
            },
          },
          {
            field: {
              scope: true,
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Scope",
            type: FieldType.Text,
            getElement: (item: TeamPermission): ReactElement => {
              const scope: PermissionScope =
                (item["scope"] as PermissionScope) || PermissionScope.Labels;

              if (scope === PermissionScope.Owned) {
                return <p>Owned by team or members</p>;
              }

              if (scope === PermissionScope.All) {
                return <p>All resources in project</p>;
              }

              // scope === Labels — show the labels (or an explanation).
              if (
                item["permission"] &&
                !PermissionHelper.isAccessControlPermission(
                  item["permission"] as Permission,
                )
              ) {
                return (
                  <p>
                    All resources{" "}
                    <span className="text-gray-400">
                      (labels don&apos;t apply to this permission)
                    </span>
                  </p>
                );
              }

              const labels: Array<Label> = (item["labels"] ||
                []) as Array<Label>;
              if (labels.length === 0) {
                return (
                  <p>
                    All resources{" "}
                    <span className="text-gray-400">(no labels selected)</span>
                  </p>
                );
              }

              return (
                <div className="flex flex-col gap-1">
                  <p className="text-gray-500">Restricted to labels:</p>
                  <LabelsElement labels={labels} />
                </div>
              );
            },
          },
        ]}
      />
    );
  };

  return (
    <Fragment>
      {/* API Key View  */}
      <CardModelDetail
        name="Team Details"
        cardProps={{
          title: "Team Details",
          description: "Here are more details for this team.",
        }}
        videoLink={URL.fromString("https://youtu.be/TzmaTe4sbCI")}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Team Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Team Description",
          },
        ]}
        modelDetailProps={{
          modelType: Team,
          id: "model-detail-team",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Team ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: Navigation.getLastParamAsObjectID(),
        }}
      />

      {/* Team Members Table */}

      {isPushGroupsManaged && (
        <Banner
          title="Team membership is managed by SCIM Push Groups"
          description="Manage team members from your identity provider or disable Push Groups in Settings > SCIM to make changes here."
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
        onBeforeDelete={async (item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot remove team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          return item;
        }}
        cardProps={{
          title: "Team Members",
          description: "See a list of members or invite them to this team. ",
        }}
        noItemsMessage={"No members found for this team."}
        formFields={[
          {
            field: {
              user: true,
            },
            title: "User Email",
            description:
              "Please enter the email of the user you would like to invite. We will send them an email to let them know they have been invited to this team.",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: "member@company.com",
            overrideFieldKey: "email",
          },
        ]}
        showRefreshButton={true}
        deleteButtonText="Remove Member"
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        actionButtons={[
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
                return <Pill text="Member" color={Green} />;
              }
              return <Pill text="Invitation Sent" color={Yellow} />;
            },
          },
        ]}
      />

      {/* Team Compliance Settings — Enterprise gated */}
      {!isComplianceEnterpriseEligible ? (
        <EnterpriseFeatureUpgrade
          title="Compliance Settings"
          description="Enforce compliance rules on this team."
          featureName="Team Compliance Rules"
          featureDescription="Require team members to have the notification methods and on-call configurations needed for SOC 2, ISO 27001, HIPAA and internal reviews."
          benefits={[
            {
              icon: IconProp.ShieldCheck,
              title: "Notification method rules",
              subtitle:
                "Require members to keep email, SMS, push or voice methods configured.",
            },
            {
              icon: IconProp.Bell,
              title: "On-call coverage",
              subtitle:
                "Make sure every team has on-call policies and schedules in place.",
            },
            {
              icon: IconProp.ClipboardDocumentList,
              title: "Compliance dashboard",
              subtitle:
                "See which members satisfy each rule and which need attention.",
            },
            {
              icon: IconProp.Settings,
              title: "Configurable per team",
              subtitle:
                "Apply stricter rules to oncall teams and lighter rules elsewhere.",
            },
          ]}
        />
      ) : null}

      {/* Team Compliance Settings Table */}
      {isComplianceEnterpriseEligible ? (
        <ModelTable<TeamComplianceSetting>
          modelType={TeamComplianceSetting}
          id="table-team-compliance-setting"
          userPreferencesKey="team-compliance-setting-table"
          saveFilterProps={{
            tableId: "settings-team-compliance-setting-table",
          }}
          isDeleteable={true}
          name="Settings > Team > Compliance Settings"
          isCreateable={true}
          isEditable={true}
          isViewable={false}
          query={{
            teamId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          onBeforeCreate={(
            item: TeamComplianceSetting,
          ): Promise<TeamComplianceSetting> => {
            if (!props.currentProject || !props.currentProject._id) {
              throw new BadDataException("Project ID cannot be null");
            }
            item.teamId = modelId;
            item.projectId = new ObjectID(props.currentProject._id);
            return Promise.resolve(item);
          }}
          onCreateSuccess={async (
            item: TeamComplianceSetting,
          ): Promise<TeamComplianceSetting> => {
            complianceStatusTableRef.current?.refresh();
            return item;
          }}
          onItemDeleted={(_item: TeamComplianceSetting): void => {
            complianceStatusTableRef.current?.refresh();
          }}
          cardProps={{
            title: "Compliance Settings",
            description:
              "Configure compliance rules for this team. These rules ensure team members have the required notification methods and on-call configurations.",
          }}
          noItemsMessage={"No compliance settings configured for this team."}
          formFields={[
            {
              field: {
                ruleType: true,
              },
              title: "Rule Type",
              fieldType: FormFieldSchemaType.Dropdown,
              required: true,
              dropdownOptions: [
                {
                  value: ComplianceRuleType.HasNotificationEmailMethod,
                  label: "User has Email Notification Method",
                },
                {
                  value: ComplianceRuleType.HasNotificationSMSMethod,
                  label: "User has SMS Notification Method",
                },
                {
                  value: ComplianceRuleType.HasNotificationCallMethod,
                  label: "User has Call Notification Method",
                },
                {
                  value: ComplianceRuleType.HasNotificationPushMethod,
                  label: "User has Push Notification Method",
                },
                {
                  value: ComplianceRuleType.HasIncidentOnCallRules,
                  label: "User has Incident On-Call Rules",
                },
                {
                  value: ComplianceRuleType.HasAlertOnCallRules,
                  label: "User has Alert On-Call Rules",
                },
              ],
              description:
                "Select the type of compliance rule to enforce for team members.",
            },
            {
              field: {
                enabled: true,
              },
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description: "Enable or disable this compliance rule.",
            },
          ]}
          showRefreshButton={true}
          filters={[
            {
              field: {
                ruleType: true,
              },
              type: FieldType.Text,
              title: "Rule Type",
            },
            {
              field: {
                enabled: true,
              },
              type: FieldType.Boolean,
              title: "Enabled",
            },
          ]}
          columns={[
            {
              field: {
                ruleType: true,
              },
              title: "Rule Type",
              type: FieldType.Text,
              getElement: (item: TeamComplianceSetting): ReactElement => {
                const ruleTypeLabels: Record<string, string> = {
                  [ComplianceRuleType.HasNotificationEmailMethod]:
                    "Email Notification Method Required for Users",
                  [ComplianceRuleType.HasNotificationSMSMethod]:
                    "SMS Notification Method Required for Users",
                  [ComplianceRuleType.HasNotificationCallMethod]:
                    "Call Notification Method Required for Users",
                  [ComplianceRuleType.HasNotificationPushMethod]:
                    "Push Notification Method Required for Users",
                  [ComplianceRuleType.HasIncidentOnCallRules]:
                    "Incident On-Call Rules Required for Users",
                  [ComplianceRuleType.HasAlertOnCallRules]:
                    "Alert On-Call Rules Required for Users",
                };
                return (
                  <span>{ruleTypeLabels[item.ruleType!] || item.ruleType}</span>
                );
              },
            },
            {
              field: {
                enabled: true,
              },
              title: "Status",
              type: FieldType.Boolean,
              getElement: (item: TeamComplianceSetting): ReactElement => {
                if (item.enabled) {
                  return <Pill text="Enabled" color={Green} />;
                }
                return <Pill text="Disabled" color={Yellow} />;
              },
            },
          ]}
        />
      ) : null}

      {/* Team Compliance Status Table — Enterprise only */}
      {isComplianceEnterpriseEligible ? (
        <TeamComplianceStatusTable
          ref={complianceStatusTableRef}
          teamId={modelId}
        />
      ) : null}

      {/* Team Permisison Table */}
      <TeamPermissionTable permissionType={PermissionType.AllowPermissions} />

      {/* Team Block Permisison Table */}
      <TeamPermissionTable permissionType={PermissionType.BlockPermissions} />

      {/* Delete Team */}
      <ModelDelete
        modelType={Team}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TEAMS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TeamView;
