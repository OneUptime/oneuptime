import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import ThreatIntelIndicator from "Common/Models/AnalyticsModels/ThreatIntelIndicator";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import ThreatIntelFeedType, {
  THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES,
} from "Common/Types/SecurityEvent/ThreatIntelFeedType";
import {
  THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
  THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
} from "Common/Types/SecurityEvent/ThreatIntelConstants";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  THREAT_INTEL_MATCH_WORDING,
  getSecurityMatchActionFields,
  getSecurityMatchFindingField,
  getTaxiiSignInChoices,
} from "../../Components/SecurityEvents/SecurityMatchActionFields";
import {
  TAXII_SIGN_IN_CLEAR_DESCRIPTION,
  TAXII_SIGN_IN_FIELD_KEY,
  TAXII_SIGN_IN_FIELD_TITLE,
  TaxiiSignIn,
  getTaxiiSignIn,
} from "../../Components/SecurityEvents/SecurityMatchRaises";
import {
  SecurityDetectionStatus,
  getThreatIntelFeedMessages,
  getThreatIntelFeedStatus,
} from "../../Components/SecurityEvents/SecurityDetectionStatus";
import {
  SecurityDetectionErrors,
  getViewErrorActionButton,
  useSecurityDetectionErrors,
} from "../../Components/SecurityEvents/SecurityDetectionErrorModal";
import {
  IndicatorConfidenceCell,
  IndicatorTypeCell,
  getIndicatorTypeFilterOptions,
} from "../../Components/SecurityEvents/ThreatIntelIndicatorCells";
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
import SecurityEventsHowItWorksCard from "../../Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard";
import ThreatIntelRecommendedLists from "../../Components/SecurityEvents/ThreatIntelRecommendedLists";
import {
  THREAT_INTEL_FEED_TYPE_TEXTS,
  getThreatIntelFeedSource,
  getThreatIntelSourceChoices,
} from "../../Components/SecurityEvents/ThreatIntelSourcesCopy";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ThreatIntelGuide from "../../Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import { guideToMarkdown } from "../../Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The description, the poll interval, the confidence floor and the
 * detection finding: folded under More fields on their steps.
 */
const advancedSection: FormFieldCollapsibleSection<ThreatIntelFeed> =
  getAdvancedFormSection<ThreatIntelFeed>();

/*
 * A list's own More fields: how sure the list is, which most people leave
 * empty (Medium). The List step then asks for the address alone.
 */
const listAdvancedSection: FormFieldCollapsibleSection<ThreatIntelFeed> =
  getAdvancedFormSection<ThreatIntelFeed>();

const ThreatIntelPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Hooks run before the reseller gate below can return early — React
   * requires the same hooks in the same order on every render.
   */
  // A feed's last messages in full, from its row's View Error.
  const feedErrors: SecurityDetectionErrors<ThreatIntelFeed> =
    useSecurityDetectionErrors<ThreatIntelFeed>(getThreatIntelFeedMessages);

  const [currentlyEditingItem, setCurrentlyEditingItem] =
    useState<ThreatIntelFeed | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  /*
   * Bumped whenever the feeds change - one added from Free Lists, or added,
   * edited or deleted in the table - so the table and the tiles both read
   * them again.
   */
  const [feedsVersion, setFeedsVersion] = useState<number>(0);

  const translator: Translator = useTranslator();

  const onFeedsChanged: () => void = (): void => {
    setFeedsVersion((version: number): number => {
      return version + 1;
    });
  };

  /*
   * Same reseller-telemetry gate as every other Security Events page —
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
   * Security Event Connections table's Update credentials action.
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
    /*
     * The page's own vertical rhythm: without it the How-it-works card and
     * the table under it sit flush against each other.
     */
    <div className="space-y-6">
      <SecurityEventsHowItWorksCard guide={ThreatIntelGuide} />

      <ThreatIntelRecommendedLists
        refreshToggle={String(feedsVersion)}
        onAdded={onFeedsChanged}
      />

      <ModelTable<ThreatIntelFeed>
        modelType={ThreatIntelFeed}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
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
            "Where your indicators come from: lists of indicators, TAXII 2.1 collections and Google SecOps. Matching events get threat.* attributes, and a match opens a case, as a detection rule does.",
        }}
        /*
         * A project with no feed has Free Lists right above: the empty table
         * points there first, then at a feed of its own.
         */
        emptyState={{
          description:
            "Add a free list above in one click, or create a feed that reads your own list, a TAXII collection or Google SecOps.",
        }}
        refreshToggle={String(feedsVersion)}
        onCreateSuccess={async (item: ThreatIntelFeed) => {
          onFeedsChanged();
          return item;
        }}
        onItemDeleted={() => {
          onFeedsChanged();
        }}
        /*
         * A feed's source is set once, when it is added: the Edit form loads
         * it to show the source's own fields, and does not send it back.
         */
        onBeforeUpdate={async (item: ThreatIntelFeed) => {
          delete item.feedType;
          return item;
        }}
        helpContent={{
          title: ThreatIntelGuide.guideTitle,
          description: ThreatIntelGuide.guideDescription,
          markdown: guideToMarkdown(ThreatIntelGuide),
        }}
        createInitialValues={{
          /*
           * Mirror the DB defaults (ThreatIntelFeed.ts): without these
           * the severity dropdowns' showIf sees undefined on a fresh
           * create form and hides fields whose toggles are actually on.
           */
          isEnabled: true,
          feedType: ThreatIntelFeedType.List,
          pollIntervalInMinutes: THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
          minimumConfidence: 0,
          shouldCreateCase: true,
          shouldCreateAlert: true,
          shouldWriteDetectionFinding: true,
          shouldCreateIncident: false,
        }}
        /*
         * Where the indicators come from, then that source's own question -
         * a list's address, a TAXII collection or a Google SecOps
         * connection - then, for a TAXII collection, how to sign in to it,
         * and what a match does, as a detection rule asks it. Only the
         * source's own step is walked: a list feed is three steps, Source,
         * List and On Match. The Edit form starts at the feed's name, its
         * source set once, when it was added. What a match raises is one
         * choice (SecurityMatchActionFields); the description, the poll
         * interval, the confidence floor and the detection finding wait
         * under More fields, at their defaults.
         */
        formSteps={[
          { title: "Source", id: "source" },
          {
            title: "List",
            id: "list",
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.List
              );
            },
          },
          {
            title: "TAXII Server",
            id: "taxii-server",
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.Taxii
              );
            },
          },
          {
            title: "Google SecOps",
            id: "google-secops",
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) ===
                ThreatIntelFeedType.GoogleSecOps
              );
            },
          },
          {
            title: TAXII_SIGN_IN_FIELD_TITLE,
            id: "sign-in",
            /*
             * A new TAXII feed's question. An existing feed changes its
             * secrets with Update Credentials, so its Edit form walks this
             * step only to show the username it signs in with, when it has
             * one.
             */
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) ===
                  ThreatIntelFeedType.Taxii &&
                (getTaxiiSignIn(values) !== null ||
                  Boolean(values.basicAuthUsername))
              );
            },
          },
          { title: "On Match", id: "on-match" },
        ]}
        formFields={[
          {
            field: {
              feedType: true,
            },
            title: "Source",
            stepId: "source",
            description: "Where this feed's indicators come from.",
            fieldType: FormFieldSchemaType.RadioButton,
            radioButtonOptions: getThreatIntelSourceChoices(),
            required: true,
            // Set once: a feed of another source is a new feed.
            doNotShowWhenEditing: true,
            defaultValue: ThreatIntelFeedType.List,
            dataTestId: "threat-intel-feed-source",
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "source",
            description:
              "How this feed appears in the list and on its indicators.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Partner threat feed",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "source",
            description: "Disabled feeds are neither polled nor matched.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            /*
             * A new feed is polled: the create sends no isEnabled and the
             * column's default, on, is stored (#5158). Pausing is an edit.
             */
            doNotShowWhenCreating: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "source",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "What this feed carries and why it is subscribed.",
            collapsibleSection: advancedSection,
          },
          {
            field: {
              pollIntervalInMinutes: true,
            },
            title: "Poll Interval (Minutes)",
            stepId: "source",
            description:
              "How often the source is read for new indicators. Default 60; a list is read every 15 minutes at most.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "e.g. 60",
            /*
             * Keeps the range identical to the service's own check
             * (ThreatIntelFeedService.validateFeed), so an out-of-range
             * value fails in the form instead of at submit.
             */
            validation: {
              minValue: THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
              maxValue: THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
            },
            // A list is downloaded whole: the service holds it to 15 minutes too.
            customValidation: (
              values: FormValues<ThreatIntelFeed>,
            ): string | null => {
              const minutes: number = Number(values.pollIntervalInMinutes);

              return getThreatIntelFeedSource(values) ===
                ThreatIntelFeedType.List &&
                Number.isFinite(minutes) &&
                minutes < THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES
                ? translator.translateTemplate(
                    "A list is read every {{minutes}} minutes at most.",
                    {
                      minutes: translator.formatNumber(
                        THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES,
                      ),
                    },
                  )
                : null;
            },
            collapsibleSection: advancedSection,
          },
          {
            field: {
              minimumConfidence: true,
            },
            title: "Minimum Confidence",
            stepId: "source",
            description:
              "Skip indicators whose STIX confidence is below this (0-100). 0 ingests everything; indicators that carry no confidence always pass.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "0",
            validation: {
              minValue: THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
              maxValue: THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
            },
            // A list's indicators all have the list's confidence.
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) !== ThreatIntelFeedType.List
              );
            },
            collapsibleSection: advancedSection,
          },
          {
            field: {
              listUrl: true,
            },
            title: "List URL",
            stepId: "list",
            description:
              "An https address that downloads a list: one IP address, domain, URL or file hash a line.",
            fieldType: FormFieldSchemaType.URL,
            required: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.List
              );
            },
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.List
              );
            },
            placeholder: "https://lists.example.com/blocklist.txt",
            disableSpellCheck: true,
          },
          {
            field: {
              indicatorConfidence: true,
            },
            title: "Confidence",
            stepId: "list",
            description:
              "How sure the list is, 1 to 100. A match is Critical at 90, High at 70, Medium at 40, Low below. Empty is Medium.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "e.g. 70",
            validation: {
              minValue: 1,
              maxValue: 100,
            },
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.List
              );
            },
            collapsibleSection: listAdvancedSection,
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
            required: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.Taxii
              );
            },
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.Taxii
              );
            },
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
            required: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.Taxii
              );
            },
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) === ThreatIntelFeedType.Taxii
              );
            },
            placeholder: "e.g. 91a7b528-80eb-42ed-a74d-c6fbd5a26116",
            disableSpellCheck: true,
          },
          {
            field: {
              securityEventConnection: true,
            },
            title: "Google SecOps Connection",
            stepId: "google-secops",
            description:
              "The connection whose key reads the indicators Google SecOps found. Its service account needs the Chronicle API Viewer role.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: SecurityEventConnection,
              labelField: "name",
              valueField: "_id",
              query: { provider: SecurityEventConnectorProvider.GoogleSecOps },
            },
            required: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) ===
                ThreatIntelFeedType.GoogleSecOps
              );
            },
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return (
                getThreatIntelFeedSource(values) ===
                ThreatIntelFeedType.GoogleSecOps
              );
            },
            placeholder: "Choose a Google SecOps connection",
            sideLink: {
              text: "Connect Google SecOps",
              url: RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
              ),
              openLinkInNewTab: false,
            },
          },
          /*
           * How OneUptime signs in: one choice where a token, a username and
           * a password were asked at once. A new feed's only: stored
           * secrets are never read back, so an existing feed changes them
           * with Update Credentials, which offers the same answers.
           */
          {
            overrideField: {
              basicAuthUsername: true,
            },
            overrideFieldKey: TAXII_SIGN_IN_FIELD_KEY,
            formOnly: true,
            title: TAXII_SIGN_IN_FIELD_TITLE,
            stepId: "sign-in",
            fieldType: FormFieldSchemaType.RadioButton,
            radioButtonOptions: getTaxiiSignInChoices(),
            required: true,
            hideColumnDescription: true,
            doNotShowWhenEditing: true,
            defaultValue: TaxiiSignIn.Anonymous,
            dataTestId: "taxii-sign-in",
          },
          {
            field: {
              apiToken: true,
            },
            title: "API Token",
            stepId: "sign-in",
            description:
              "A bearer token for collections that need one. It is never shown again; use Update Credentials to replace it.",
            fieldType: FormFieldSchemaType.Password,
            required: (values: FormValues<ThreatIntelFeed>): boolean => {
              return getTaxiiSignIn(values) === TaxiiSignIn.ApiToken;
            },
            /*
             * The column has ColumnAccessControl read: [], so an edit form
             * can never prefill it; showing an empty field on edit would
             * silently blank the stored secret on every unrelated change.
             */
            doNotShowWhenEditing: true,
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return getTaxiiSignIn(values) === TaxiiSignIn.ApiToken;
            },
          },
          {
            field: {
              basicAuthUsername: true,
            },
            title: "Basic Auth Username",
            stepId: "sign-in",
            fieldType: FormFieldSchemaType.Text,
            required: (values: FormValues<ThreatIntelFeed>): boolean => {
              return getTaxiiSignIn(values) === TaxiiSignIn.BasicAuth;
            },
            /*
             * The column's sentence says to leave it empty for anonymous or
             * token access: the Sign-in choice above says that now.
             */
            hideColumnDescription: true,
            disableSpellCheck: true,
            /*
             * Asked of a new feed that signs in with it, and shown on an
             * existing feed that has one (the sign-in choice is a new
             * feed's only).
             */
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              const signIn: TaxiiSignIn | null = getTaxiiSignIn(values);

              return signIn === null
                ? Boolean(values.basicAuthUsername)
                : signIn === TaxiiSignIn.BasicAuth;
            },
          },
          {
            field: {
              basicAuthPassword: true,
            },
            title: "Basic Auth Password",
            stepId: "sign-in",
            description:
              "Encrypted at rest and never returned by the API — use the row's Update Credentials action to rotate it later.",
            fieldType: FormFieldSchemaType.Password,
            required: (values: FormValues<ThreatIntelFeed>): boolean => {
              return getTaxiiSignIn(values) === TaxiiSignIn.BasicAuth;
            },
            doNotShowWhenEditing: true,
            showIf: (values: FormValues<ThreatIntelFeed>): boolean => {
              return getTaxiiSignIn(values) === TaxiiSignIn.BasicAuth;
            },
          },
          ...getSecurityMatchActionFields<ThreatIntelFeed>(
            THREAT_INTEL_MATCH_WORDING,
          ),
          getSecurityMatchFindingField<ThreatIntelFeed>(
            THREAT_INTEL_MATCH_WORDING,
            advancedSection,
          ),
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        showViewIdButton={true}
        actionButtons={[
          // On a feed whose poll or check left a message, the row's button.
          getViewErrorActionButton<ThreatIntelFeed>({
            getMessages: getThreatIntelFeedMessages,
            show: feedErrors.show,
          }),
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
            // Only a TAXII feed signs in: a list is public, Google SecOps signs in with its connection.
            isVisible: (item: ThreatIntelFeed): boolean => {
              return (
                getThreatIntelFeedSource(item) === ThreatIntelFeedType.Taxii
              );
            },
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
              feedType: true,
            },
            title: "Source",
            type: FieldType.Text,
            getElement: (item: ThreatIntelFeed): ReactElement => {
              return (
                <span data-testid="threat-intel-feed-source-cell">
                  {translator.translateText(
                    THREAT_INTEL_FEED_TYPE_TEXTS[getThreatIntelFeedSource(item)]
                      .title,
                  )}
                </span>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            /*
             * Whether the feed works, not only whether it is on: a failed
             * poll or check reads red here, with View Error on its row
             * (SecurityDetectionStatus). It reads the error columns below,
             * which the table selects even while they are hidden.
             */
            getElement: (item: ThreatIntelFeed): ReactElement => {
              const status: SecurityDetectionStatus =
                getThreatIntelFeedStatus(item);

              return (
                <Pill
                  color={status.color}
                  text={status.text}
                  tooltip={status.tooltip}
                />
              );
            },
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
              lastMatchAt: true,
            },
            title: "Last Match",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          /*
           * One line, cut short with the whole summary under the pointer:
           * as a paragraph it made every row of a wide table as tall as its
           * longest summary, in a column the card had scrolled out of view.
           */
          {
            field: {
              lastPollSummary: true,
            },
            title: "Last Poll Summary",
            type: FieldType.Text,
            noValueMessage: "-",
          },
          /*
           * The rest start hidden (Customize Columns brings them back): the
           * interval is the feed's setting, and the two messages, empty while
           * the feed works, show through the Status and View Error. The
           * matching side stays separate from the polling side, so a broken
           * TAXII server and a broken match query are told apart.
           */
          {
            field: {
              pollIntervalInMinutes: true,
            },
            title: "Interval (Minutes)",
            type: FieldType.Number,
            noValueMessage: "-",
            isHiddenByDefault: true,
          },
          {
            field: {
              lastError: true,
            },
            title: "Last Error",
            type: FieldType.LongText,
            noValueMessage: "-",
            wrapContent: true,
            isHiddenByDefault: true,
          },
          {
            field: {
              lastEvaluatedAt: true,
            },
            title: "Last Evaluated",
            type: FieldType.DateTime,
            noValueMessage: "Never",
            isHiddenByDefault: true,
          },
          {
            field: {
              lastMatchError: true,
            },
            title: "Last Match Error",
            type: FieldType.LongText,
            noValueMessage: "-",
            wrapContent: true,
            isHiddenByDefault: true,
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
            "Indicators from the feeds above. An indicator can briefly appear twice, and expired or revoked ones stay listed for a while but are never matched.",
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
            type: FieldType.Dropdown,
            title: "Type",
            // A pick of the types, named as the column names them.
            filterDropdownOptions: getIndicatorTypeFilterOptions(),
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
          {
            field: { revoked: true },
            type: FieldType.Boolean,
            title: "Revoked",
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
            // "IPv4 address", as the guide names it; the stored type on hover.
            getElement: (item: ThreatIntelIndicator): ReactElement => {
              return <IndicatorTypeCell type={item.indicatorType} />;
            },
            getExportValue: (item: ThreatIntelIndicator): string => {
              return item.indicatorType || "";
            },
          },
          {
            field: { revoked: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: ThreatIntelIndicator): ReactElement => {
              if (item.revoked) {
                return <Pill color={Red} text="Revoked" />;
              }

              /*
               * Defensive parse: the analytics wire hands DateTime64
               * values back as strings.
               */
              const validUntilMillis: number = new Date(
                item.validUntil as unknown as string,
              ).getTime();

              if (
                Number.isFinite(validUntilMillis) &&
                validUntilMillis <= Date.now()
              ) {
                return <Pill color={Yellow} text="Expired" />;
              }

              return <Pill color={Green} text="Active" />;
            },
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
            /*
             * STIX's 0 is "not specified", and an unscored indicator matches
             * as Medium: "Not scored", as the threat levels name it, not a
             * 0 that reads as the lowest confidence.
             */
            getElement: (item: ThreatIntelIndicator): ReactElement => {
              return <IndicatorConfidenceCell confidence={item.confidence} />;
            },
            getExportValue: (item: ThreatIntelIndicator): string => {
              return item.confidence === undefined || item.confidence === null
                ? ""
                : String(item.confidence);
            },
          },
          // Valid Until says when an indicator stops matching; this, when it began.
          {
            field: { validFrom: true },
            title: "Valid From",
            type: FieldType.DateTime,
            noValueMessage: "-",
            isHiddenByDefault: true,
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
               * The chosen mode REPLACES the feed's authentication
               * outright: setting one credential kind explicitly clears
               * the other (and Anonymous clears both). This is what
               * makes switching auth methods possible at all — stored
               * secrets are write-only, and TaxiiClient prefers a token
               * over basic auth whenever one is stored, so a leftover
               * secret would silently win over the one the user means
               * to use. The server enforces the same either/or rule.
               */
              const mode: string = String(data["authenticationMode"] || "");

              let update: JSONObject | null = null;

              if (mode === "api-token" && data["apiToken"]) {
                update = {
                  apiToken: data["apiToken"],
                  basicAuthUsername: null,
                  basicAuthPassword: null,
                };
              } else if (mode === "basic-auth" && data["basicAuthPassword"]) {
                update = {
                  apiToken: null,
                  ...(data["basicAuthUsername"]
                    ? { basicAuthUsername: data["basicAuthUsername"] }
                    : {}),
                  basicAuthPassword: data["basicAuthPassword"],
                };
              } else if (mode === "anonymous") {
                update = {
                  apiToken: null,
                  basicAuthUsername: null,
                  basicAuthPassword: null,
                };
              }

              if (update) {
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
              /*
               * The answers a new feed's Sign-in offers, in the same words;
               * here No sign-in clears what is stored.
               */
              {
                field: {
                  authenticationMode: true,
                },
                title: TAXII_SIGN_IN_FIELD_TITLE,
                description:
                  "How OneUptime signs in to the TAXII server. Changing it clears the secret of the other kind.",
                fieldType: FormFieldSchemaType.RadioButton,
                radioButtonOptions: getTaxiiSignInChoices({
                  anonymousDescription: TAXII_SIGN_IN_CLEAR_DESCRIPTION,
                }),
                required: true,
              },
              {
                field: {
                  apiToken: true,
                },
                title: "API Token",
                description:
                  "The new bearer token. Encrypted at rest and never returned by the API — once saved it cannot be retrieved.",
                fieldType: FormFieldSchemaType.Password,
                required: true,
                placeholder: "Paste the new token",
                showIf: (values: FormValues<JSONObject>): boolean => {
                  return values["authenticationMode"] === "api-token";
                },
              },
              {
                field: {
                  basicAuthUsername: true,
                },
                title: "Basic Auth Username",
                description:
                  "Leave empty to keep the currently stored username.",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                placeholder: "Leave empty to keep the current username",
                showIf: (values: FormValues<JSONObject>): boolean => {
                  return values["authenticationMode"] === "basic-auth";
                },
              },
              {
                field: {
                  basicAuthPassword: true,
                },
                title: "Basic Auth Password",
                description:
                  "The new basic-auth password. Encrypted at rest and never returned by the API.",
                fieldType: FormFieldSchemaType.Password,
                required: true,
                placeholder: "Enter the new password",
                showIf: (values: FormValues<JSONObject>): boolean => {
                  return values["authenticationMode"] === "basic-auth";
                },
              },
            ],
          }}
        />
      )}

      {feedErrors.element}
    </div>
  );
};

export default ThreatIntelPage;
