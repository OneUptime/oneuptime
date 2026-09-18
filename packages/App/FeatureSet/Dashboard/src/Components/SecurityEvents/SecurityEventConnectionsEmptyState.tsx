import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import EmptyStateGuideLinks, {
  EmptyStateGuideLink,
} from "Common/UI/Components/EmptyState/EmptyStateGuideLinks";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import { connectorDocsUrl } from "./SecurityEventConnectionDiagnosticsUtil";

export const SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID: string =
  "security-event-connections-empty-state";

export interface ComponentProps {
  canCreate: boolean;
  // Why Add connection is disabled, shown as its tooltip.
  createDisabledReason?: string | undefined;
  onAddConnection: () => void;
}

export interface SecurityEventConnectionRequirement {
  id: string;
  icon: IconProp;
  title: string;
  description: string;
}

/*
 * What a connection needs before its first poll can import anything. Both
 * are things the customer has to arrange outside this page, so they are
 * stated up front rather than discovered from a failed test.
 */
export const SECURITY_EVENT_CONNECTION_REQUIREMENTS: Array<SecurityEventConnectionRequirement> =
  [
    {
      id: "credential",
      icon: IconProp.Key,
      title: "A read-only credential",
      description:
        "A service principal, API client or API token with permission to list the product's alerts, findings or log events.",
    },
    {
      id: "worker",
      icon: IconProp.ServerStack,
      title: "A running OneUptime worker",
      description:
        "Polls every connection on its schedule. Test connection checks access and worker health before you save.",
    },
  ];

/*
 * One setup guide per provider, in catalog order: the catalog is the list
 * the Add connection form offers, so the guides can never name a provider
 * the form does not have, or miss one it does.
 */
export function securityEventConnectorGuideLinks(
  catalog: Array<SecurityEventConnectorDefinition> = SecurityEventConnectorCatalog,
): Array<EmptyStateGuideLink> {
  return catalog.map(
    (definition: SecurityEventConnectorDefinition): EmptyStateGuideLink => {
      return {
        id: definition.provider,
        title: definition.title,
        subtitle: definition.category,
        icon: definition.icon,
        to: connectorDocsUrl(definition),
        openInNewTab: true,
      };
    },
  );
}

/*
 * The Security Event Connections table with nothing in it: what a
 * connection is, the action that creates one, what it needs, and a setup
 * guide for every provider.
 */
const SecurityEventConnectionsEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <EmptyState
      id={SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}
      icon={IconProp.Link}
      paddingClassName="py-4"
      title="No security event connections yet"
      description="Connect a SIEM, EDR / XDR, cloud security or identity product and OneUptime polls it on a schedule, importing each new alert, finding or log event as an OCSF security event."
      footer={
        <div className="flex w-full flex-col items-center gap-8">
          <Button
            title="Add connection"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.PRIMARY}
            // The variant's md:ml-3 would pull it off the centre line.
            className="md:!ml-0"
            disabled={!props.canCreate}
            tooltip={props.canCreate ? undefined : props.createDisabledReason}
            dataTestId={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-add-connection`}
            onClick={props.onAddConnection}
          />

          <div
            id={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirements`}
            className="w-full max-w-5xl rounded-lg bg-gray-50 px-4 py-3 text-left ring-1 ring-inset ring-gray-200"
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {translateString("Before you connect")}
            </h4>
            <ul role="list" className="mt-2 grid gap-3 md:grid-cols-2">
              {SECURITY_EVENT_CONNECTION_REQUIREMENTS.map(
                (
                  requirement: SecurityEventConnectionRequirement,
                ): ReactElement => {
                  return (
                    <li
                      key={requirement.id}
                      data-testid={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirement-${requirement.id}`}
                      className="flex gap-3"
                    >
                      <div aria-hidden="true" className="mt-0.5 shrink-0">
                        <Icon
                          icon={requirement.icon}
                          className="h-5 w-5 text-gray-400"
                        />
                      </div>
                      <div className="min-w-0 text-sm leading-6">
                        <div className="font-medium text-gray-900">
                          {translateString(requirement.title)}
                        </div>
                        <div className="text-gray-500">
                          {translateString(requirement.description)}
                        </div>
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          </div>

          <EmptyStateGuideLinks
            id={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-guides`}
            heading="Setup guides"
            links={securityEventConnectorGuideLinks()}
          />
        </div>
      }
    />
  );
};

export default SecurityEventConnectionsEmptyState;
