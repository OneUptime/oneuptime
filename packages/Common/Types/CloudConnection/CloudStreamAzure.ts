import {
  AZURE_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
} from "../Cloud/CloudResourceCatalog";
import ObjectID from "../ObjectID";
import { translationKey } from "../Translator";
import {
  CloudStreamProblem,
  getCloudStreamSuffix,
  quoteForShell,
} from "./CloudStream";

/*
 * STREAMING AN AZURE CONNECTION'S METRICS AND LOGS INTO ONEUPTIME.
 *
 * Azure Monitor streams a resource's platform metrics and resource logs
 * only into Event Hubs (or a storage account, or Log Analytics): no
 * managed Azure service delivers them to an HTTPS endpoint without code -
 * an Azure Function, a Logic App - running in the customer's subscription.
 * So OneUptime reads the event hubs itself, with the connection's own app
 * registration, and nothing runs in the subscription but Azure's own
 * services. One command in Azure Cloud Shell sets it up
 * (getAzureCloudStreamCommand):
 *
 *   - a resource group, oneuptime-stream-<8 hex>, in the first
 *     subscription, holding an Event Hubs namespace (Standard: it speaks
 *     the Kafka protocol OneUptime reads with) in each region the
 *     subscriptions have resources in, oneuptime-<8 hex>-<region>, each
 *     with one event hub, oneuptime - diagnostic settings send only to an
 *     event hub in the resource's own region;
 *   - Azure Event Hubs Data Receiver for the connection's app on that
 *     resource group alone: it may read those event hubs and nothing else,
 *     and send to none;
 *   - a diagnostic setting, OneUptime-<8 hex>, on each resource of a type
 *     OneUptime reads (CloudResourceCatalog), sending its platform metrics
 *     (AllMetrics), its resource logs (every category, allLogs) or both to
 *     its region's event hub. A resource that has no diagnostic settings,
 *     or no logs, or already the five Azure allows, is said and left out.
 *     A storage account's logs are its services': with logs, each of its
 *     blob, file, queue and table services - the ones its kind has - gets
 *     a setting of its own that sends them, and the account its metrics;
 *   - with the Activity Log (#10111), a subscription diagnostic setting of
 *     the same name on each subscription, sending the categories Security
 *     Events reads (Administrative, Security, Policy) to the first region's
 *     event hub: the Activity Log is global, so any region's will do.
 *     Azure refusing it is said with what it takes, and the rest goes on.
 *
 * Microsoft Entra ID's logs are the tenant's, and only a Security
 * Administrator of the tenant may send them anywhere: their diagnostic
 * setting is a command of its own (getAzureCloudStreamEntraCommand), for
 * whoever is one, run once the event hubs are there.
 *
 * OneUptime then reads each event hub a minute at a time
 * (AzureEventHubsStream), from where it last read, and Event Hubs keeps
 * what was not read yet. It gives OneUptime no other access: metrics and
 * logs only flow out, through Azure's own diagnostic settings.
 *
 * The command never calls exit (pasted into Cloud Shell, it would close the
 * shell): it is one function that stops at the first step Azure refuses.
 * Running it again updates what it made and sets up resources made since.
 */

export const AZURE_CLOUD_STREAM_EVENT_HUB: string = "oneuptime";
export const AZURE_CLOUD_STREAM_PARTITIONS: number = 2;
export const AZURE_CLOUD_STREAM_SKU: string = "Standard";
// The role the connection's app is given, on the resource group alone.
export const AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE: string =
  "Azure Event Hubs Data Receiver";
// The namespace rule a diagnostic setting sends with: Azure's own, made with the namespace.
export const AZURE_EVENT_HUBS_SEND_RULE: string = "RootManageSharedAccessKey";
// The categories a diagnostic setting sends.
export const AZURE_DIAGNOSTIC_LOGS: string =
  '[{"categoryGroup":"allLogs","enabled":true}]';
export const AZURE_DIAGNOSTIC_METRICS: string =
  '[{"category":"AllMetrics","enabled":true}]';

/*
 * The Activity Log's categories a subscription's setting sends: the ones
 * Security Events reads (AzureActivityLogParser) - changes, Defender for
 * Cloud's alerts and what Azure Policy refused - not service health,
 * autoscale or Advisor's recommendations.
 */
export const AZURE_ACTIVITY_LOG_CATEGORIES: ReadonlyArray<string> = [
  "Administrative",
  "Security",
  "Policy",
];

