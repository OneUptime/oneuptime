import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Whether OneUptime tells the people who sign in apart, on the Health landing
 * page of every edition.
 *
 * OneUptime counts a visitor by the address its ingress accepted the
 * connection from. GET /admin/health/visitor-addresses lists the private
 * network addresses several people signed in from in the last 30 days
 * (Common/Server/Utils/InstanceHealth/SharedVisitorAddresses): there
 * OneUptime counts them as one visitor, so one person's failed sign-ins can
 * lock the others out. Only the operator can change what hands OneUptime
 * those addresses, so this card says what to set - and shows nothing at all
 * while there is nothing to say.
 */

export interface SharedVisitorAddressRow {
  address: string;
  people: number;
}

export interface VisitorAddressesSummaryData {
  addresses: Array<SharedVisitorAddressRow>;
  // Every such address, the listed ones included.
  addressCount: number;
}

export const VISITOR_ADDRESSES_API_ROUTE: string =
  "/admin/health/visitor-addresses";

// Where each guide says what to set.
export const VISITOR_ADDRESSES_COMPOSE_GUIDE: string =
  "/docs/installation/docker-compose#visitor-addresses";
export const VISITOR_ADDRESSES_KUBERNETES_GUIDE: string =
  "https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#visitor-addresses";

/*
 * The card's own words. The description names the 30 days the server looks
 * back (SHARED_VISITOR_ADDRESS_WINDOW_DAYS).
 */
export const VISITOR_ADDRESSES_COPY: {
  title: string;
  description: string;
  cause: string;
  compose: string;
  kubernetes: string;
  nothingToChange: string;
  people: { one: string; other: string };
  more: { one: string; other: string };
  composeGuide: string;
  kubernetesGuide: string;
} = {
  title: "Visitors share an address",
  description:
    "Several people signed in from one private network address in the last 30 days. OneUptime counts them as one visitor, so one person's failed sign-ins can lock the others out.",
  cause:
    "Usually something in front of OneUptime hands it every visitor from an address of its own:",
  compose:
    "Docker Compose: turn IPv6 on for OneUptime's network in {{file}} when people come over IPv6, and set {{hops}} behind a proxy of your own on the server.",
  kubernetes: "Kubernetes: set {{setting}} in the Helm chart's values.",
  nothingToChange:
    "Nothing needs to change if these people share one computer or one VPN.",
  people: { one: "{{count}} person", other: "{{count}} people" },
  // The folded lists' own words, which every locale has.
  more: { one: "{{count}} more", other: "{{count}} more" },
  composeGuide: "Docker Compose guide",
  kubernetesGuide: "Kubernetes guide",
};

const toCount: (value: unknown) => number = (value: unknown): number => {
  const count: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

/*
 * The API's answer, reduced to what the card shows: the shared addresses, or
 * null when there is nothing to say - nothing checked, nothing shared, or an
 * answer that is not one.
 */
export const summarizeVisitorAddresses: (
  data: JSONObject | null | undefined,
) => VisitorAddressesSummaryData | null = (
  data: JSONObject | null | undefined,
): VisitorAddressesSummaryData | null => {
  if (!data || data["checked"] !== true) {
    return null;
  }

  const rows: JSONArray = Array.isArray(data["addresses"])
    ? (data["addresses"] as JSONArray)
    : [];

  const addresses: Array<SharedVisitorAddressRow> = [];

  for (const value of rows) {
    const row: JSONObject = (value || {}) as JSONObject;
    const address: string =
      typeof row["address"] === "string" ? row["address"].trim() : "";
    const people: number = toCount(row["people"]);

    if (address && people > 0) {
      addresses.push({ address, people });
    }
  }

  if (addresses.length === 0) {
    return null;
  }

  return {
    addresses,
    addressCount: Math.max(toCount(data["addressCount"]), addresses.length),
  };
};

const Setting: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  return (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
      {props.text}
    </code>
  );
};

const VisitorAddressesSummary: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [data, setData] = useState<JSONObject | null>(null);

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              VISITOR_ADDRESSES_API_ROUTE,
            ),
          });

        if (response instanceof HTTPErrorResponse) {
          return;
        }

        setData(response.data);
      } catch {
        // Nothing to say: the rest of the Health page shows what is down.
      }
    };

    load().catch(() => {
      // handled above
    });
  }, []);

  const summary: VisitorAddressesSummaryData | null =
    summarizeVisitorAddresses(data);

  if (!summary) {
    return <></>;
  }

  const unlisted: number = summary.addressCount - summary.addresses.length;

  return (
    <Card
      title={VISITOR_ADDRESSES_COPY.title}
      description={VISITOR_ADDRESSES_COPY.description}
      buttons={[
        {
          title: VISITOR_ADDRESSES_COPY.composeGuide,
          icon: IconProp.Book,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: () => {
            window.open(VISITOR_ADDRESSES_COMPOSE_GUIDE, "_blank");
          },
        },
        {
          title: VISITOR_ADDRESSES_COPY.kubernetesGuide,
          icon: IconProp.Book,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: () => {
            window.open(VISITOR_ADDRESSES_KUBERNETES_GUIDE, "_blank");
          },
        },
      ]}
    >
      <div className="space-y-4" data-testid="visitor-addresses">
        <ul
          className="divide-y divide-gray-100 rounded-md border border-gray-200"
          data-testid="visitor-addresses-list"
        >
          {summary.addresses.map(
            (row: SharedVisitorAddressRow): ReactElement => {
              return (
                <li
                  key={row.address}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span
                    className="min-w-0 truncate font-mono text-sm text-gray-900"
                    title={row.address}
                  >
                    {row.address}
                  </span>
                  <span className="shrink-0 text-sm text-gray-600">
                    {translator.translatePlural(
                      VISITOR_ADDRESSES_COPY.people,
                      row.people,
                    )}
                  </span>
                </li>
              );
            },
          )}
          {unlisted > 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">
              {translator.translatePlural(
                VISITOR_ADDRESSES_COPY.more,
                unlisted,
              )}
            </li>
          ) : (
            <></>
          )}
        </ul>

        <div className="space-y-2 text-sm text-gray-600">
          <p>{translator.translateText(VISITOR_ADDRESSES_COPY.cause)}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <TranslatedSentence
                template={VISITOR_ADDRESSES_COPY.compose}
                slots={{
                  file: <Setting text="docker-compose.override.yml" />,
                  hops: <Setting text="TRUSTED_PROXY_HOPS=2" />,
                }}
              />
            </li>
            <li>
              <TranslatedSentence
                template={VISITOR_ADDRESSES_COPY.kubernetes}
                slots={{
                  setting: (
                    <Setting text="nginx.service.externalTrafficPolicy: Local" />
                  ),
                }}
              />
            </li>
          </ul>
          <p>
            {translator.translateText(VISITOR_ADDRESSES_COPY.nothingToChange)}
          </p>
        </div>
      </div>
    </Card>
  );
};

export default VisitorAddressesSummary;
