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
  getRoleDeleteReachSentence,
  getRoleReachSentence,
  isRoleGivenToAnyone,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleCopy";
import { getCustomRoleEditFormFields } from "./CustomRoleCreateForm";
import CustomRolePermissionTable from "./CustomRolePermissionTable";
import {
  CustomRoleReachDetails,
  loadCustomRoleReach,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleReach";
import CustomRoleApiKeysTable from "./CustomRoleApiKeysTable";
import CustomRoleTeamsTable from "./CustomRoleTeamsTable";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * A CUSTOM ROLE'S PAGE: what it is called, what it gives, who has it, and
 * deleting it - in the order they are used.
 *
 *   - Custom Role Details: its name and description, edited in place;
 *   - Permissions: what the role gives (CustomRolePermissionTable), under a
 *     line that says who a change reaches - "Given to 3 teams (12 people)
 *     and 2 API keys. A change here changes what they can do at once." -
 *     read again after every change of the teams and keys given it. A role
 *     nothing has yet says only what it gives: the cards under it say no
 *     team or key has it;
 *   - Teams with this Role: the teams given it (CustomRoleTeamsTable);
 *   - API Keys with this Role: the keys given it (CustomRoleApiKeysTable),
 *     for whoever may read the project's API keys, saying what a key gets
 *     of the role - read again after every change of its permissions, as
 *     an edited scope can change that;
 *   - Delete: what deleting it takes from whom, before it is pressed.
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
  // Counts the reads of the role's permissions: what its API keys get follows.
  const [permissionsChangeToggle, setPermissionsChangeToggle] =
    useState<number>(0);

  const readReach: () => void = useCallback((): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    loadCustomRoleReach({ customRoleId: modelId, projectId: projectId })
      .then((loaded: CustomRoleReachDetails) => {
        setReach(loaded);
      })
      .catch(() => {
        // Without it the card says what the role gives, not who has it.
        setReach(null);
      });
  }, [modelId.toString()]);

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
    reach && isRoleGivenToAnyone(reach)
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

      <ModelDelete
        modelType={CustomRole}
        modelId={modelId}
        itemName={roleName || undefined}
        // Drawn as the dialog's own sentences are, as one more paragraph.
        confirmationContent={
          reach ? (
            <p
              className="text-sm leading-6 text-gray-600"
              data-testid="custom-role-delete-reach"
            >
              {getRoleDeleteReachSentence(translator, reach)}
            </p>
          ) : undefined
        }
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