export const AZURE_DIAGNOSTIC_ACTIVITY_LOG: string = JSON.stringify(
  AZURE_ACTIVITY_LOG_CATEGORIES.map((category: string) => {
    return { category, enabled: true };
  }),
);

/*
 * Microsoft Entra ID's categories its setting sends: the ones Security
 * Events reads (AzureActivityLogParser) - sign-ins, directory changes and
 * Identity Protection's risks. Background and app sign-ins are read only
 * when they fail, and can be 5 to 10 times as many as a person's.
 */
export const AZURE_ENTRA_ID_LOG_CATEGORIES: ReadonlyArray<string> = [
  "SignInLogs",
  "NonInteractiveUserSignInLogs",
  "ServicePrincipalSignInLogs",
  "AuditLogs",
  "RiskyUsers",
  "UserRiskEvents",
];

export const AZURE_DIAGNOSTIC_ENTRA_ID_LOGS: string = JSON.stringify(
  AZURE_ENTRA_ID_LOG_CATEGORIES.map((category: string) => {
    return { category, enabled: true };
  }),
);

// The tenant's diagnostic settings, relative to Resource Manager's endpoint in each Azure cloud.
export const AZURE_ENTRA_ID_DIAGNOSTIC_SETTINGS_PATH: string =
  "/providers/microsoft.aadiam/diagnosticSettings";
export const AZURE_ENTRA_ID_DIAGNOSTIC_SETTINGS_API_VERSION: string =
  "2017-04-01";

// What a subscription's and the tenant's settings take, as the commands say it.
export const AZURE_DIAGNOSTIC_SETTINGS_WRITE: string =
  "Microsoft.Insights/diagnosticSettings/write";
export const AZURE_EVENT_HUBS_LIST_KEYS: string =
  "Microsoft.EventHub/namespaces/authorizationRules/listKeys/action";
export const AZURE_ENTRA_ID_SETTINGS_ROLE: string = "Security Administrator";

// A storage account's services that log, and the ones each kind of account has.
export const AZURE_STORAGE_ACCOUNT_TYPE: string =
  "microsoft.storage/storageaccounts";
export const AZURE_STORAGE_SERVICES: ReadonlyArray<string> = [
  "blobServices",
  "fileServices",
  "queueServices",
  "tableServices",
];
// How many resources the command sets up at once.
export const AZURE_CLOUD_STREAM_PARALLEL: number = 4;
// The most subscriptions one command sets up.
export const AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS: number = 50;
// How many skipped resources the command lists, with Azure's reason.
export const AZURE_CLOUD_STREAM_SKIPPED_SHOWN: number = 10;
// Where the group goes when no resource says a region.
export const AZURE_CLOUD_STREAM_FALLBACK_REGION: string = "eastus";
// The tag every resource the command makes carries.
export const AZURE_CLOUD_STREAM_TAG: string = "oneuptime-connection";

/*
 * The resource types the command sets diagnostic settings on: the ones a
 * connection reads (CloudResourceCatalog), lower case - the command lower
 * cases the type Azure CLI lists before it compares.
 */
export const AZURE_CLOUD_STREAM_RESOURCE_TYPES: ReadonlyArray<string> =
  AZURE_RESOURCE_TYPES.map(
    (descriptor: CloudResourceTypeDescriptor): string => {
      return descriptor.type.toLowerCase();
    },
  ).filter((type: string, index: number, all: Array<string>): boolean => {
    return all.indexOf(type) === index;
  });

// What the command says, in English as the shell prints it.
export const AZURE_CLOUD_STREAM_COMMAND_DONE: string =
  "Done. OneUptime reads the event hubs within a minute, once Azure has the role in force.";
export const AZURE_CLOUD_STREAM_COMMAND_STOPPED: string =
  "Stopped: fix what Azure said above, then run this command again.";

export interface AzureCloudStreamNames {
  resourceGroup: string;
  // Each region's namespace is this and the region.
  namespacePrefix: string;
  eventHub: string;
  diagnosticSetting: string;
}

export function getAzureCloudStreamNames(
  connectionId: string,
): AzureCloudStreamNames {
  const suffix: string = getCloudStreamSuffix(connectionId);

  return {
    resourceGroup: `oneuptime-stream-${suffix}`,
    namespacePrefix: `oneuptime-${suffix}-`,
    eventHub: AZURE_CLOUD_STREAM_EVENT_HUB,
    diagnosticSetting: `OneUptime-${suffix}`,
  };
}

