import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getTeamsBreadcrumbs } from "../../Utils/Breadcrumbs/TeamsBreadcrumbs";
import {
  getRoleDeleteReachSentence,
  getRoleReachSentence,
} from "../../Components/CustomRole/CustomRoleCopy";
import CustomRolePermissionTable from "../../Components/CustomRole/CustomRolePermissionTable";
import {
  CustomRoleReachDetails,
  loadCustomRoleReach,
} from "../../Components/CustomRole/CustomRoleReach";
import CustomRoleTeamsTable from "../../Components/CustomRole/CustomRoleTeamsTable";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { CUSTOM_ROLE_NAME_MAX_LENGTH } from "Common/Types/Team/CustomRole";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
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
 *   - Role: its name and description, edited in place;
 *   - Permissions: what the role gives (CustomRolePermissionTable), under a
 *     line that says who a change reaches - "Given to 3 teams (12 people).
 *     A change here changes what they can do at once." - read again after
 *     every change of the teams;
 *   - Teams with this Role: the teams given it (CustomRoleTeamsTable);
 *   - Delete: what deleting it takes from whom, before it is pressed.
 */

const TeamRoleView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [roleName, setRoleName] = useState<string>("");
  const [reach, setReach] = useState<CustomRoleReachDetails | null>(null);

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

    return links.map((link: Link, index: number): Link => {
      return index === links.length - 1 ? { ...link, title: roleName } : link;
    });
  }, [roleName]);

  usePageBreadcrumbLinks(breadcrumbLinks);

  const permissionsDescription: string = reach
    ? translator.translateTemplate("What this role gives. {{reach}}", {
        reach: getRoleReachSentence(translator, reach),
      })
    : translator.translateText("What this role gives.") ||
      "What this role gives.";

  return (
    <Fragment>
      <CardModelDetail<CustomRole>
        name="Custom Role"
        cardProps={{
          title: "Custom Role",
          description:
            "A set of permissions given to teams. Its name is how it reads wherever a team's access is shown.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Incident Responder",
            validation: {
              minLength: 2,
              maxLength: CUSTOM_ROLE_NAME_MAX_LENGTH,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Declares, works and resolves incidents and alerts.",
          },
        ]}
        modelDetailProps={{
          modelType: CustomRole,
          id: "model-detail-custom-role",
          fields: [
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
        description={permissionsDescription}
      />

      <CustomRoleTeamsTable
        customRoleId={modelId}
        roleName={roleName}
        onTeamsChange={readReach}
      />

      <ModelDelete
        modelType={CustomRole}
        modelId={modelId}
        itemName={roleName || undefined}
        confirmationContent={
          reach ? (
            <p
              className="mt-2 text-sm text-gray-500"
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
