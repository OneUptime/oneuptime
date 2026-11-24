import PrivateAccessCopy, {
  SINGLE_SIGN_ON_TABS_TEST_ID,
} from "./PrivateAccessCopy";
import {
  OidcProviderModel,
  PrivateAccessKind,
  SamlProviderModel,
} from "./PrivateAccessKinds";
import OidcProvidersTable from "./OidcProvidersTable";
import RequireSsoCard from "./RequireSsoCard";
import SamlProvidersTable from "./SamlProvidersTable";
import PlanGatedPage from "../Billing/PlanGatedPage";
import { PlanLeftoverTitle } from "../Billing/PlanLeftoverCopy";
import PlanLeftoverTable from "../Billing/PlanLeftoverTable";
import { SSO_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSingleSignOnProtocol, {
  DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL,
  STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL_QUERY_PARAM,
  readStatusPageSingleSignOnProtocol,
} from "Common/Types/StatusPage/StatusPageSingleSignOnProtocol";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The single sign-on of a public link that asks its visitors to sign in
 * (#10250): a tab per protocol - SAML, then OIDC - as a status page's
 * Single Sign-On page has them (StatusPages/View/SingleSignOn), the open tab
 * in the address (`?protocol=oidc`), then Require SSO to Sign In.
 *
 * Every edition includes single sign-on. OneUptime Cloud sells it on the
 * Scale plan, so there a project below Scale sees the plan upsell instead,
 * with the providers a Scale trial left under it: they keep signing people
 * in until they are turned off or deleted.
 */
export interface ComponentProps {
  kind: PrivateAccessKind;
  parentId: ObjectID;
}

const getProtocolByTabName: (
  name: string,
) => StatusPageSingleSignOnProtocol | undefined = (
  name: string,
): StatusPageSingleSignOnProtocol | undefined => {
  if (name === PrivateAccessCopy.samlTabName) {
    return StatusPageSingleSignOnProtocol.SAML;
  }

  if (name === PrivateAccessCopy.oidcTabName) {
    return StatusPageSingleSignOnProtocol.OIDC;
  }

  return undefined;
};

const SingleSignOnSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const requestedProtocol: StatusPageSingleSignOnProtocol =
    readStatusPageSingleSignOnProtocol(
      Navigation.getQueryStringByName(
        STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL_QUERY_PARAM,
      ),
    ) || DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL;

  const tabs: Array<Tab> = [
    {
      name: PrivateAccessCopy.samlTabName,
      // Keyed: the panel draws one tab at a time in the same place.
      children: (
        <SamlProvidersTable
          key={StatusPageSingleSignOnProtocol.SAML}
          kind={props.kind}
          parentId={props.parentId}
        />
      ),
    },
    {
      name: PrivateAccessCopy.oidcTabName,
      children: (
        <OidcProvidersTable
          key={StatusPageSingleSignOnProtocol.OIDC}
          kind={props.kind}
          parentId={props.parentId}
        />
      ),
    },
  ];

  return (
    <Fragment>
      <div data-testid={SINGLE_SIGN_ON_TABS_TEST_ID}>
        <Tabs
          label="SSO"
          tabs={tabs}
          initialTabName={
            requestedProtocol === StatusPageSingleSignOnProtocol.OIDC
              ? PrivateAccessCopy.oidcTabName
              : PrivateAccessCopy.samlTabName
          }
          onTabChange={(tab: Tab): void => {
            const protocol: StatusPageSingleSignOnProtocol | undefined =
              getProtocolByTabName(tab.name);

            if (!protocol) {
              return;
            }

            // The first tab is the bare address.
            Navigation.setQueryString({
              [STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL_QUERY_PARAM]:
                protocol === DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL
                  ? null
                  : protocol,
            });
          }}
        />
      </div>

      {/*
       * "Require SSO to Sign In": one switch that saves when flipped, and
       * asks first before it turns off signing in with a password.
       */}
      <RequireSsoCard kind={props.kind} parentId={props.parentId} />
    </Fragment>
  );
};

// Below the plan: the providers a trial left, to turn off or delete.
const SingleSignOnLeftovers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const nameColumn: string = "Name";

  return (
    <>
      <PlanLeftoverTable<SamlProviderModel>
        modelType={props.kind.samlModel}
        id={`${props.kind.samlTable.tableId}-leftover`}
        query={
          {
            projectId: ProjectUtil.getCurrentProjectId()!,
            [props.kind.parentColumn]: props.parentId.toString(),
          } as Query<SamlProviderModel>
        }
        requiredPlan={SSO_REQUIRED_PLAN}
        title={PlanLeftoverTitle.samlProviders}
        columns={[
          {
            field: { name: true },
            title: nameColumn,
            type: FieldType.Text,
          },
        ]}
      />
      <PlanLeftoverTable<OidcProviderModel>
        modelType={props.kind.oidcModel}
        id={`${props.kind.oidcTable.tableId}-leftover`}
        query={
          {
            projectId: ProjectUtil.getCurrentProjectId()!,
            [props.kind.parentColumn]: props.parentId.toString(),
          } as Query<OidcProviderModel>
        }
        requiredPlan={SSO_REQUIRED_PLAN}
        title={PlanLeftoverTitle.oidcProviders}
        columns={[
          {
            field: { name: true },
            title: nameColumn,
            type: FieldType.Text,
          },
        ]}
      />
    </>
  );
};

const SingleSignOnProviders: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <PlanGatedPage
      requiredPlan={SSO_REQUIRED_PLAN}
      upsell={{
        title: PrivateAccessCopy.singleSignOn,
        description: props.kind.copy.samlDescription,
        featureName: PrivateAccessCopy.singleSignOn,
        featureDescription: props.kind.copy.samlDescription,
        benefits: [
          {
            icon: IconProp.Lock,
            title: PrivateAccessCopy.requireSsoSwitchTitle,
            subtitle: PrivateAccessCopy.requireSsoOnDescription,
          },
          {
            icon: IconProp.ShieldCheck,
            title: PrivateAccessCopy.samlCardTitle,
            subtitle: props.kind.copy.samlDescription,
          },
          {
            icon: IconProp.User,
            title: PrivateAccessCopy.oidcCardTitle,
            subtitle: props.kind.copy.oidcDescription,
          },
        ],
      }}
      belowPlan={<SingleSignOnLeftovers {...props} />}
    >
      <SingleSignOnSettings {...props} />
    </PlanGatedPage>
  );
};

export default SingleSignOnProviders;