/*
 * An Azure region's name as Azure CLI and Resource Manager write it:
 * lowercase letters and digits, starting with a letter - eastus,
 * westeurope, australiacentral2. Read character by character.
 */
export function isAzureRegion(value: string): boolean {
  if (value.length < 4 || value.length > 30) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value[index]!;
    const isLetter: boolean = character >= "a" && character <= "z";
    const isDigit: boolean = character >= "0" && character <= "9";

    if ((index === 0 && !isLetter) || (!isLetter && !isDigit)) {
      return false;
    }
  }

  return true;
}

// The namespace of one region - or null for a region that is not one.
export function getAzureCloudStreamNamespace(
  connectionId: string,
  region: string,
): string | null {
  const code: string = region.trim().toLowerCase();

  return isAzureRegion(code)
    ? `${getAzureCloudStreamNames(connectionId).namespacePrefix}${code}`
    : null;
}

/*
 * The region a namespace of this connection's is in, from its name - or
 * null for a namespace that is not one of its.
 */
export function readAzureCloudStreamNamespaceRegion(
  connectionId: string,
  namespace: string,
): string | null {
  const prefix: string = getAzureCloudStreamNames(connectionId).namespacePrefix;
  const name: string = namespace.trim().toLowerCase();

  if (!name.startsWith(prefix)) {
    return null;
  }

  const region: string = name.slice(prefix.length);

  return isAzureRegion(region) ? region : null;
}

/*
 * An Event Hubs namespace's name as Azure takes it: 6 to 50 letters,
 * digits and hyphens, starting with a letter and ending with a letter or a
 * digit.
 */
export function isAzureEventHubsNamespace(value: string): boolean {
  if (value.length < 6 || value.length > 50) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value[index]!;
    const isLetter: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z");
    const isDigit: boolean = character >= "0" && character <= "9";

    if (index === 0 && !isLetter) {
      return false;
    }

    if (!isLetter && !isDigit && character !== "-") {
      return false;
    }
  }

  return !value.endsWith("-");
}

/*
 * Where a namespace takes Kafka clients: its host, in the connection's
 * Azure cloud, port 9093.
 */
export const AZURE_EVENT_HUBS_KAFKA_PORT: number = 9093;

export const AZURE_EVENT_HUBS_HOST_SUFFIXES: Readonly<
  Record<"public" | "usgov", string>
> = {
  public: ".servicebus.windows.net",
  usgov: ".servicebus.usgovcloudapi.net",
};

export function getAzureEventHubsHost(data: {
  namespace: string;
  cloud: "public" | "usgov";
}): string | null {
  return isAzureEventHubsNamespace(data.namespace)
    ? `${data.namespace.toLowerCase()}${AZURE_EVENT_HUBS_HOST_SUFFIXES[data.cloud]}`
    : null;
}

/*
 * ---- Where OneUptime read each event hub to --------------------------------
 *
 * CloudConnection.streamState for an Azure connection: the subscription
 * the command put the event hubs in, and the next offset of each
 * partition of each namespace's event hub. Server only.
 */

export const AZURE_CLOUD_STREAM_MAX_NAMESPACES: number = 64;
export const AZURE_CLOUD_STREAM_MAX_PARTITIONS: number = 32;

export interface AzureCloudStreamState {
  hostSubscriptionId: string;
  // Namespace name -> partition -> the next offset to read.
  offsets: Record<string, Record<string, number>>;
}

export function readAzureCloudStreamState(
  value: unknown,
): AzureCloudStreamState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const stored: Record<string, unknown> = value as Record<string, unknown>;
  const hostSubscriptionId: unknown = stored["hostSubscriptionId"];

  if (
    typeof hostSubscriptionId !== "string" ||
    !ObjectID.isValidUUID(hostSubscriptionId)
  ) {
    return null;
  }

  const offsets: Record<string, Record<string, number>> = {};
  const rawOffsets: unknown = stored["offsets"];

  if (
    rawOffsets &&
    typeof rawOffsets === "object" &&
    !Array.isArray(rawOffsets)
  ) {
    for (const namespace of Object.keys(rawOffsets).slice(
      0,
      AZURE_CLOUD_STREAM_MAX_NAMESPACES,
    )) {
      const partitions: unknown = (rawOffsets as Record<string, unknown>)[
        namespace
      ];

      if (
        !isAzureEventHubsNamespace(namespace) ||
        !partitions ||
        typeof partitions !== "object" ||
        Array.isArray(partitions)
      ) {
        continue;
      }

      const read: Record<string, number> = {};

      for (const partition of Object.keys(partitions).slice(
        0,
        AZURE_CLOUD_STREAM_MAX_PARTITIONS,
      )) {
        const offset: unknown = (partitions as Record<string, unknown>)[
          partition
        ];
        const index: number = Number(partition);

        if (
          Number.isInteger(index) &&
          index >= 0 &&
          String(index) === partition &&
          typeof offset === "number" &&
          Number.isSafeInteger(offset) &&
          offset >= 0
        ) {
          read[partition] = offset;
        }
      }

      offsets[namespace] = read;
    }
  }

  return { hostSubscriptionId: hostSubscriptionId.toLowerCase(), offsets };
}

