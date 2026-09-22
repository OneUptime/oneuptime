import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import SecurityEventProviderTile from "./SecurityEventProviderTile";

export const SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID: string =
  "security-event-connections-empty-state";

export interface ComponentProps {
  canCreate: boolean;
  /*
   * Why Add connection is disabled: its tooltip, and written out under it
   * as well, since a tooltip never shows on a touch screen.
   */
  createDisabledReason?: string | undefined;
  /*
   * Opens the Add connection form. A provider tile passes its provider, so
   * the form opens with that provider already selected.
   */
  onAddConnection: (
    initialProvider?: SecurityEventConnectorProvider | undefined,
  ) => void;
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
 * The Security Event Connections table with nothing in it.
 *
 * It used to be a centred icon and paragraph, a button, a grey requirements
 * box and a grid of eight heavy docs cards, each block a different width
 * and alignment. Now the products are the page: a short header says what a
 * connection does, every product in the catalog is one tile that starts
 * connecting it (and still links its setup guide), and what a connection
 * needs sits underneath.
 *
 * It renders inside the table's ErrorMessage, which centres its content and
 * puts a "Refresh?" link below it, so the header is centred on the same
 * line as that link and only the tiles and requirements are left-aligned.
 */
const SecurityEventConnectionsEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const providersHeadingId: string = `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-providers-heading`;
  const requirementsHeadingId: string = `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirements-heading`;

  return (
    <div
      id={SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}
      className="mx-auto w-full max-w-5xl py-2 text-left sm:px-6"
    >
      <div className="flex flex-col items-center text-center">
        <div
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200"
        >
          <Icon icon={IconProp.Link} className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-gray-900">
          {translateString("No security event connections yet")}
        </h3>
        <p
          data-testid={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-description`}
          className="mt-1.5 max-w-xl text-sm leading-6 text-gray-500"
        >
          {translateString(
            "Connect a SIEM, EDR / XDR, cloud security or identity product and OneUptime polls it on a schedule, importing each new alert, finding or log event as an OCSF security event.",
          )}
        </p>
        <div className="mt-5">
          <Button
            title="Add connection"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.PRIMARY}
            // The variant's md:ml-3 would pull it off the centre line.
            className="md:!ml-0"
            disabled={!props.canCreate}
            tooltip={props.canCreate ? undefined : props.createDisabledReason}
            dataTestId={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-add-connection`}
            onClick={() => {
              props.onAddConnection();
            }}
          />
        </div>
        {!props.canCreate && props.createDisabledReason && (
          <div
            data-testid={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-disabled-reason`}
            className="mt-3 flex max-w-md items-start gap-1.5 text-left text-xs leading-5 text-gray-500"
          >
            <Icon
              icon={IconProp.Lock}
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
            />
            {/* The gate's own sentence, already in the API's wording. */}
            <span className="min-w-0">{props.createDisabledReason}</span>
          </div>
        )}
      </div>

      <section
        id={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-providers`}
        aria-labelledby={providersHeadingId}
        className="mt-10"
      >
        <h4
          id={providersHeadingId}
          className="text-sm font-semibold text-gray-900"
        >
          {translateString(
            props.canCreate
              ? "Pick a product to connect"
              : "Supported products",
          )}
        </h4>
        {/*
         * Viewport columns rather than container ones: the Connections card
         * is the page's full width at every size, and Tailwind here has no
         * container queries. The tile switches from a row to an upright
         * card at the same lg step, see SecurityEventProviderTile.
         */}
        <ul
          role="list"
          aria-labelledby={providersHeadingId}
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {SecurityEventConnectorCatalog.map(
            (definition: SecurityEventConnectorDefinition): ReactElement => {
              return (
                <SecurityEventProviderTile
                  key={definition.provider}
                  idPrefix={SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}
                  definition={definition}
                  canConnect={props.canCreate}
                  onConnect={() => {
                    props.onAddConnection(definition.provider);
                  }}
                />
              );
            },
          )}
        </ul>
      </section>

      <section
        id={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirements`}
        aria-labelledby={requirementsHeadingId}
        className="mt-8 border-t border-gray-100 pt-6"
      >
        <h4
          id={requirementsHeadingId}
          className="text-sm font-semibold text-gray-900"
        >
          {translateString("What you'll need")}
        </h4>
        <ul
          role="list"
          aria-labelledby={requirementsHeadingId}
          className="mt-3 grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2"
        >
          {SECURITY_EVENT_CONNECTION_REQUIREMENTS.map(
            (requirement: SecurityEventConnectionRequirement): ReactElement => {
              return (
                <li
                  key={requirement.id}
                  data-testid={`${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirement-${requirement.id}`}
                  className="flex gap-3"
                >
                  <div
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200"
                  >
                    <Icon icon={requirement.icon} className="h-4 w-4" />
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
      </section>
    </div>
  );
};

export default SecurityEventConnectionsEmptyState;
