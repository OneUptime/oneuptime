import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { Blue, Green, Red, Yellow } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Pill from "Common/UI/Components/Pill/Pill";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE } from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const TelemetryIngestionKeyView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refresher, setRefresher] = React.useState<boolean>(false);

  return (
    <Fragment>
      {/* Telemetry Ingestion Key View  */}
      <CardModelDetail<TelemetryIngestionKey>
        name="Telemetry Ingestion Key Details"
        cardProps={{
          title: "Telemetry Ingestion Key Details",
          description:
            "Here are more details for this Telemetry Ingestion Key.",
        }}
        refresher={refresher}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Telemetry Ingestion Key Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Telemetry Ingestion Key Description",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Turn this off to stop accepting telemetry written with this key straight away, without deleting it. This is the fastest response to a key you think is being abused, and it is reversible - if the key leaked rather than just misbehaved, rotate it below as well.",
          },
          {
            field: {
              expiresAt: true,
            },
            title: "Expires At",
            fieldType: FormFieldSchemaType.Date,
            required: false,
            description:
              "After this date the key stops being accepted. Leave it empty for a key that never expires. An expiry bounds how long a copy of a published browser key stays useful to whoever took it.",
            validation: {
              dateShouldBeInTheFuture: true,
            },
          },
          {
            /*
             * Shown for both key types rather than only for Browser keys.
             * The edit form fetches exactly the fields listed here, so a
             * showIf on keyType would be reading a value the form never
             * loaded - and a field that vanishes for the one key type that
             * REQUIRES it is the worst possible failure mode. The
             * description carries the distinction instead.
             */
            field: {
              allowedOrigins: true,
            },
            title: "Allowed Origins",
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            placeholder: '["https://app.example.com"]',
            description:
              'JSON array of the origins this key may be used from. Required on a browser key and enforced on the server for every request: telemetry from an origin that is not listed, or with no Origin header at all, is refused. Include the scheme and the port. One leading "*." host wildcard is allowed - "https://*.example.com" matches "https://app.example.com" but not "https://example.com". Ignored on a server key.',
          },
          {
            field: {
              pinnedServiceName: true,
            },
            title: "Pinned Service Name",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "storefront-web",
            description:
              "Forces service.name to this value on everything the key writes, replacing whatever the sender set. Anyone who copies the key out of your page can then only write into this one service, instead of forging telemetry that looks like it came from one of your backend services.",
          },
          {
            field: {
              requestsPerMinuteLimit: true,
            },
            title: "Requests Per Minute Limit",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE.toString(),
            description: `Ingest requests per minute accepted with this key. The limit is per key and shared by every client using it, so it has to clear your whole fleet at peak, not one browser tab. Leave it empty to use the default for a browser key (${DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE} per minute) and to leave a server key unlimited.`,
            validation: {
              minValue: 1,
            },
          },
        ]}
        modelDetailProps={{
          modelType: TelemetryIngestionKey,
          id: "model-detail-api-key",
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
            },
            {
              field: {
                keyType: true,
              },
              title: "Key Type",
              fieldType: FieldType.Element,
              /*
               * Read-only on purpose: the type is what every ingest guard
               * keys off, and changing it under a credential that is already
               * deployed would silently change what that credential may do.
               * The model refuses the write; this only avoids offering it.
               */
              getElement: (item: TelemetryIngestionKey): ReactElement => {
                if (item.keyType === TelemetryIngestionKeyType.Browser) {
                  return (
                    <div>
                      <Pill color={Yellow} text="Browser" />
                      <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                        Safe to publish in a page. Accepted only from the
                        allowed origins below, and only for trace, log, metric
                        and session replay ingest.
                      </p>
                    </div>
                  );
                }

                return (
                  <div>
                    <Pill color={Blue} text="Server" />
                    <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                      A secret. Full ingest access with no origin check — keep
                      it on your servers and collectors, and never ship it to a
                      browser.
                    </p>
                  </div>
                );
              },
            },
            {
              field: {
                secretKey: true,
              },
              title: "Secret Key",
              fieldType: FieldType.HiddenText,
              opts: {
                isCopyable: true,
              },
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Status",
              fieldType: FieldType.Element,
              getElement: (item: TelemetryIngestionKey): ReactElement => {
                return item.isEnabled === false ? (
                  <Pill color={Red} text="Disabled — telemetry refused" />
                ) : (
                  <Pill color={Green} text="Enabled" />
                );
              },
            },
            {
              field: {
                allowedOrigins: true,
              },
              title: "Allowed Origins",
              fieldType: FieldType.Element,
              getElement: (item: TelemetryIngestionKey): ReactElement => {
                const origins: Array<string> = item.allowedOrigins ?? [];

                /*
                 * The MEANING OF EMPTY IS INVERTED compared to
                 * RumApplication.sessionReplayAllowedOrigins, which this
                 * renderer is otherwise modelled on: there an empty list
                 * accepts any origin, here it accepts none. A browser key is
                 * only safe to publish because the allowlist exists, so an
                 * empty one fails closed at ingest - and a blank cell would
                 * read as "no restriction", which is the exact opposite of
                 * what is happening to this customer's telemetry.
                 */
                if (origins.length === 0) {
                  return item.keyType === TelemetryIngestionKeyType.Browser ? (
                    <span className="text-sm text-red-600">
                      No origins listed — this browser key is refused on every
                      request until at least one origin is added.
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">
                      Not used — a server key is never origin checked.
                    </span>
                  );
                }

                return (
                  <div className="flex flex-wrap gap-1.5">
                    {origins.map((origin: string): ReactElement => {
                      return (
                        <span
                          key={origin}
                          className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-mono text-gray-800"
                        >
                          {origin}
                        </span>
                      );
                    })}
                  </div>
                );
              },
            },
            {
              field: {
                pinnedServiceName: true,
              },
              title: "Pinned Service Name",
              fieldType: FieldType.Text,
              placeholder: "Not pinned — senders choose their own service.name",
            },
            {
              field: {
                requestsPerMinuteLimit: true,
              },
              title: "Requests Per Minute Limit",
              fieldType: FieldType.Element,
              /*
               * Rendered rather than printed because an empty column means
               * two opposite things: unlimited on a server key, and the
               * shipped browser default on a browser key. "-" would leave the
               * reader to guess which, and guessing wrong in the browser
               * direction means believing a public key has no ceiling.
               */
              getElement: (item: TelemetryIngestionKey): ReactElement => {
                if (item.requestsPerMinuteLimit) {
                  return (
                    <span className="text-sm text-gray-900 tabular-nums">
                      {item.requestsPerMinuteLimit} requests per minute
                    </span>
                  );
                }

                return item.keyType === TelemetryIngestionKeyType.Browser ? (
                  <span className="text-sm text-gray-700">
                    {DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE} requests per
                    minute (default for a browser key)
                  </span>
                ) : (
                  <span className="text-sm text-gray-700">No limit</span>
                );
              },
            },
            {
              field: {
                expiresAt: true,
              },
              title: "Expires At",
              fieldType: FieldType.DateTime,
              placeholder: "Never expires",
            },
            {
              field: {
                lastUsedAt: true,
              },
              title: "Last Used At",
              fieldType: FieldType.DateTime,
              /*
               * Read-only: written by the ingest path. A value anyone could
               * type would be worthless for the one question it answers -
               * "is anything still sending with this key?"
               */
              placeholder: "Never",
            },
          ],
          modelId: modelId,
        }}
      />

      <ResetObjectID<TelemetryIngestionKey>
        modelType={TelemetryIngestionKey}
        fieldName={"secretKey"}
        title={"Reset Secret Key"}
        description={"Reset the Secret Key to a new value."}
        modelId={modelId}
        onUpdateComplete={() => {
          setRefresher(!refresher);
        }}
      />

      {/* Delete Telemetry Ingestion Key */}

      <ModelDelete
        modelType={TelemetryIngestionKey}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TelemetryIngestionKeyView;
