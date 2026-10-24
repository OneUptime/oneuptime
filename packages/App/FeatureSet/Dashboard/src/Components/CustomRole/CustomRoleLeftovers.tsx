import CustomRoleLeftoverCopy, {
  API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID,
  PROJECT_CUSTOM_ROLES_LEFTOVER_TEST_ID,
  TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID,
} from "./CustomRoleLeftoverCopy";
import {
  getPermissionCountText,
  getRoleDeleteReachSentence,
  getRoleRemoveFromApiKeySentence,
  getRoleRemoveFromTeamSentence,
} from "./CustomRoleCopy";
import { CustomRoleReachDetails, loadCustomRoleReach } from "./CustomRoleReach";
import { CUSTOM_ROLES_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import { EnterpriseSettingLeftoverReason } from "../EnterpriseEdition/EnterpriseSettingLeftoverCopy";
import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import ObjectID from "Common/Types/ObjectID";
import DeleteConfirmationMessage from "Common/UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import { getDeleteConsequence } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import { DeleteConfirmation } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * What a project still has of custom roles where they cannot be created or
 * changed - the Community Edition, and OneUptime Cloud below the plan that
 * sells them - with the one move every edition allows: removing them (see
 * CustomRoleLeftoverCopy for why they are shown at all).
 *
 *   ProjectCustomRolesLeftover   under the upsell on Teams > Settings > Roles:
 *                                the project's roles, each with Delete, which
 *                                says first who loses what (CustomRoleReach).
 *   TeamCustomRolesLeftover      on a team's Permissions page: the roles the
 *                                team has, each with Remove.
 *   ApiKeyCustomRolesLeftover    on an API key's page: the roles the key
 *                                has, each with Remove.
 *
 * Each counts its rows once when it opens. None - as for nearly every
 * project - or a count that fails draws nothing.
 */

export interface ComponentProps {
  reason: EnterpriseSettingLeftoverReason;
}

export interface TeamComponentProps extends ComponentProps {
  teamId: ObjectID;
}

export interface ApiKeyComponentProps extends ComponentProps {
  apiKeyId: ObjectID;
}

const getDescription: (data: {
  translator: Translator;
  reason: EnterpriseSettingLeftoverReason;
  editionDescription: string;
  planDescription: string;
}) => string = (data: {
  translator: Translator;
  reason: EnterpriseSettingLeftoverReason;
  editionDescription: string;
  planDescription: string;
}): string => {
  return data.reason === EnterpriseSettingLeftoverReason.Plan
    ? data.translator.translateTemplate(data.planDescription, {
        planName: CUSTOM_ROLES_REQUIRED_PLAN,
      })
    : data.editionDescription;
};

// Whether there is anything to list: counted once, null while counting.
const useHasRows: (
  count: () => Promise<number>,
  key: string,
) => boolean | null = (
  count: () => Promise<number>,
  key: string,
): boolean | null => {
  const [hasRows, setHasRows] = useState<boolean | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    count()
      .then((rows: number): void => {
        if (isCurrent) {
          setHasRows(rows > 0);
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setHasRows(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [key]);

  return hasRows;
};

export const ProjectCustomRolesLeftover: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const hasRows: boolean | null = useHasRows(async (): Promise<number> => {
    if (!projectId) {
      return 0;
    }

    return await ModelAPI.count<CustomRole>({
      modelType: CustomRole,
      query: { projectId: projectId },
    });
  }, projectId?.toString() || "");

  if (!hasRows || !projectId) {
    return <></>;
  }

  return (
    <div data-testid={PROJECT_CUSTOM_ROLES_LEFTOVER_TEST_ID}>
      <ModelTable<CustomRole>
        modelType={CustomRole}
        id="custom-roles-leftover-table"
        userPreferencesKey="custom-roles-leftover-table"
        name="Teams > Settings > Roles > Still in force"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Custom Role"
        pluralName="Custom Roles"
        cardProps={{
          title: CustomRoleLeftoverCopy.projectTitle,
          description: getDescription({
            translator,
            reason: props.reason,
            editionDescription:
              CustomRoleLeftoverCopy.projectEditionDescription,
            planDescription: CustomRoleLeftoverCopy.projectPlanDescription,
          }),
        }}
        query={{
          projectId: projectId,
        }}
        getDeleteConfirmation={async (
          item: CustomRole,
        ): Promise<DeleteConfirmation> => {
          const reach: CustomRoleReachDetails = await loadCustomRoleReach({
            customRoleId: item.id!,
            projectId: projectId,
          });

          return {
            description: (
              <DeleteConfirmationMessage
                kind="question"
                name={item.name || ""}
                typeLabel="Custom Role"
                warning={[
                  getDeleteConsequence("CustomRole", translator),
                  getRoleDeleteReachSentence(translator, reach),
                ]
                  .filter((sentence: string): boolean => {
                    return Boolean(sentence);
                  })
                  .join(" ")}
              />
            ),
          };
        }}
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xl",
            getElement: (item: CustomRole): ReactElement => {
              return (
                <p className="font-medium text-gray-900 break-words">
                  {item.name}
                </p>
              );
            },
          },
          {
            field: {
              permissionCount: true,
            },
            title: "Permissions",
            type: FieldType.Element,
            getElement: (item: CustomRole): ReactElement => {
              return (
                <p className="whitespace-nowrap text-gray-700">
                  {getPermissionCountText(translator, item.permissionCount)}
                </p>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export const TeamCustomRolesLeftover: FunctionComponent<TeamComponentProps> = (
  props: TeamComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const hasRows: boolean | null = useHasRows(
    async (): Promise<number> => {
      if (!projectId) {
        return 0;
      }

      return await ModelAPI.count<TeamCustomRole>({
        modelType: TeamCustomRole,
        query: { teamId: props.teamId, projectId: projectId },
      });
    },
    `${projectId?.toString() || ""}-${props.teamId.toString()}`,
  );

  if (!hasRows || !projectId) {
    return <></>;
  }

  return (
    <div data-testid={TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID}>
      <ModelTable<TeamCustomRole>
        modelType={TeamCustomRole}
        id="team-custom-roles-leftover-table"
        userPreferencesKey="team-custom-roles-leftover-table"
        name="Teams > Team > Custom Roles > Still in force"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Custom Role"
        pluralName="Custom Roles"
        deleteButtonText="Remove"
        cardProps={{
          title: CustomRoleLeftoverCopy.teamTitle,
          description: getDescription({
            translator,
            reason: props.reason,
            editionDescription: CustomRoleLeftoverCopy.teamEditionDescription,
            planDescription: CustomRoleLeftoverCopy.teamPlanDescription,
          }),
        }}
        query={{
          teamId: props.teamId,
          projectId: projectId,
        }}
        getDeleteConfirmation={async (
          item: TeamCustomRole,
        ): Promise<DeleteConfirmation> => {
          return {
            title: translator.translateTemplate("Remove {{role}}", {
              role: item.customRole?.name || "",
            }),
            description: getRoleRemoveFromTeamSentence(translator, {
              roleName: item.customRole?.name || "",
              teamName: translator.translateText("This team") || "This team",
            }),
            submitButtonText: "Remove",
          };
        }}
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              customRole: {
                name: true,
                permissionCount: true,
              },
            },
            title: "Role",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xl",
            getElement: (item: TeamCustomRole): ReactElement => {
              return (
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 break-words">
                    {item.customRole?.name || ""}
                  </p>
                  <p className="text-sm text-gray-500">
                    {getPermissionCountText(
                      translator,
                      item.customRole?.permissionCount,
                    )}
                  </p>
                </div>
              );
            },
          },
        ]}
        noItemsMessage="This team has no custom role."
      />
    </div>
  );
};

export const ApiKeyCustomRolesLeftover: FunctionComponent<
  ApiKeyComponentProps
> = (props: ApiKeyComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const hasRows: boolean | null = useHasRows(
    async (): Promise<number> => {
      if (!projectId) {
        return 0;
      }

      return await ModelAPI.count<ApiKeyCustomRole>({
        modelType: ApiKeyCustomRole,
        query: { apiKeyId: props.apiKeyId, projectId: projectId },
      });
    },
    `${projectId?.toString() || ""}-${props.apiKeyId.toString()}`,
  );

  if (!hasRows || !projectId) {
    return <></>;
  }

  return (
    <div data-testid={API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID}>
      <ModelTable<ApiKeyCustomRole>
        modelType={ApiKeyCustomRole}
        id="api-key-custom-roles-leftover-table"
        userPreferencesKey="api-key-custom-roles-leftover-table"
        name="Settings > API Key > Custom Roles > Still in force"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Custom Role"
        pluralName="Custom Roles"
        deleteButtonText="Remove"
        cardProps={{
          title: CustomRoleLeftoverCopy.apiKeyTitle,
          description: getDescription({
            translator,
            reason: props.reason,
            editionDescription: CustomRoleLeftoverCopy.apiKeyEditionDescription,
            planDescription: CustomRoleLeftoverCopy.apiKeyPlanDescription,
          }),
        }}
        query={{
          apiKeyId: props.apiKeyId,
          projectId: projectId,
        }}
        getDeleteConfirmation={async (
          item: ApiKeyCustomRole,
        ): Promise<DeleteConfirmation> => {
          return {
            title: translator.translateTemplate("Remove {{role}}", {
              role: item.customRole?.name || "",
            }),
            description: getRoleRemoveFromApiKeySentence(translator, {
              roleName: item.customRole?.name || "",
              apiKeyName:
                translator.translateText("This API key") || "This API key",
            }),
            submitButtonText: "Remove",
          };
        }}
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              customRole: {
                name: true,
                permissionCount: true,
              },
            },
            title: "Role",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xl",
            hideTitleOnMobile: true,
            getElement: (item: ApiKeyCustomRole): ReactElement => {
              return (
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 break-words">
                    {item.customRole?.name || ""}
                  </p>
                  <p className="text-sm text-gray-500">
                    {getPermissionCountText(
                      translator,
                      item.customRole?.permissionCount,
                    )}
                  </p>
                </div>
              );
            },
          },
        ]}
        noItemsMessage="This API key has no custom role."
      />
    </div>
  );
};