export const STREAM_NO_APP: string = translationKey(
  "This connection does not say which app registration it reads with. Save it again with its app to stream.",
);
export const STREAM_NO_SUBSCRIPTION: string = translationKey(
  "List at least one subscription to stream from.",
);
export const STREAM_TOO_MANY_SUBSCRIPTIONS: string = translationKey(
  "List at most {{count}} subscriptions.",
);
export const STREAM_NOT_A_SUBSCRIPTION: string = translationKey(
  "List subscriptions by their IDs, such as 00000000-0000-0000-0000-000000000000.",
);

export function getAzureCloudStreamProblem(data: {
  appId: string;
  subscriptionIds: Array<string>;
}): CloudStreamProblem | null {
  if (!ObjectID.isValidUUID(data.appId.trim())) {
    return { text: STREAM_NO_APP, values: {} };
  }

  if (data.subscriptionIds.length === 0) {
    return { text: STREAM_NO_SUBSCRIPTION, values: {} };
  }

  if (data.subscriptionIds.length > AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS) {
    return {
      text: STREAM_TOO_MANY_SUBSCRIPTIONS,
      values: { count: String(AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS) },
    };
  }

  for (const subscriptionId of data.subscriptionIds) {
    if (!ObjectID.isValidUUID(subscriptionId)) {
      return { text: STREAM_NOT_A_SUBSCRIPTION, values: {} };
    }
  }

  return null;
}

// Subscription IDs typed one a line or separated by commas, lower case, each once.
export function readAzureCloudStreamSubscriptions(text: string): Array<string> {
  const subscriptions: Array<string> = [];

  for (const line of text.split("\n")) {
    for (const piece of line.split(",")) {
      const value: string = piece.trim().toLowerCase();

      if (value && !subscriptions.includes(value)) {
        subscriptions.push(value);
      }
    }
  }

  return subscriptions;
}

/*
 * What a command prints when Azure refuses a subscription's or the tenant's
 * diagnostic setting: what it takes, in Azure's own words for it. The key
 * comes first - its refusal (LinkedAuthorizationFailed) says
 * AuthorizationFailed too.
 */
function refusedLines(data: {
  // What the setting takes when Azure says the person may not make it.
  takes: string;
}): Array<string> {
  return [
    '    case "$2" in',
    "      *LinkedAuthorizationFailed*) echo \"$1: Azure says you may not use the event hubs' key. It takes " +
      AZURE_EVENT_HUBS_LIST_KEYS +
      ' on the resource group $GROUP, which its Owner and Contributor have." ;;',
    '      *AuthorizationFailed*|*Forbidden*) echo "$1: Azure says you may not make its diagnostic setting. ' +
      data.takes +
      '" ;;',
    "      *) echo \"$1: $(printf '%s' \"$2\" | grep -v '^$' | head -1)\" ;;",
    "    esac",
  ];
}

function readSubscriptions(subscriptionIds: Array<string>): Array<string> {
  return subscriptionIds
    .map((subscriptionId: string): string => {
      return subscriptionId.trim().toLowerCase();
    })
    .filter(
      (subscriptionId: string, index: number, all: Array<string>): boolean => {
        return (
          ObjectID.isValidUUID(subscriptionId) &&
          all.indexOf(subscriptionId) === index
        );
      },
    )
    .slice(0, AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS);
}

/*
 * The one command, for Azure Cloud Shell. The first subscription holds the
 * event hubs; each listed subscription's resources are set up to send to
 * them, and - with the Activity Log - the subscription itself.
 */
