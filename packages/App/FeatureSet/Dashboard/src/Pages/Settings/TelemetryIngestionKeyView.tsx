import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { Blue, Green, Red, Yellow } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import OriginAllowList from "Common/Utils/Telemetry/OriginAllowList";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { TelemetryIngestionBudgetValueKind } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionBudgetStatusCard from "Common/UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetStatusCard";
import { fetchProjectTelemetryIngestionBudgetStatus } from "../../Components/TelemetryIngestionBudget/ProjectTelemetryIngestionBudget";
import IngestionKeyBudgetSummary from "../../Components/TelemetryIngestionBudget/IngestionKeyBudgetSummary";
import IngestionKeyRefusalsCard from "../../Components/Telemetry/IngestionKeyRefusalsCard";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const TelemetryIngestionKeyView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refresher, setRefresher] = React.useState<boolean>(false);
  const [budgetRefresher, setBudgetRefresher] = React.useState<number>(0);

  return (
    <Fragment>
      {/* Telemetry Ingestion Key View  */}
      <CardModelDetail<TelemetryIngestionKey>
        name="Telemetry Ingestion Key Details"
        cardProps={{
          title: "Ingestion Key Details",
          description:
            "Your apps and collectors send this key with their telemetry, so it lands in this project.",
        }}
        refresher={refresher}
        isEditable={true}
        formSteps={[
          { title: "Details", id: "details" },
          { title: "Access & Limits", id: "access-and-limits" },
          { title: "Browser Settings", id: "browser-settings" },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Ingestion Key Name",
            validation: {
              minLength: 2,
            },
            // Not the column's "Any friendly name of this object", written for the API.
            hideColumnDescription: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Ingestion Key Description",
            hideColumnDescription: true,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "access-and-limits",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Accept telemetry sent with this key. Turning it off stops a misused key at once, without deleting it.",
          },
          {
            field: {
              expiresAt: true,
            },
            title: "Expires At",
            stepId: "access-and-limits",
            fieldType: FormFieldSchemaType.Date,
            required: false,
            description:
              "After this date the key stops working. Leave empty for a key that never expires.",
            validation: {
              dateShouldBeInTheFuture: true,
            },
          },
          {
            field: {
              requestsPerMinuteLimit: true,
            },
            title: "Requests Per Minute Limit",
            stepId: "access-and-limits",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE.toString(),
            description: translator.translateTemplate(
              "Requests per minute this key accepts, shared by every client using it. Leave empty for {{limit}} on a browser key, unlimited on a server key.",
              { limit: DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE },
            ),
            validation: {
              minValue: 1,
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
            stepId: "browser-settings",
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            /*
             * The same rules the creation wizard applies. Without them the
             * only thing that said no to `{"origin": "..."}` - or to an
             * origin carrying a path, which quietly matches the whole origin
             * - was the API, in the server's words, after a round trip.
             *
             * An empty list passes here and not in the wizard. Clearing the
             * list is how a server key's leftover entries are dropped, and
             * this form cannot tell the two key types apart: keyType is
             * deliberately not among the fields it loads. Emptying a BROWSER
             * key's list stays refused, by the server, which knows the type
             * and answers with what to do instead ("turn the key off or
             * delete it") - refusing every empty list here would instead
             * leave a server key's leftovers unclearable from this page.
             */
            customValidation: (
              values: FormValues<TelemetryIngestionKey>,
            ): string | null => {
              return OriginAllowList.validateAllowedOriginsFormValue({
                value: values.allowedOrigins,
                allowEmptyList: true,
              });
            },
            placeholder:
              '["https://app.example.com", "app://com.example.mobile"]',
            description:
              "A JSON array of web origins and app:// identities this key may be used from; app entries cannot use wildcards. Required on a Browser key.",
          },
          {
            field: {
              pinnedServiceName: true,
            },
            title: "Pinned Service Name",
            stepId: "browser-settings",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "storefront-web",
            description:
              "Forces service.name to this value on everything the key writes, so a copied key cannot pose as your other services.",
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
                        {translator.translateText(
                          "Safe to publish in a page. Accepted only from the allowed origins below, and only for traces, logs, metrics, session replays and Sentry events.",
                        )}
                      </p>
                    </div>
                  );
                }

                return (
                  <div>
                    <Pill color={Blue} text="Server" />
                    <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                      {translator.translateText(
                        "A secret. Full ingest access with no origin check — keep it on your servers and collectors, and never ship it to a browser.",
                      )}
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
                      {translator.translateText(
                        "No origins listed — this browser key is refused on every request until at least one origin is added.",
                      )}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">
                      {translator.translateText(
                        "Not used — a server key is never origin checked.",
                      )}
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
                      {translator.translatePlural(
                        {
                          one: "{{count}} request per minute",
                          other: "{{count}} requests per minute",
                        },
                        item.requestsPerMinuteLimit,
                      )}
                    </span>
                  );
                }

                return item.keyType === TelemetryIngestionKeyType.Browser ? (
                  <span className="text-sm text-gray-700">
                    {translator.translateTemplate(
                      "{{limit}} requests per minute (default for a browser key)",
                      { limit: DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE },
                    )}
                  </span>
                ) : (
                  <span className="text-sm text-gray-700">
                    {translator.translateText("No limit")}
                  </span>
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

      {/*
       * What the ingest endpoints refused from this key lately, and why
       * (issue #6378): the other half of Last Used At's question.
       */}
      <IngestionKeyRefusalsCard ingestionKeyId={modelId} />

      {/*
       * The key's own ingestion budgets: a daily budget and, folded into a
       * second step, a per-second rate for each signal. They only subdivide
       * the project's - the server refuses one above the project's budget -
       * and an empty one leaves the project's budget as the only limit.
       */}
      <CardModelDetail<TelemetryIngestionKey>
        name="Telemetry Ingestion Key Budgets"
        cardProps={{
          title: "Ingestion Budgets",
          description:
            "The most of each signal this key may send in a budget day, and how fast. A key's budget only subdivides the project's, so it can be no more than the project's own.",
        }}
        refresher={refresher}
        isEditable={true}
        editButtonText="Edit Ingestion Budgets"
        onSaveSuccess={() => {
          setBudgetRefresher(budgetRefresher + 1);
        }}
        formSteps={[
          { title: "Daily Budgets", id: "daily-budgets" },
          { title: "Rate Limits", id: "rate-limits" },
        ]}
        formFields={[
          {
            field: { logsDailyIngestionBudgetInGB: true },
            title: "Logs (GB per day)",
            stepId: "daily-budgets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            description:
              "Leave a signal empty for no budget of the key's own: the project's still applies.",
            placeholder: "No budget of its own",
            validation: { minValue: 0 },
          },
          {
            field: { tracesDailyIngestionBudgetInGB: true },
            title: "Traces (GB per day)",
            stepId: "daily-budgets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            placeholder: "No budget of its own",
            validation: { minValue: 0 },
          },
          {
            field: { metricsDailyIngestionBudgetInGB: true },
            title: "Metrics (GB per day)",
            stepId: "daily-budgets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            placeholder: "No budget of its own",
            validation: { minValue: 0 },
          },
          {
            field: { profilesDailyIngestionBudgetInGB: true },
            title: "Profiles (GB per day)",
            stepId: "daily-budgets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            placeholder: "No budget of its own",
            validation: { minValue: 0 },
          },
          {
            field: { securityEventsDailyIngestionBudgetInGB: true },
            title: "Security Events (GB per day)",
            stepId: "daily-budgets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            placeholder: "No budget of its own",
            validation: { minValue: 0 },
          },
          {
            field: { logsIngestionRateLimitInMBPerSecond: true },
            title: "Logs (MB per second)",
            stepId: "rate-limits",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            description:
              "Optional. Faster requests are answered 429 with Retry-After, and senders retry them.",
            placeholder: "No limit of its own",
            validation: { minValue: 0 },
          },
          {
            field: { tracesIngestionRateLimitInMBPerSecond: true },
            title: "Traces (MB per second)",
            stepId: "rate-limits",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            placeholder: "No limit of its own",
            validation: { minValue: 0 },
          },
          {
            field: { metricsIngestionRateLimitInMBPerSecond: true },
            title: "Metrics (MB per second)",
            stepId: "rate-limits",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            placeholder: "No limit of its own",
            validation: { minValue: 0 },
          },
          {
            field: { profilesIngestionRateLimitInMBPerSecond: true },
            title: "Profiles (MB per second)",
            stepId: "rate-limits",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            placeholder: "No limit of its own",
            validation: { minValue: 0 },
          },
          {
            field: { securityEventsIngestionRateLimitInMBPerSecond: true },
            title: "Security Events (MB per second)",
            stepId: "rate-limits",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            hideColumnDescription: true,
            placeholder: "No limit of its own",
            validation: { minValue: 0 },
          },
        ]}
        modelDetailProps={{
          modelType: TelemetryIngestionKey,
          id: "model-detail-ingestion-key-budgets",
          fields: [
            {
              field: {
                logsDailyIngestionBudgetInGB: true,
                tracesDailyIngestionBudgetInGB: true,
                metricsDailyIngestionBudgetInGB: true,
                profilesDailyIngestionBudgetInGB: true,
                securityEventsDailyIngestionBudgetInGB: true,
              },
              title: "Daily Budgets",
              fieldType: FieldType.Element,
              getElement: (item: TelemetryIngestionKey): ReactElement => {
                return (
                  <IngestionKeyBudgetSummary
                    item={item}
                    kind={TelemetryIngestionBudgetValueKind.DailyBudget}
                  />
                );
              },
            },
            {
              field: {
                logsIngestionRateLimitInMBPerSecond: true,
                tracesIngestionRateLimitInMBPerSecond: true,
                metricsIngestionRateLimitInMBPerSecond: true,
                profilesIngestionRateLimitInMBPerSecond: true,
                securityEventsIngestionRateLimitInMBPerSecond: true,
              },
              title: "Rate Limits",
              fieldType: FieldType.Element,
              getElement: (item: TelemetryIngestionKey): ReactElement => {
                return (
                  <IngestionKeyBudgetSummary
                    item={item}
                    kind={TelemetryIngestionBudgetValueKind.RateLimit}
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/* What the key used of its own budgets today; nothing while it has none. */}
      <TelemetryIngestionBudgetStatusCard
        key={budgetRefresher}
        fetchStatus={fetchProjectTelemetryIngestionBudgetStatus}
        ingestionKeyId={modelId.toString()}
        hideWhenUnbudgeted={true}
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
