import EnterpriseSettingLicenseNotice from "../EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  isEnterpriseConfigurationReadOnly,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import { getTeamsBreadcrumbs } from "@oneuptime/dashboard/Utils/Breadcrumbs/TeamsBreadcrumbs";
import {
  doesRoleReachAnything,
  getRoleDeleteReachSentence,
  getRoleReachSentence,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleCopy";
import { getCustomRoleEditFormFields } from "./CustomRoleCreateForm";
import CustomRolePermissionTable from "./CustomRolePermissionTable";
import {
  CustomRoleReachDetails,
  loadCustomRoleReach,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleReach";
import CustomRoleApiKeysTable from "./CustomRoleApiKeysTable";
import CustomRoleTeamsTable from "./CustomRoleTeamsTable";
import CustomRoleWorkflowsTable from "./CustomRoleWorkflowsTable";
import {
  CustomRoleDeleteWorkflows,
  WORKFLOWS_RUN_AS_DEFAULT_CHOICE,
  getCustomRoleDeleteBlockedReason,
  getCustomRoleDeleteMiscDataProps,
  loadCustomRoleDeleteWorkflows,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleDeleteWorkflows";
import CustomRoleDeleteWorkflowsChoice from "@oneuptime/dashboard/Components/CustomRole/CustomRoleDeleteWorkflowsChoice";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * A CUSTOM ROLE'S PAGE: what it is called, what it gives, who has it, and
 * deleting it - in the order they are used.
 *
 *   - Custom Role Details: its name and description, edited in place;
 *   - Permissions: what the role gives (CustomRolePermissionTable), under a
 *     line that says who a change reaches - "Given to 3 teams (12 people)
 *     and 2 API keys, and 4 workflows run as it. A change here changes
 *     what they can do at once." - read again after every change of the
 *     teams and keys given it. The workflows are counted for a reader who
 *     may read them (#9831). A role nothing has yet says only what it
 *     gives: the cards under it say no team, key or workflow has it;
 *   - Teams with this Role: the teams given it (CustomRoleTeamsTable);
 *   - API Keys with this Role: the keys given it (CustomRoleApiKeysTable),
 *     for whoever may read the project's API keys, saying what a key gets
 *     of the role - read again after every change of its permissions, as
 *     an edited scope can change that;
 *   - Workflows that Run as this Role: the workflows whose steps do what
 *     the role allows (CustomRoleWorkflowsTable, #9831), for whoever may
 *     read the project's workflows, each a link to its Run As;
 *   - Delete: what deleting it takes from whom, before it is pressed - and
 *     the workflows that run as it, which would stop, with what they run as
 *     instead (#9767): picked in the dialog and sent with the delete, or,
 *     for a reader who may not edit them, Delete locked, saying why.
 *
 * Custom roles are an Enterprise feature: this is the Enterprise page, and
 * core keeps the route (Pages/Teams/RoleView.tsx). When the Enterprise
 * license has lapsed or leaves custom roles out, a notice says the role
 * keeps applying, and only removing is offered: the server refuses changes.
 */

const TeamRoleView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [roleName, setRoleName] = useState<string>("");
  const [reach, setReach] = useState<CustomRoleReachDetails | null>(null);
  /*
   * The workflows that run as the role (#9767): its Delete says they would
   * stop, and what they run as instead - picked in the dialog, and sent
   * with the delete.
   */
  const [deleteWorkflows, setDeleteWorkflows] =
    useState<CustomRoleDeleteWorkflows | null>(null);
  const workflowsChoice: MutableRefObject<string> = useRef<string>(
    WORKFLOWS_RUN_AS_DEFAULT_CHOICE,
  );
  // Counts the reads of the role's permissions: what its API keys get follows.
  const [permissionsChangeToggle, setPermissionsChangeToggle] =
    useState<number>(0);

  /*
   * Whether the reader may read the project's workflows: then the reach
   * line counts the workflows that run as the role, and the card under
   * the API keys lists them (#9831).
   */
  const mayReadWorkflows: boolean = PermissionGate.check(
    new Workflow(),
    ModelAction.Read,
  ).isAllowed;

  const readReach: () => void = useCallback((): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    loadCustomRoleReach({
      customRoleId: modelId,
      projectId: projectId,
      includeWorkflows: mayReadWorkflows,
    })
      .then((loaded: CustomRoleReachDetails) => {
        setReach(loaded);
      })
      .catch(() => {
        // Without it the card says what the role gives, not who has it.
        setReach(null);
      });

    loadCustomRoleDeleteWorkflows({
      customRoleId: modelId,
      projectId: projectId,
    })
      .then((loaded: CustomRoleDeleteWorkflows) => {
        setDeleteWorkflows(loaded);
      })
      .catch(() => {
        // Without it the delete asks as before, and the server says what to do.
        setDeleteWorkflows(null);
      });
  }, [modelId.toString(), mayReadWorkflows]);

  const hasDeleteWorkflows: boolean = Boolean(
    deleteWorkflows && deleteWorkflows.workflows.length > 0,
  );
  // Workflows run as it, and the reader may not say what they run as instead.
  const isDeleteBlocked: boolean = Boolean(
    hasDeleteWorkflows && deleteWorkflows && !deleteWorkflows.canEditWorkflows,
  );

  useEffect(() => {
    readReach();
  }, [readReach]);

  /*
   * The trail ends with the role's name once it is read - Project > Teams >
   * Roles > Incident Responder - where the layout alone could only say
   * "View Role".
   */
  const breadcrumbLinks: Array<Link> | null = useMemo(() => {
    const links: Array<Link> | undefined = getTeamsBreadcrumbs(
      RouteUtil.getRouteString(PageMap.TEAM_ROLE_VIEW),
    );

    if (!roleName || !links || links.length === 0) {
      return null;
    }

    // The name as it was typed: a name is never translated (Link.isRecordName).
    return links.map((link: Link, index: number): Link => {
      return index === links.length - 1
        ? { ...link, title: roleName, isRecordName: true }
        : link;
    });
  }, [roleName]);

  usePageBreadcrumbLinks(breadcrumbLinks);

  const permissionsDescription: string =
    reach && doesRoleReachAnything(reach)
      ? translator.translateTemplate("What this role gives. {{reach}}", {
          reach: getRoleReachSentence(translator, reach),
        })
      : translator.translateText("What this role gives.") ||
        "What this role gives.";

  // Name and Description, with their own help (CustomRoleCreateForm).
  const editFormFields: Array<ModelField<CustomRole>> = useMemo(() => {
    return getCustomRoleEditFormFields();
  }, []);

  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.CustomRoles,
  );
  const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(licenseMode);

  return (
    <Fragment>
      <EnterpriseSettingLicenseNotice
        mode={licenseMode}
        feature={LicensedFeature.CustomRoles}
      />
      <CardModelDetail<CustomRole>
        name="Custom Role Details"
        cardProps={{
          title: "Custom Role Details",
        }}
        isEditable={!isReadOnly}
        formFields={editFormFields}
        modelDetailProps={{
          modelType: CustomRole,
          id: "model-detail-custom-role",
          fields: [
            /*
             * Drawn as the small ID line under the fields, with a copy
             * button: what the API and Terraform name the role by.
             */
            {
              field: {
                _id: true,
              },
              title: "Custom Role ID",
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
              placeholder: "No description",
            },
          ],
          modelId: modelId,
          onItemLoaded: (item: CustomRole) => {
            setRoleName(item.name || "");
          },
        }}
      />

      <CustomRolePermissionTable
        customRoleId={modelId}
        roleName={roleName}
        description={permissionsDescription}
        isReadOnly={isReadOnly}
        onPermissionCountChange={() => {
          setPermissionsChangeToggle((count: number): number => {
            return count + 1;
          });
        }}
      />

      <CustomRoleTeamsTable
        customRoleId={modelId}
        roleName={roleName}
        onTeamsChange={readReach}
        isReadOnly={isReadOnly}
      />

      <CustomRoleApiKeysTable
        customRoleId={modelId}
        roleName={roleName}
        onApiKeysChange={readReach}
        permissionsChangeToggle={permissionsChangeToggle}
        isReadOnly={isReadOnly}
      />

      <CustomRoleWorkflowsTable customRoleId={modelId} />

      <ModelDelete
        modelType={CustomRole}
        modelId={modelId}
        itemName={roleName || undefined}
        // Drawn as the dialog's own sentences are, as one more paragraph.
        confirmationContent={
          reach || hasDeleteWorkflows ? (
            <div className="space-y-3">
              {reach ? (
                <p
                  className="text-sm leading-6 text-gray-600"
                  data-testid="custom-role-delete-reach"
                >
                  {getRoleDeleteReachSentence(translator, reach)}
                </p>
              ) : (
                <></>
              )}
              {deleteWorkflows && hasDeleteWorkflows && !isDeleteBlocked ? (
                <CustomRoleDeleteWorkflowsChoice
                  found={deleteWorkflows}
                  onChoiceChange={(next: string): void => {
                    workflowsChoice.current = next;
                  }}
                />
              ) : (
                <></>
              )}
            </div>
          ) : undefined
        }
        /*
         * Workflows run as it that the reader may not change: Delete is
         * locked, saying how many, why, and who can (#9767).
         */
        deleteLock={
          isDeleteBlocked && deleteWorkflows
            ? {
                isAllowed: false,
                disabledReason: getCustomRoleDeleteBlockedReason(
                  translator,
                  deleteWorkflows.workflows.length,
                ),
              }
            : undefined
        }
        // With what its workflows run as instead, when any runs as it.
        onDelete={async (): Promise<void> => {
          await ModelAPI.deleteItem<CustomRole>({
            modelType: CustomRole,
            id: modelId,
            ...(hasDeleteWorkflows
              ? {
                  miscDataProps: getCustomRoleDeleteMiscDataProps(
                    workflowsChoice.current,
                  ),
                }
              : {}),
          });
        }}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_ROLES] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TeamRoleView;