export function getAzureCloudStreamCommand(data: {
  connectionId: string;
  // The connection's app registration (its client ID).
  appId: string;
  subscriptionIds: Array<string>;
  metrics: boolean;
  logs: boolean;
  // Each subscription's Activity Log too (#10111).
  activityLog?: boolean | undefined;
}): string {
  const names: AzureCloudStreamNames = getAzureCloudStreamNames(
    data.connectionId,
  );
  const subscriptions: Array<string> = readSubscriptions(data.subscriptionIds);
  const quotedSubscriptions: string = subscriptions
    .map(quoteForShell)
    .join(" ");
  const host: string = subscriptions[0] || "";
  const both: boolean = data.metrics && data.logs;

  // The setting for one resource: both kinds, then each alone, as Azure allows.
  const attempts: Array<string> = [
    ...(both ? ['--logs "$LOGS" --metrics "$METRICS"'] : []),
    ...(data.metrics ? ['--metrics "$METRICS"'] : []),
    ...(data.logs ? ['--logs "$LOGS"'] : []),
  ];
  const settingLine: (categories: string) => string = (
    categories: string,
  ): string => {
    return `ERROR=$(az monitor diagnostic-settings create --name "$SETTING" --resource "$1" --event-hub "$HUB" --event-hub-rule "$RULE" ${categories} --output none 2>&1) && { echo "ok"; return 0; }`;
  };
  // A storage service has logs alone: its account takes the metrics.
  const tryLines: Array<string> = data.logs
    ? [
        '    if [ "$3" = service ]; then',
        `      ${settingLine('--logs "$LOGS"')}`,
        "    else",
        ...attempts.map((categories: string): string => {
          return `      ${settingLine(categories)}`;
        }),
        "    fi",
      ]
    : attempts.map((categories: string): string => {
        return `    ${settingLine(categories)}`;
      });

  /*
   * A storage account's logs are its services': with logs, each one its
   * kind has, and the account itself only for its metrics.
   */
  const storageLines: Array<string> = [
    `    if [ "\${TYPE,,}" = ${AZURE_STORAGE_ACCOUNT_TYPE} ]; then`,
    ...(data.metrics
      ? ['      printf \'%s\\t%s\\t%s\\n\' "$ID" "${LOCATION,,}" resource']
      : []),
    ...(data.logs
      ? [
          '      case "${KIND,,}" in',
          "        blobstorage|blockblobstorage) SERVICES=blobServices ;;",
          "        filestorage) SERVICES=fileServices ;;",
          `        *) SERVICES="${AZURE_STORAGE_SERVICES.join(" ")}" ;;`,
          "      esac",
          '      for SERVICE in $SERVICES; do printf \'%s\\t%s\\t%s\\n\' "$ID/$SERVICE/default" "${LOCATION,,}" service; done',
        ]
      : []),
    "      continue",
    "    fi",
  ];

  // Each subscription's Activity Log, to the first region's event hub: it is global.
  const activityLogLines: Array<string> = data.activityLog
    ? [
        "  oneuptime_stream_refused() {",
        ...refusedLines({
          takes: `It takes ${AZURE_DIAGNOSTIC_SETTINGS_WRITE} on the subscription, which its Owner, Contributor and Monitoring Contributor have.`,
        }),
        "  }",
        `  for SUB in ${quotedSubscriptions}; do`,
        '    ERROR=$(az monitor diagnostic-settings subscription create --subscription "$SUB" --name "$SETTING" --location "$FIRST" --event-hub-name "$HUB" --event-hub-auth-rule "/subscriptions/$HOST/resourceGroups/$GROUP/providers/Microsoft.EventHub/namespaces/$PREFIX$FIRST/authorizationRules/' +
          AZURE_EVENT_HUBS_SEND_RULE +
          '" --logs "$ACTIVITY" --output none 2>&1) && echo "$SUB: its Activity Log sends to the $FIRST event hub." || oneuptime_stream_refused "$SUB: its Activity Log is left out" "$ERROR"',
        "  done",
      ]
    : [];

  const tag: string = `${AZURE_CLOUD_STREAM_TAG}=${data.connectionId.toLowerCase()}`;
  const cleanUp: string = 'rm -f "$LIST" "$KNOWN" "$RESULTS"';
  const role: string = `"${AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE}"`;

  return [
    "oneuptime_stream() {",
    "  local APP=" + quoteForShell(data.appId.trim().toLowerCase()),
    "  local HOST=" + quoteForShell(host),
    "  local GROUP=" + names.resourceGroup,
    "  local PREFIX=" + names.namespacePrefix,
    "  local HUB=" + names.eventHub,
    "  local SETTING=" + names.diagnosticSetting,
    "  local LOGS=" + quoteForShell(AZURE_DIAGNOSTIC_LOGS),
    "  local METRICS=" + quoteForShell(AZURE_DIAGNOSTIC_METRICS),
    ...(data.activityLog
      ? ["  local ACTIVITY=" + quoteForShell(AZURE_DIAGNOSTIC_ACTIVITY_LOG)]
      : []),
    "  local TYPES=" +
      quoteForShell(` ${AZURE_CLOUD_STREAM_RESOURCE_TYPES.join(" ")} `),
    "  local LIST KNOWN RESULTS FIRST REGION REGIONS SUB N=0 ID LOCATION TYPE KIND SCOPE SERVICE SERVICES ERROR DONE SKIPPED",
    "  LIST=$(mktemp) KNOWN=$(mktemp) RESULTS=$(mktemp)",
    // Every resource of the subscriptions, with its region, type and kind.
    "  for SUB in " + quotedSubscriptions + "; do",
    '    az resource list --subscription "$SUB" --query "[?location!=null].[id, location, type, kind]" --output tsv >> "$LIST" || { echo "$SUB: its resources could not be listed."; ' +
      cleanUp +
      "; return 1; }",
    "  done",
    // Only the types OneUptime reads, and never the group's own event hubs.
    "  while IFS=$'\\t' read -r ID LOCATION TYPE KIND; do",
    '    case "${ID,,}" in */resourcegroups/"$GROUP"/*|"") continue ;; esac',
    '    case "$TYPES" in *" ${TYPE,,} "*) ;; *) continue ;; esac',
    ...storageLines,
    '    printf \'%s\\t%s\\t%s\\n\' "$ID" "${LOCATION,,}" resource',
    '  done < "$LIST" > "$KNOWN"',
    "  REGIONS=$(cut -f2 \"$KNOWN\" | grep -v '^global$' | sort -u)",
    "  FIRST=$(printf '%s\\n' $REGIONS | head -1)",
    "  FIRST=${FIRST:-" + AZURE_CLOUD_STREAM_FALLBACK_REGION + "}",
    // The group of event hubs, and the app's one role: reading them.
    '  az group create --subscription "$HOST" --name "$GROUP" --location "$FIRST" --tags ' +
      tag +
      ' --output none || { echo "The resource group could not be made."; ' +
      cleanUp +
      "; return 1; }",
    '  az role assignment create --assignee "$APP" --role ' +
      role +
      ' --scope "/subscriptions/$HOST/resourceGroups/$GROUP" --output none 2> /dev/null || az role assignment list --assignee "$APP" --role ' +
      role +
      ' --scope "/subscriptions/$HOST/resourceGroups/$GROUP" --query "[0].id" --output tsv | grep -q . || { echo "The app could not be given ' +
      AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE +
      ' on the resource group."; ' +
      cleanUp +
      "; return 1; }",
    // An event hub in each region: diagnostic settings send only to their own region's.
    "  for REGION in ${REGIONS:-$FIRST}; do",
    '    az eventhubs namespace show --subscription "$HOST" --resource-group "$GROUP" --name "$PREFIX$REGION" --output none 2> /dev/null || az eventhubs namespace create --subscription "$HOST" --resource-group "$GROUP" --name "$PREFIX$REGION" --location "$REGION" --sku ' +
      AZURE_CLOUD_STREAM_SKU +
      " --capacity 1 --tags " +
      tag +
      ' --output none || { echo "$REGION: the Event Hubs namespace could not be made, so its resources are left out."; continue; }',
    '    az eventhubs eventhub show --subscription "$HOST" --resource-group "$GROUP" --namespace-name "$PREFIX$REGION" --name "$HUB" --output none 2> /dev/null || az eventhubs eventhub create --subscription "$HOST" --resource-group "$GROUP" --namespace-name "$PREFIX$REGION" --name "$HUB" --partition-count ' +
      AZURE_CLOUD_STREAM_PARTITIONS +
      ' --output none || { echo "$REGION: the event hub could not be made, so its resources are left out."; continue; }',
    '    echo "$REGION: event hub ready."',
    "  done",
    // A diagnostic setting on each resource, a few at a time.
    "  oneuptime_stream_resource() {",
    '    local ERROR RULE="/subscriptions/$HOST/resourceGroups/$GROUP/providers/Microsoft.EventHub/namespaces/$PREFIX$2/authorizationRules/' +
      AZURE_EVENT_HUBS_SEND_RULE +
      '"',
    ...tryLines,
    "    printf 'skipped\\t%s\\t%s\\n' \"$1\" \"$(printf '%s' \"$ERROR\" | grep -v '^$' | head -1)\"",
    "  }",
    "  while IFS=$'\\t' read -r ID REGION SCOPE; do",
    '    if [ "$REGION" = global ]; then REGION=$FIRST; fi',
    '    oneuptime_stream_resource "$ID" "$REGION" "$SCOPE" >> "$RESULTS" &',
    "    N=$((N + 1))",
    "    if [ $((N % " +
      AZURE_CLOUD_STREAM_PARALLEL +
      ")) -eq 0 ]; then wait; fi",
    '  done < "$KNOWN"',
    "  wait",
    "  DONE=$(grep -c '^ok$' \"$RESULTS\")",
    "  SKIPPED=$(grep -c '^skipped' \"$RESULTS\")",
    '  echo "Diagnostic settings: $DONE resources send to OneUptime\'s event hubs."',
    '  if [ "$SKIPPED" -gt 0 ]; then',
    '    echo "$SKIPPED resources were left out: they have no diagnostic settings, or Azure refused:"',
    "    grep '^skipped' \"$RESULTS\" | head -" +
      AZURE_CLOUD_STREAM_SKIPPED_SHOWN +
      " | cut -f2-",
    "  fi",
    ...activityLogLines,
    "  " + cleanUp,
    "  echo " + quoteForShell(AZURE_CLOUD_STREAM_COMMAND_DONE),
    "}",
    "oneuptime_stream || echo " +
      quoteForShell(AZURE_CLOUD_STREAM_COMMAND_STOPPED),
  ].join("\n");
}

