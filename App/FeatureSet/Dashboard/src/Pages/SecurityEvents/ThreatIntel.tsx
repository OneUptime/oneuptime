import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import ThreatIntelIndicator from "Common/Models/AnalyticsModels/ThreatIntelIndicator";
import {
  THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
} from "Common/Types/SecurityEvent/ThreatIntelConstants";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const documentationMarkdown: string = `
### How Threat Intel Feeds Work

A feed subscribes one **TAXII 2.1 collection** — public or private. OneUptime polls it on the interval set here, parses **STIX 2.1 indicator** objects into normalized IOCs (IPs, domains, URLs, email addresses, file hashes), and keeps them for as long as each indicator's \`valid_until\` says.

Two things then happen, continuously:

- **Enrichment at ingest** — an incoming security event whose observables match an active indicator is stamped with \`threat.matched\`, \`threat.indicator_id\`, \`threat.feed\` and \`threat.confidence\` attributes. Sigma rules and Security Events monitors can filter on those keys immediately, with no new query language.
- **Matching on a schedule** — every minute, the events ingested since the last evaluation are joined against the feed's active indicators. A match writes a **Detection Finding** back into the event stream (product \`OneUptime Threat Intel\`, \`oneuptime.threat.*\` attributes) and opens a **deduplicated alert** per indicator — the same downstream machinery as Sigma detection rules, including optional incidents and on-call. This lane also catches intel that arrives *after* the events did.

Supported patterns are plain IOC equality — \`[ipv4-addr:value = '...']\`, \`domain-name\`, \`url\`, \`email-addr\`, and \`file:hashes\` (SHA-256, SHA-1, MD5), including OR-lists. Anything more elaborate (AND, temporal qualifiers, regex) is counted in **Last Poll Summary** as unsupported rather than half-translated.

---

### Reading Feed Health

- **Last Polled / Last Error** describe the TAXII side: a recent poll with an empty error is a healthy subscription. Errors carry the failing step and the first part of the server's response, and clear on the next successful poll.
- **Last Poll Summary** says what the poll actually ingested — objects fetched, indicator values stored, unsupported patterns skipped. A large feed syncs across several polls; the summary says when more pages remain.
- **Last Evaluated / Last Match / Last Match Error** describe the matching side, kept separate so a broken TAXII server and a broken match query are distinguishable at a glance.

A disabled feed is neither polled nor matched; its already-ingested indicators stop matching only when they expire.
`;

const ThreatIntelPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Hooks run before the reseller gate below can return early — React
   * requires the same hooks in the same order on every render.
   */
  const [currentlyEditingItem, setCurrentlyEditingItem] =
    useState<ThreatIntelFeed | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  /*
   * Same reseller-telemetry gate as every other Security Events tab —
   * indicators enrich and match telemetry-billed security events, so a
   * plan without telemetry features has nothing for them to act on.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  /*
   * The rotate-credential action writes through ModelAPI directly, which
   * ModelTable's own edit gating never sees — same discipline as the
   * Google SecOps connections page.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new ThreatIntelFeed(),
    ModelAction.Update,
  );

  const monitorCreateGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );

  return (
    <Fragment>
      <ModelTable<ThreatIntelFeed>
        modelType={ThreatIntelFeed}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="threat-intel-feeds-table"
        name="Security Events > Threat Intel Feeds"
        userPreferencesKey="threat-intel-feeds-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Threat Intel Feeds",
          description:
            "STIX/TAXII 2.1 feed subscriptions. Indicators are polled on an interval, enrich incoming events with threat.* attributes, and matches open deduplicated alerts — the same machinery as Sigma detection rules.",
        }}
        helpContent={{
          title: "How Threat Intel Feeds Work",
          description:
            "What a feed polls, how indicators enrich and match events, and how to read feed health",
          markdown: documentationMarkdown,
        }}
        noItemsMessage={
          'No threat intel feeds found. Click on the "Create" button to subscribe a TAXII collection.'
        }
        createInitialValues={{
          /*
           * Mirror the DB defaults (ThreatIntelFeed.ts): without these
           * the severity dropdowns' showIf sees undefined on a fresh
           * create form and hides fields whose toggles are actually on.
           */
          isEnabled: true,
          pollIntervalInMinutes: 60,
          minimumConfidence: 0,
          shouldCreateAlert: true,
          shouldWriteDetectionFinding: true,
          shouldCreateIncident: false,
        }}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "TAXII Server", id: "taxii-server" },
          { title: "Matching", id: "matching" },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. CISA AIS",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "What this feed carries and why it is subscribed.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "basic-info",
            description: "Disabled feeds are neither polled nor matched.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              apiRootUrl: true,
            },
            title: "TAXII API Root URL",
            stepId: "taxii-server",
            description:
              "The TAXII 2.1 API root, e.g. https://taxii.example.com/api1/. Collections are addressed beneath it.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "https://taxii.example.com/api1/",
            disableSpellCheck: true,
          },
          {
            field: {
              collectionId: true,
            },
            title: "Collection ID",
            stepId: "taxii-server",
            description: "ID of the collection to poll for indicator objects.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. 91a7b528-80eb-42ed-a74d-c6fbd5a26116",
            disableSpellCheck: true,
          },
          {
            field: {
              apiToken: true,
            },
            title: "API Token",
            stepId: "taxii-server",
            description:
              "Bearer token for token-authenticated collections. Encrypted at rest and never returned by the API — use the row's Update Credentials action to rotate it later. Leave empty for anonymous or basic-auth collections.",
            fieldType: FormFieldSchemaType.Password,
            required: false,
            /*
             * The column has ColumnAccessControl read: [], so an edit form
             * can never prefill it; showing an empty field on edit would
             * silently blank the stored secret on every unrelated change.
             */
            doNotShowWhenEditing: true,
            placeholder: "Leave empty for anonymous access",
          },
          {
            field: {
              basicAuthUsername: true,
            },
            title: "Basic Auth Username",
            stepId: "taxii-server",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Leave empty for anonymous access",
            disableSpellCheck: true,
          },
          {
            field: {
              basicAuthPassword: true,
            },
            title: "Basic Auth Password",
            stepId: "taxii-server",
            description:
              "Encrypted at rest and never returned by the API — use the row's Update Credentials action to rotate it later.",
            fieldType: FormFieldSchemaType.Password,
            required: false,
            doNotShowWhenEditing: true,
            placeholder: "Leave empty for anonymous access",
          },
          {
            field: {
              pollIntervalInMinutes: true,
            },
            title: "Poll Interval (Minutes)",
            stepId: "taxii-server",
            description:
              "How often the collection is polled for new indicators. Default 60.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "e.g. 60",
            /*
             * Keeps the range identical to the service's own check
             * (ThreatIntelFeedService.validateFeed), so an out-of-range
             * value fails in the form instead of at submit.
             */
            validation: {
              minValue: 1,
              maxValue: 1440,
            },
          },
          {
            field: {
              minimumConfidence: true,
            },
            title: "Minimum Confidence",
            stepId: "matching",
            description:
              "Skip indicators whose STIX confidence is below this (0-100). 0 ingests everything; indicators that carry no confidence always pass.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "0",
            validation: {
              minValue: THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
              maxValue: THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
            },
          },
          {
            field: {
              shouldCreateAlert: true,
            },
            title: "Create Alert on Match",
            stepId: "matching",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              alertSeverity: true,
            },
            title: "Alert Severity",
            stepId: "matching",
            description:
              "Optional. Severity of alerts this feed opens. When unset, the indicator's STIX confidence is mapped onto this project's severities.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Default from indicator confidence",
            showIf: (model: FormValues<ThreatIntelFeed>): boolean => {
              return model.shouldCreateAlert === true;
            },
          },
          {
            field: {
              shouldCreateIncident: true,
            },
            title: "Create Incident on Match",
            stepId: "matching",
            description:
              "Incidents are the heavier machinery — on-call escalation, SLAs, status pages. Off by default; alerts usually suffice for indicator matches.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              incidentSeverity: true,
            },
            title: "Incident Severity",
            stepId: "matching",
            description:
              "Optional. Severity of incidents this feed opens. When unset, the indicator's STIX confidence is mapped onto this project's incident severities.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: IncidentSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Default from indicator confidence",
            showIf: (model: FormValues<ThreatIntelFeed>): boolean => {
              return model.shouldCreateIncident === true;
            },
          },
          {
            field: {
              shouldWriteDetectionFinding: true,
            },
            title: "Write Detection Finding on Match",
            stepId: "matching",
            description:
              "Write a Detection Finding security event back into the event stream when an indicator matches.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        showViewIdButton={true}
        actionButtons={[
          {
            title: "Create Monitor",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.AltGlobe,
            disabled: !monitorCreateGate.isAllowed,
            tooltip: monitorCreateGate.isAllowed
              ? "Create a Security Events monitor watching this feed's Threat Intel findings — alert on rate, not just occurrence."
              : monitorCreateGate.disabledReason ||
                "You do not have permission to create monitors.",
            onClick: (
              item: ThreatIntelFeed,
              onCompleteAction: VoidFunction,
            ) => {
              /*
               * Deep link, not an inline create — the DetectionRules
               * rationale: the monitor create page is where the
               * pay-as-you-go consent and the criteria builder live.
               */
              Navigation.navigate(
                (
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_CREATE] as Route,
                  ) as Route
                ).addQueryParams({
                  threatIntelFeedId: item._id?.toString() || "",
                }),
              );
              onCompleteAction();
            },
          },
          {
            title: "Update Credentials",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Key,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Replace this feed's API token or basic-auth password. Stored secrets can never be read back, so rotating them needs its own door."
              : updateGate.disabledReason ||
                "You do not have permission to update threat intel feeds.",
            onClick: (
              item: ThreatIntelFeed,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentlyEditingItem(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: ThreatIntelFeed): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
          {
            field: {
              pollIntervalInMinutes: true,
            },
            title: "Interval (Minutes)",
            type: FieldType.Number,
            noValueMessage: "-",
          },
          {
            field: {
              lastPolledAt: true,
            },
            title: "Last Polled",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: {
              lastPollSummary: true,
            },
            title: "Last Poll Summary",
            type: FieldType.LongText,
            noValueMessage: "-",
          },
          {
            field: {
              lastMatchAt: true,
            },
            title: "Last Match",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: {
              lastError: true,
            },
            title: "Last Error",
            type: FieldType.LongText,
            noValueMessage: "-",
          },
        ]}
      />

      <AnalyticsModelTable<ThreatIntelIndicator>
        modelType={ThreatIntelIndicator}
        id="threat-intel-indicators-table"
        name="Security Events > Threat Intel Indicators"
        singularName="Indicator"
        pluralName="Indicators"
        userPreferencesKey="threat-intel-indicators-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        cardProps={{
          title: "Indicators",
          description:
            "Normalized IOCs ingested from the feeds above. Rows upsert by STIX identity on re-polls and expire at each indicator's valid-until. Matching always checks validity and revocation at query time.",
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        sortBy="validFrom"
        sortOrder={SortOrder.Descending}
        noItemsMessage={
          "No indicators ingested yet. Indicators appear here after a feed's first successful poll."
        }
        showRefreshButton={true}
        showViewIdButton={false}
        filters={[
          {
            field: { indicatorType: true },
            type: FieldType.Text,
            title: "Type",
          },
          {
            field: { indicatorValue: true },
            type: FieldType.Text,
            title: "Value",
          },
          {
            field: { feedName: true },
            type: FieldType.Text,
            title: "Feed",
          },
        ]}
        columns={[
          {
            field: { indicatorValue: true },
            title: "Value",
            type: FieldType.Text,
          },
          {
            field: { indicatorType: true },
            title: "Type",
            type: FieldType.Text,
          },
          {
            field: { feedName: true },
            title: "Feed",
            type: FieldType.Text,
          },
          {
            field: { confidence: true },
            title: "Confidence",
            type: FieldType.Number,
            noValueMessage: "-",
          },
          {
            field: { validFrom: true },
            title: "Valid From",
            type: FieldType.DateTime,
            noValueMessage: "-",
          },
          {
            field: { validUntil: true },
            title: "Valid Until",
            type: FieldType.DateTime,
            noValueMessage: "-",
          },
        ]}
      />

      {currentlyEditingItem && (
        <BasicFormModal
          title={"Update Credentials"}
          name="Security Events > Update Threat Intel Feed Credentials"
          isLoading={isLoading}
          onClose={() => {
            setIsLoading(false);
            return setCurrentlyEditingItem(null);
          }}
          onSubmit={async (data: JSONObject) => {
            try {
              setIsLoading(true);

              /*
               * Only send what was typed: an untouched field must not
               * blank the stored secret.
               */
              const update: JSONObject = {};

              if (data["apiToken"]) {
                update["apiToken"] = data["apiToken"];
              }

              if (data["basicAuthPassword"]) {
                update["basicAuthPassword"] = data["basicAuthPassword"];
              }

              if (Object.keys(update).length > 0) {
                await ModelAPI.updateById<ThreatIntelFeed>({
                  modelType: ThreatIntelFeed,
                  id: currentlyEditingItem.id!,
                  data: update,
                });
              }

              setCurrentlyEditingItem(null);
            } catch {
              // do nothing
            }

            setIsLoading(false);
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  apiToken: true,
                },
                title: "API Token",
                description:
                  "The new bearer token. Encrypted at rest and never returned by the API — once saved it cannot be retrieved. Leave empty to keep the current one.",
                fieldType: FormFieldSchemaType.Password,
                required: false,
                placeholder: "Leave empty to keep the current token",
              },
              {
                field: {
                  basicAuthPassword: true,
                },
                title: "Basic Auth Password",
                description:
                  "The new basic-auth password. Encrypted at rest and never returned by the API. Leave empty to keep the current one.",
                fieldType: FormFieldSchemaType.Password,
                required: false,
                placeholder: "Leave empty to keep the current password",
              },
            ],
          }}
        />
      )}
    </Fragment>
  );
};

export default ThreatIntelPage;
