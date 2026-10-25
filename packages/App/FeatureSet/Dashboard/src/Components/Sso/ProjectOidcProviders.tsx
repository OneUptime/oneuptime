import TeamsElement from "../Team/TeamsElement";
import { getSsoTeamsGrantNote } from "./SsoTeamsGrantNote";
import ProjectSsoCopy from "./ProjectSsoCopy";
import ProjectUtil from "Common/UI/Utils/Project";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CopyableValueList from "Common/UI/Components/CopyableValueList/CopyableValueList";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getOidcProviderFormFields } from "Common/UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The provider the configuration dialog is open for: its id, and whether it
 * is on, so the dialog can say what is left to do.
 */
interface OidcConfigDialogTarget {
  id: string;
  isEnabled: boolean;
}

/*
 * The project's OpenID Connect sign-on providers, on Project Settings >
 * Security > SSO under its SAML providers - one page for single sign-on,
 * with one test link and the Require SSO for Login switch, which counts an
 * OIDC sign-in exactly as a SAML one. They had a page of their own
 * (Settings > OIDC), which told nobody that requiring SSO lived on the
 * other page; that address forwards to SSO now (MovedPagePaths).
 *
 * Adding one asks for its name, issuer, client ID and secret, and the teams
 * newcomers join (the members team to start with); everything else is
 * filled in under Advanced (Common/UI/Components/Sso/OidcProviderFormFields).
 * Once it is saved, the dialog with the redirect URI to give the identity
 * provider opens straight away: that is the next thing to do.
 */
export interface ComponentProps {
  /*
   * What a new provider's Create form starts with: the team the project's
   * members join, which the SSO page looks up once for its SAML and OIDC
   * tables alike (useDefaultSsoTeamsInitialValues).
   */
  createInitialValues?: FormValues<ProjectOIDC> | undefined;
  /*
   * How many OIDC providers the project has, after each load of the list:
   * the page's test link waits for a provider of either kind to try.
   */
  onProviderCountChange?: ((count: number) => void) | undefined;
}

const ProjectOidcProviders: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [oidcConfigTarget, setOidcConfigTarget] =
    useState<OidcConfigDialogTarget | null>(null);
  const showOidcConfigId: string = oidcConfigTarget?.id || "";

  const createInitialValues: FormValues<ProjectOIDC> | undefined =
    props.createInitialValues;

  return (
    <Fragment>
      <ModelTable<ProjectOIDC>
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        modelType={ProjectOIDC}
        userPreferencesKey={"project-oidc-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="oidc-table"
        name="Settings > Project OIDC"
        saveFilterProps={{
          tableId: "settings-project-oidc-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        /*
         * "Add OIDC Provider", and "No OIDC providers yet" while it has
         * none - as a status page's OIDC list reads (ProjectSsoCopy).
         */
        singularName={ProjectSsoCopy.oidcProvider}
        pluralName={ProjectSsoCopy.oidcProviders}
        createVerb="Add"
        cardProps={{
          title: "OpenID Connect (OIDC)",
          description:
            "Sign in through an OpenID Connect app, such as Google Workspace, Auth0 or Keycloak.",
        }}
        formSteps={getSsoProviderFormSteps<ProjectOIDC>()}
        onFetchSuccess={(
          _data: Array<ProjectOIDC>,
          totalCount: number,
        ): void => {
          props.onProviderCountChange?.(totalCount);
        }}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={getOidcProviderFormFields<ProjectOIDC>({
          withTeams: true,
          getTeamsFooterElement: getSsoTeamsGrantNote,
        })}
        createInitialValues={createInitialValues}
        onCreateSuccess={(
          item: ProjectOIDC,
          modalType?: ModalType,
        ): Promise<ProjectOIDC> => {
          if (modalType === ModalType.Create && item._id) {
            setOidcConfigTarget({
              id: item._id.toString(),
              isEnabled: Boolean(item.isEnabled),
            });
          }

          return Promise.resolve(item);
        }}
        showRefreshButton={true}
        actionButtons={[
          {
            title: "View OIDC Config",
            icon: IconProp.Settings,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: ProjectOIDC,
              onCompleteAction: VoidFunction,
            ) => {
              setOidcConfigTarget({
                id: (item["_id"] as string) || "",
                isEnabled: Boolean(item.isEnabled),
              });
              onCompleteAction();
            },
          },
        ]}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              teams: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            // The teams people who sign in for the first time join.
            title: ProjectSsoCopy.teamsColumn,
            type: FieldType.Text,
            getElement: (item: ProjectOIDC): ReactElement => {
              return <TeamsElement teams={item["teams"] || []} />;
            },
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
      />

      {showOidcConfigId && (
        <ConfirmModal
          title={`OIDC Configuration`}
          description={
            <div className="space-y-4">
              {/*
               * The values to give the identity provider, each with a
               * button that copies it.
               */}
              <CopyableValueList
                dataTestId="oidc-config-values"
                values={[
                  {
                    label: "Redirect URI (Callback URL):",
                    value: `${URL.fromString(IDENTITY_URL.toString()).addRoute(
                      `/oidc-callback/${ProjectUtil.getCurrentProjectId()?.toString()}/${showOidcConfigId}`,
                    )}`,
                  },
                  {
                    label: "Identifier (audience):",
                    value: `${HTTP_PROTOCOL}${HOST}/${ProjectUtil.getCurrentProjectId()?.toString()}/${showOidcConfigId}`,
                  },
                ]}
              />
              <div className="text-sm text-gray-500">
                {translator.translateText(
                  "Configure your identity provider to redirect to the URL above after authentication. The client must be permitted to use the authorization code flow with PKCE.",
                )}
              </div>
              {!oidcConfigTarget?.isEnabled && (
                <div
                  className="mt-3 text-sm text-gray-500"
                  data-testid="oidc-config-turn-on-note"
                >
                  {translator.translateText(
                    "This provider is off. Once your identity provider has the redirect URI above, edit the provider and turn Enabled on.",
                  )}
                </div>
              )}
            </div>
          }
          submitButtonText={"Close"}
          onSubmit={() => {
            setOidcConfigTarget(null);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      )}
    </Fragment>
  );
};

export default ProjectOidcProviders;