// The tenant's diagnostic setting of this name, relative to Resource Manager's endpoint.
function getEntraIdSettingPath(diagnosticSetting: string): string {
  return `${AZURE_ENTRA_ID_DIAGNOSTIC_SETTINGS_PATH}/${diagnosticSetting}?api-version=${AZURE_ENTRA_ID_DIAGNOSTIC_SETTINGS_API_VERSION}`;
}

/*
 * Microsoft Entra ID's logs into the stream (#10111): the tenant's own
 * diagnostic setting (microsoft.aadiam/diagnosticSettings), sending the
 * categories Security Events reads to the first region's event hub - the
 * first of the group's namespaces by name, the one the stream's command
 * sends the Activity Log to. Only a Security Administrator of the tenant
 * may make it, and they need the event hubs' key too, so it is a command
 * of its own, for whoever is one, run once the event hubs are there. `az
 * rest` takes the path relative to the shell's own Azure cloud.
 */
export function getAzureCloudStreamEntraCommand(data: {
  connectionId: string;
  // The subscription the event hubs are in.
  hostSubscriptionId: string;
}): string {
  const names: AzureCloudStreamNames = getAzureCloudStreamNames(
    data.connectionId,
  );
  const host: string = readSubscriptions([data.hostSubscriptionId])[0] || "";

  return [
    "oneuptime_stream_entra() {",
    "  local HOST=" + quoteForShell(host),
    "  local GROUP=" + names.resourceGroup,
    "  local PREFIX=" + names.namespacePrefix,
    "  local HUB=" + names.eventHub,
    "  local SETTING=" + names.diagnosticSetting,
    "  local LOGS=" + quoteForShell(AZURE_DIAGNOSTIC_ENTRA_ID_LOGS),
    "  local NAMESPACE BODY ERROR",
    "  oneuptime_stream_refused() {",
    ...refusedLines({
      takes: `Only a ${AZURE_ENTRA_ID_SETTINGS_ROLE} of the tenant may: run this as one.`,
    }),
    "  }",
    // The first region's namespace, as the stream's command names it.
    '  NAMESPACE=$(az eventhubs namespace list --subscription "$HOST" --resource-group "$GROUP" --query "sort_by([?starts_with(name, \'$PREFIX\')], &name)[0].name" --output tsv 2> /dev/null)',
    '  if [ -z "$NAMESPACE" ]; then echo "The stream\'s event hubs are not in $GROUP yet: run the stream\'s command first."; return 1; fi',
    '  BODY="{\\"properties\\":{\\"eventHubAuthorizationRuleId\\":\\"/subscriptions/$HOST/resourceGroups/$GROUP/providers/Microsoft.EventHub/namespaces/$NAMESPACE/authorizationRules/' +
      AZURE_EVENT_HUBS_SEND_RULE +
      '\\",\\"eventHubName\\":\\"$HUB\\",\\"logs\\":$LOGS}}"',
    '  ERROR=$(az rest --method put --url "' +
      getEntraIdSettingPath("$SETTING") +
      '" --body "$BODY" --output none 2>&1) && { echo "Microsoft Entra ID\'s logs send to the $NAMESPACE event hub."; return 0; }',
    '  oneuptime_stream_refused "Microsoft Entra ID\'s logs are left out" "$ERROR"',
    "  return 1",
    "}",
    "oneuptime_stream_entra || echo " +
      quoteForShell(AZURE_CLOUD_STREAM_COMMAND_STOPPED),
  ].join("\n");
}

