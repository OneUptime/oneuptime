import PageComponentProps from "../../PageComponentProps";
import StatusPageSamlProviders from "./SSO";
import StatusPageOidcProviders from "./OIDC";
import StatusPagePrivateOnlySettings from "../../../Components/StatusPage/StatusPagePrivateOnlySettings";
import { StatusPagePrivateOnlyPage } from "../../../Components/StatusPage/StatusPagePrivateOnlyCopy";
import useStatusPageAccess, {
  StatusPageAccessRead,
} from "../../../Components/StatusPage/useStatusPageAccess";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSingleSignOnProtocol, {
  DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL,
  STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL_QUERY_PARAM,
  readStatusPageSingleSignOnProtocol,
} from "Common/Types/StatusPage/StatusPageSingleSignOnProtocol";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Status page > Security > Single Sign-On: the page's sign-on providers, a
 * tab per protocol - SAML, then OIDC.
 *
 * They were two menu entries until #9130, "SSO" and "OIDC", with the same
 * lock icon: one kind of record on two pages, and "SSO" named one of them
 * while both are single sign-on. One kind of record is one page
 * (Docs/ux/README.md#side-menus). The SAML tab keeps the old SSO page's
 * address, and the old OIDC address forwards to its tab
 * (Routes/StatusPagesRoutes, Common's StatusPageSingleSignOnProtocol).
 *
 * The open tab is in the address (`?protocol=oidc`), written in place
 * without a history entry, as the Subscribers tabs do. Each tab is the page
 * it was, with its plan upsell where the plan does not include it.
 *
 * Neither protocol does anything while the status page is public, so the
 * page says so and folds the providers under the notice
 * (StatusPagePrivateOnlySettings).
 */
export const STATUS_PAGE_SINGLE_SIGN_ON_TABS_TEST_ID: string =
  "status-page-single-sign-on-tabs";

// The tabs' names, as the tab row draws them (looked up in every language).
export const STATUS_PAGE_SINGLE_SIGN_ON_TAB_NAMES: Record<
  StatusPageSingleSignOnProtocol,
  string
> = {
  [StatusPageSingleSignOnProtocol.SAML]: translationKey("SAML"),
  [StatusPageSingleSignOnProtocol.OIDC]: translationKey("OIDC"),
};

const getProtocolByTabName: (
  name: string,
) => StatusPageSingleSignOnProtocol | undefined = (
  name: string,
): StatusPageSingleSignOnProtocol | undefined => {
  return (
    Object.keys(
      STATUS_PAGE_SINGLE_SIGN_ON_TAB_NAMES,
    ) as Array<StatusPageSingleSignOnProtocol>
  ).find((protocol: StatusPageSingleSignOnProtocol): boolean => {
    return STATUS_PAGE_SINGLE_SIGN_ON_TAB_NAMES[protocol] === name;
  });
};

const StatusPageSingleSignOn: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const statusPageId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const accessRead: StatusPageAccessRead = useStatusPageAccess(statusPageId);

  const requestedProtocol: StatusPageSingleSignOnProtocol =
    readStatusPageSingleSignOnProtocol(
      Navigation.getQueryStringByName(
        STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL_QUERY_PARAM,
      ),
    ) || DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL;

  const tabs: Array<Tab> = [
    {
      name: STATUS_PAGE_SINGLE_SIGN_ON_TAB_NAMES[
        StatusPageSingleSignOnProtocol.SAML
      ],
      // Keyed: the panel draws one tab at a time in the same place.
      children: (
        <StatusPageSamlProviders
          key={StatusPageSingleSignOnProtocol.SAML}
          {...props}
        />
      ),
    },
    {
      name: STATUS_PAGE_SINGLE_SIGN_ON_TAB_NAMES[
        StatusPageSingleSignOnProtocol.OIDC
      ],
      children: (
        <StatusPageOidcProviders
          key={StatusPageSingleSignOnProtocol.OIDC}
          {...props}
        />
      ),
    },
  ];

  return (
    <StatusPagePrivateOnlySettings
      statusPageId={statusPageId}
      access={accessRead.access}
      page={StatusPagePrivateOnlyPage.SingleSignOn}
    >
      <div data-testid={STATUS_PAGE_SINGLE_SIGN_ON_TABS_TEST_ID}>
        <Tabs
          tabs={tabs}
          initialTabName={
            STATUS_PAGE_SINGLE_SIGN_ON_TAB_NAMES[requestedProtocol]
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
    </StatusPagePrivateOnlySettings>
  );
};

export default StatusPageSingleSignOn;
