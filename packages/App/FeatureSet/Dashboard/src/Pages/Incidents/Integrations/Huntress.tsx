import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  HUNTRESS_CONNECTION_STATE_COLORS,
  HUNTRESS_CONNECTION_STATE_LABELS,
  HuntressConnectionState,
  getHuntressConnectionState,
} from "../../../Components/Huntress/HuntressConnectionDisplay";
import {
  HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES,
  getHuntressConnectionFormFields,
} from "./HuntressConnectionFormFields";
import HuntressConnection from "Common/Models/DatabaseModels/HuntressConnection";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Incidents > Integrations > Huntress: the project's Huntress connections.
 *
 * Huntress's SOC sends an incident report when it confirms malicious
 * activity on an endpoint or an identity. A connection receives those
 * reports as signed webhooks: each opens one incident here, at the severity
 * the connection gives it, paging on-call when it is severe enough, and
 * closing the report in Huntress resolves the incident. Connecting asks who
 * is paged and for what; the new connection opens on its own page, which
 * walks the setup in Huntress.
 */
const HuntressConnectionsPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<HuntressConnection>
      modelType={HuntressConnection}
      id="huntress-connections-table"
      name="Incidents > Integrations > Huntress"
      userPreferencesKey="huntress-connections-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      createVerb="Connect"
      singularName="Huntress"
      cardProps={{
        title: "Huntress",
        description:
          "Huntress incident reports open incidents here and page your on-call team. Closing a report in Huntress resolves its incident.",
      }}
      documentationLink={new Route("/docs/integrations/huntress")}
      emptyState={{
        title: "Page on-call for Huntress incident reports",
      }}
      viewButtonText="View Connection"
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      createInitialValues={HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES}
      formFields={getHuntressConnectionFormFields()}
      viewPageRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS] as Route,
      )}
      onCreateSuccess={async (
        item: HuntressConnection,
      ): Promise<HuntressConnection> => {
        // Straight to its setup: the URL Huntress asks for is there.
        if (item.id) {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_INTEGRATIONS_HUNTRESS_VIEW] as Route,
              { modelId: item.id },
            ),
          );
        }

        return item;
      }}
      selectMoreFields={{
        isSigningSecretSet: true,
        lastEventReceivedAt: true,
        lastError: true,
        lastErrorAt: true,
      }}
      filters={[]}
      columns={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Text,
          isNotCustomizable: true,
        },
        {
          field: {
            lastEventReceivedAt: true,
          },
          id: "state",
          title: "State",
          type: FieldType.Element,
          disableSort: true,
          getExportValue: (item: HuntressConnection): string => {
            return translator.translateText(
              HUNTRESS_CONNECTION_STATE_LABELS[
                getHuntressConnectionState(item)
              ],
            ) as string;
          },
          getElement: (item: HuntressConnection): ReactElement => {
            const state: HuntressConnectionState =
              getHuntressConnectionState(item);

            return (
              <span
                data-testid="huntress-connection-row-state"
                data-state={state}
              >
                <Pill
                  text={HUNTRESS_CONNECTION_STATE_LABELS[state]}
                  color={HUNTRESS_CONNECTION_STATE_COLORS[state]}
                />
              </span>
            );
          },
        },
        {
          field: {
            onCallDutyPolicies: {
              name: true,
            },
          },
          title: "Pages",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getExportValue: (item: HuntressConnection): string => {
            return (item.onCallDutyPolicies || [])
              .map((policy: OnCallDutyPolicy): string => {
                return policy.name || "";
              })
              .join(", ");
          },
          getElement: (item: HuntressConnection): ReactElement => {
            const names: Array<string> = (item.onCallDutyPolicies || [])
              .map((policy: OnCallDutyPolicy): string => {
                return policy.name || "";
              })
              .filter((name: string): boolean => {
                return Boolean(name);
              });

            if (names.length === 0) {
              return (
                <span className="text-sm text-gray-500">
                  {translator.translateText("Nobody")}
                </span>
              );
            }

            return (
              <span className="text-sm text-gray-900">{names.join(", ")}</span>
            );
          },
        },
        {
          field: {
            lastEventReceivedAt: true,
          },
          title: "Last Event",
          type: FieldType.DateTime,
          noValueMessage: "Never",
          hideOnMobile: true,
        },
      ]}
    />
  );
};

export default HuntressConnectionsPage;
