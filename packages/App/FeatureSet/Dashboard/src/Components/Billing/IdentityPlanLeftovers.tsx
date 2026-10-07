import { PlanLeftoverTitle } from "./PlanLeftoverCopy";
import PlanLeftoverTable from "./PlanLeftoverTable";
import RequireSsoForLoginLeftover from "../Project/RequireSsoForLoginLeftover";
import StatusPageRequireSsoLeftover from "../StatusPage/StatusPageRequireSsoLeftover";
import {
  IDENTITY_REQUIRED_PLAN,
  SSO_REQUIRED_PLAN,
} from "../../Enterprise/EnterpriseEligibility";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import ObjectID from "Common/Types/ObjectID";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a project below the Scale plan still has of single sign-on and SCIM,
 * drawn under each page's upsell (PlanGatedPage's and EnterprisePluginPage's
 * belowPlan): its SAML and OIDC providers, which keep signing people in
 * until they are turned off or deleted, and its SCIM connections, which
 * only remove people until the project is back on the plan
 * (Common/Types/Billing/PlanCutoffCredentials) and can be deleted
 * (PlanLeftoverTable). Configuration a lower plan cannot use can still be
 * seen, switched off and removed (Common/Types/Billing/PlanGatedTable).
 *
 * Each is a component of its own, so a page hands its upsell an element and
 * nothing here - the project, the status page in the address - is read
 * unless the project is known to be below the plan and it is drawn.
 */

// Which provider or connection is which: its name.
const nameColumns: <TBaseModel extends BaseModel>() => Columns<TBaseModel> = <
  TBaseModel extends BaseModel,
>(): Columns<TBaseModel> => {
  return [
    {
      field: {
        name: true,
      } as Columns<TBaseModel>[number]["field"],
      title: "Name",
      type: FieldType.Text,
    },
  ];
};

// The status page a status page's SSO, OIDC or SCIM page is for.
const getStatusPageId: () => ObjectID = (): ObjectID => {
  return Navigation.getLastParamAsObjectID(1);
};

// Settings > SSO: the project's SAML providers.
export const ProjectSamlProvidersLeftover: FunctionComponent =
  (): ReactElement => {
    return (
      <PlanLeftoverTable<ProjectSSO>
        modelType={ProjectSSO}
        id="project-saml-providers"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        requiredPlan={SSO_REQUIRED_PLAN}
        title={PlanLeftoverTitle.samlProviders}
        columns={nameColumns<ProjectSSO>()}
      />
    );
  };

/*
 * Settings > OIDC: "Require SSO for Login" while the project still requires
 * it, as on Settings > SSO - turning the last provider off while it does
 * would leave nobody a way in - then the project's OIDC providers.
 */
export const ProjectOidcProvidersLeftover: FunctionComponent =
  (): ReactElement => {
    const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

    return (
      <>
        <RequireSsoForLoginLeftover projectId={projectId} />
        <PlanLeftoverTable<ProjectOIDC>
          modelType={ProjectOIDC}
          id="project-oidc-providers"
          query={{
            projectId: projectId,
          }}
          requiredPlan={SSO_REQUIRED_PLAN}
          title={PlanLeftoverTitle.oidcProviders}
          columns={nameColumns<ProjectOIDC>()}
        />
      </>
    );
  };

// Settings > SCIM: the project's SCIM connections. Their tokens are not shown.
export const ProjectScimConnectionsLeftover: FunctionComponent =
  (): ReactElement => {
    return (
      <PlanLeftoverTable<ProjectSCIM>
        modelType={ProjectSCIM}
        id="project-scim-connections"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        title={PlanLeftoverTitle.scimConnections}
        columns={nameColumns<ProjectSCIM>()}
      />
    );
  };

/*
 * Status page > SSO: "Require SSO for Login" while the status page still
 * requires it (StatusPageRequireSsoLeftover), then its SAML providers.
 */
export const StatusPageSamlProvidersLeftover: FunctionComponent =
  (): ReactElement => {
    const statusPageId: ObjectID = getStatusPageId();

    return (
      <>
        <StatusPageRequireSsoLeftover statusPageId={statusPageId} />
        <PlanLeftoverTable<StatusPageSSO>
          modelType={StatusPageSSO}
          id="status-page-saml-providers"
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            statusPageId: statusPageId.toString(),
          }}
          requiredPlan={SSO_REQUIRED_PLAN}
          title={PlanLeftoverTitle.samlProviders}
          columns={nameColumns<StatusPageSSO>()}
        />
      </>
    );
  };

/*
 * Status page > OIDC: "Require SSO for Login" while the status page still
 * requires it, as on its SSO page, then its OIDC providers.
 */
export const StatusPageOidcProvidersLeftover: FunctionComponent =
  (): ReactElement => {
    const statusPageId: ObjectID = getStatusPageId();

    return (
      <>
        <StatusPageRequireSsoLeftover statusPageId={statusPageId} />
        <PlanLeftoverTable<StatusPageOIDC>
          modelType={StatusPageOIDC}
          id="status-page-oidc-providers"
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            statusPageId: statusPageId.toString(),
          }}
          requiredPlan={SSO_REQUIRED_PLAN}
          title={PlanLeftoverTitle.oidcProviders}
          columns={nameColumns<StatusPageOIDC>()}
        />
      </>
    );
  };

// Status page > SCIM: its SCIM connections.
export const StatusPageScimConnectionsLeftover: FunctionComponent =
  (): ReactElement => {
    return (
      <PlanLeftoverTable<StatusPageSCIM>
        modelType={StatusPageSCIM}
        id="status-page-scim-connections"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          statusPageId: getStatusPageId().toString(),
        }}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        title={PlanLeftoverTitle.scimConnections}
        columns={nameColumns<StatusPageSCIM>()}
      />
    );
  };
