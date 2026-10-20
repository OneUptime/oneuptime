import IconProp from "../../Icon/IconProp";
import {
  ConnectorField,
  ConnectorFieldOption,
} from "../Connectors/SecurityEventConnectorCatalog";
import { GOOGLE_SECOPS_SUPPORTED_REGIONS } from "../GoogleSecOpsRegion";
import SecurityEventDestinationProvider from "./SecurityEventDestinationProvider";

/*
 * Everything the product needs to know about a SIEM it sends to that is not
 * code: what to call it, what the form asks for (and which of it is a
 * secret), where its setup guide is, and what the SIEM calls one event.
 * Shared by the dashboard (the form, the table), the server (validation on
 * save) and the docs tests (the setup guide names every field).
 *
 * Fields use the connector catalog's shape, so a SIEM that can both be
 * read from and sent to asks for its settings the same way in both forms.
 */
export interface SecurityEventDestinationDefinition {
  provider: SecurityEventDestinationProvider;
  title: string;
  description: string;
  // The product's mark in the picker and the table.
  icon: IconProp;
  // The setup guide, a docs page and the heading on it.
  docsPath: string;
  configFields: Array<ConnectorField>;
  secretFields: Array<ConnectorField>;
  // What the SIEM calls one event it receives, as its own docs say it.
  sentRecordName: string;
  /*
   * The events OneUptime imported FROM this product, by the product name
   * the inbound connector stamps on them. They are never sent back: a SIEM
   * that receives its own alerts again would raise them again.
   */
  importedProductNames: Array<string>;
  // The most events, and bytes, one request carries.
  maxEventsPerRequest: number;
  maxBytesPerRequest: number;
}

export const GOOGLE_SECOPS_DESTINATION_DOCS_PATH: string =
  "/docs/integrations/google-secops#send-security-events-to-google-secops";

export const SecurityEventDestinationCatalog: Array<SecurityEventDestinationDefinition> =
  [
    {
      provider: SecurityEventDestinationProvider.GoogleSecOps,
      title: "Google SecOps",
      description:
        "Send OneUptime's detections, or all its security events, to Google SecOps (Chronicle) as UDM events.",
      icon: IconProp.ViewfinderCircle,
      docsPath: GOOGLE_SECOPS_DESTINATION_DOCS_PATH,
      sentRecordName: "UDM event",
      // What the Google SecOps connector stamps on the alerts it imports.
      importedProductNames: ["Google SecOps"],
      /*
       * Chronicle's events:import takes a batch of UDM events per call; a
       * hundred small events stay far below its request size limit, and the
       * byte cap keeps a batch of large ones under it too.
       */
      maxEventsPerRequest: 100,
      maxBytesPerRequest: 900 * 1024,
      configFields: [
        {
          key: "region",
          title: "Region",
          description:
            "The Google SecOps regional endpoint that matches the location in your instance resource name.",
          type: "dropdown",
          required: true,
          placeholder: "Select a region",
          options: GOOGLE_SECOPS_SUPPORTED_REGIONS.map(
            (region: string): ConnectorFieldOption => {
              return { label: region, value: region };
            },
          ),
        },
        {
          key: "instanceResourceName",
          title: "Instance resource name",
          description:
            "The Chronicle instance resource name, from your SecOps SIEM Settings > Profile.",
          type: "text",
          required: true,
          placeholder:
            "projects/{project}/locations/{location}/instances/{instance}",
        },
      ],
      secretFields: [
        {
          key: "serviceAccountJson",
          title: "Service account JSON",
          description:
            "A Google Cloud service-account key (JSON) with a role that can import events (chronicle.events.import), such as Chronicle API Editor. Encrypted at rest and never returned by the API.",
          type: "json",
          required: true,
          placeholder: '{ "client_email": "...", "private_key": "..." }',
        },
      ],
    },
  ];

export function getSecurityEventDestinationDefinition(
  provider: string | undefined,
): SecurityEventDestinationDefinition | undefined {
  return SecurityEventDestinationCatalog.find(
    (definition: SecurityEventDestinationDefinition): boolean => {
      return definition.provider === provider;
    },
  );
}

export function getSecurityEventDestinationTitle(
  provider: string | undefined,
): string {
  return (
    getSecurityEventDestinationDefinition(provider)?.title || provider || ""
  );
}