/*
 * Stopping for good: each resource's diagnostic setting deleted - a
 * storage account's services' too - and each subscription's Activity Log
 * setting, then the resource group - every event hub in it, and the app's
 * role on it - in whichever of the subscriptions holds it: the one the
 * event hubs were made in need not be the first listed now. Microsoft
 * Entra ID's setting, when the tenant has one of this name, is deleted
 * too - or, for whoever may not, said who may. What was streamed stays in
 * OneUptime.
 */
export function getAzureCloudStreamDeleteCommand(data: {
  connectionId: string;
  subscriptionIds: Array<string>;
}): string {
  const names: AzureCloudStreamNames = getAzureCloudStreamNames(
    data.connectionId,
  );
  const subscriptions: string = readSubscriptions(data.subscriptionIds)
    .map(quoteForShell)
    .join(" ");
  const entraSetting: string = getEntraIdSettingPath(names.diagnosticSetting);
  const deleteSetting: (target: string) => Array<string> = (
    target: string,
  ): Array<string> => {
    return [
      `      az monitor diagnostic-settings delete --name ${names.diagnosticSetting} --resource "${target}" --output none 2> /dev/null &`,
      "      N=$((N + 1))",
      `      if [ $((N % ${AZURE_CLOUD_STREAM_PARALLEL})) -eq 0 ]; then wait; fi`,
    ];
  };

  return [
    "oneuptime_stream_stop() {",
    "  local SUB ID TYPE SERVICE N=0",
    `  for SUB in ${subscriptions}; do`,
    "    while IFS=$'\\t' read -r ID TYPE; do",
    '      if [ -z "$ID" ]; then continue; fi',
    ...deleteSetting("$ID"),
    `      if [ "\${TYPE,,}" = ${AZURE_STORAGE_ACCOUNT_TYPE} ]; then`,
    `        for SERVICE in ${AZURE_STORAGE_SERVICES.join(" ")}; do`,
    ...deleteSetting("$ID/$SERVICE/default").map((line: string): string => {
      return `    ${line}`;
    }),
    "        done",
    "      fi",
    '    done < <(az resource list --subscription "$SUB" --query "[].[id, type]" --output tsv)',
    `    az monitor diagnostic-settings subscription delete --subscription "$SUB" --name ${names.diagnosticSetting} --yes --output none 2> /dev/null`,
    "  done",
    "  wait",
    `  if az rest --method get --url "${entraSetting}" --output none 2> /dev/null; then`,
    `    az rest --method delete --url "${entraSetting}" --output none 2> /dev/null && echo "Deleted Microsoft Entra ID's diagnostic setting ${names.diagnosticSetting}." || echo "Microsoft Entra ID's diagnostic setting ${names.diagnosticSetting} is left: a ${AZURE_ENTRA_ID_SETTINGS_ROLE} of the tenant deletes it, under Diagnostic settings in the Microsoft Entra admin center."`,
    "  fi",
    `  for SUB in ${subscriptions}; do`,
    `    if [ "$(az group exists --subscription "$SUB" --name ${names.resourceGroup} 2> /dev/null)" = true ]; then`,
    `      az group delete --subscription "$SUB" --name ${names.resourceGroup} --yes --no-wait && echo "Deleting ${names.resourceGroup} in $SUB."`,
    "    fi",
    "  done",
    "}",
    "oneuptime_stream_stop",
  ].join("\n");
}
