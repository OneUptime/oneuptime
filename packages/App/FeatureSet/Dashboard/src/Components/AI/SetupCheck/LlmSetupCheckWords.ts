import OneUptimeDate from "Common/Types/Date";
import {
  getLlmConnectionDefinition,
  getLlmConnectionTitle,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import { LlmConnectionFailureKind } from "Common/Types/LlmObservability/LlmConnectionTest";
import { getLlmProviderTitle } from "Common/Types/Telemetry/LlmProviders";
import {
  LLM_METRIC_SOURCE_TITLES,
  LlmEmptyViewFinding,
  LlmEmptyViewFindingKey,
  LlmMetricSource,
  LlmSetupCheckApps,
  LlmSetupCheckConnection,
  LlmSetupCheckMetricSource,
  LlmSetupCheckResponse,
  LlmSetupCheckUninstrumentedCalls,
} from "Common/Types/Telemetry/LlmSetupCheckApi";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  PluralTemplate,
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import { formatLlmUsageDay } from "../Connect/LlmConnectionHealth";
import {
  LlmConnectionTestWords,
  getLlmConnectionReadFailureWords,
} from "../Connect/LlmConnectionTestWords";

/*
 * WHAT THE AI / LLM SETUP CHECK SAYS, IN THE READER'S WORDS.
 *
 * Pure: the empty Conversations and Calls views (LlmEmptyViewDiagnosis) and
 * the Connect page's Setup check card (LlmSetupCheckCard) build their
 * sentences here, with the reader's translator, so a test can read every
 * one of them in English or any locale without rendering a page.
 *
 * Every English sentence is a translation key, and a sentence with values
 * is translated whole: the values (a time, a count, a list of names) go
 * into it, never the other way round.
 */

export type LlmEmptyView = "conversations" | "calls";

// What an empty view's buttons do.
export type LlmEmptyViewAction =
  | "send-calls"
  | "widen-range"
  | "open-connect"
  | "see-usage"
  | "see-provider-usage";

export interface LlmEmptyViewWords {
  // A heading, as a translation key: the empty state translates it.
  title: string;
  // The sentence, already in the reader's language.
  description: string;
  primary: LlmEmptyViewAction;
  secondary?: LlmEmptyViewAction | undefined;
  // widen-range: the range that holds the newest call.
  widenTo?: { range: TimeRange; startTime?: Date | undefined } | undefined;
}

export const NO_CALLS_IN_RANGE_TITLE: Record<LlmEmptyView, string> = {
  conversations: translationKey("No conversations in this time range"),
  calls: translationKey("No AI calls in this time range"),
};

export const COME_FROM_APPS_TITLE: Record<LlmEmptyView, string> = {
  conversations: translationKey("Conversations come from your apps"),
  calls: translationKey("AI calls come from your apps"),
};

export const NEWEST_CALL_WAS: string = translationKey(
  "Your apps' newest AI call was {{time}}.",
);

export const UNINSTRUMENTED_TITLE: string = translationKey(
  "Your app's AI calls aren't recorded",
);

export const UNINSTRUMENTED_SENTENCE: PluralTemplate = {
  one: "{{service}} called {{host}} once in the past day, and no GenAI instrumentation recorded the call. Add one, and every AI call arrives with its model, tokens and cost.",
  other:
    "{{service}} called {{host}} {{count}} times in the past day, and no GenAI instrumentation recorded those calls. Add one, and every AI call arrives with its model, tokens and cost.",
};

export const ONE_OF_YOUR_APPS: string = translationKey("One of your apps");

// In a list of apps: the apps it does not name.
export const OTHER_APPS: string = translationKey("other apps");

// In a list of apps, when it can name none of them.
export const YOUR_APPS: string = translationKey("your apps");

export const TOOL_NOT_WORKING_TITLE: string = translationKey(
  "{{tool}} isn't working",
);

export const TOOL_NOT_WORKING_SENTENCE: string = translationKey(
  "Its last read failed, so no chats were read. Connect says why.",
);

export const TOOLS_QUIET_TITLE: string = translationKey(
  "No chats in this time range",
);

export const TOOLS_QUIET_SENTENCE: PluralTemplate = {
  one: "{{tools}} is connected and read every 15 minutes: its chats show here as people use it.",
  other:
    "{{tools}} are connected and read every 15 minutes: their chats show here as people use them.",
};

/*
 * Under "Conversations come from your apps": what the accounts or tools do
 * bring, and that no app has sent a call. The heading already says where
 * calls come from, so the sentence does not say it again; the buttons under
 * it say where the usage shows.
 */
export const PROVIDER_ACCOUNTS_ONLY_SENTENCE: PluralTemplate = {
  one: "Your connected provider account reports usage and cost by day, never a call or a conversation. None of your apps has sent an AI call in the past 7 days.",
  other:
    "Your {{count}} connected provider accounts report usage and cost by day, never a call or a conversation. None of your apps has sent an AI call in the past 7 days.",
};

export const CODING_TOOLS_ONLY_SENTENCE: PluralTemplate = {
  one: "{{tools}} sends usage metrics, never a call or a conversation. None of your apps has sent an AI call in the past 7 days.",
  other:
    "{{tools}} send usage metrics, never a call or a conversation. None of your apps has sent an AI call in the past 7 days.",
};

export const NOTHING_TITLE: Record<LlmEmptyView, string> = {
  conversations: translationKey("No AI conversations here yet"),
  calls: translationKey("No AI calls here yet"),
};

export const NOTHING_SENTENCE: Record<LlmEmptyView, string> = {
  conversations: translationKey(
    "Conversations appear as AI calls arrive: from your own apps, or from your company's AI tools, such as Claude Enterprise and Microsoft 365 Copilot.",
  ),
  calls: translationKey(
    "Every AI call your apps send shows here: its model, tokens, cost, time and errors, with the app and the person that made it.",
  ),
};

// The buttons' words.
export const ACTION_TITLES: Record<LlmEmptyViewAction, string> = {
  "send-calls": translationKey("Send your app's AI calls"),
  "widen-range": translationKey("Show the past month"),
  "open-connect": translationKey("Open Connect"),
  "see-usage": translationKey("See usage"),
  "see-provider-usage": translationKey("See provider usage"),
};

export const WIDEN_TITLES: Partial<Record<TimeRange, string>> = {
  [TimeRange.PAST_ONE_WEEK]: translationKey("Show the past week"),
  [TimeRange.PAST_ONE_MONTH]: translationKey("Show the past month"),
  [TimeRange.PAST_THREE_MONTHS]: translationKey("Show the past 3 months"),
};

export const WIDEN_FROM_TITLE: string = translationKey("Show from {{date}}");

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * The smallest of the picker's ranges that holds a call made at `newest`:
 * the past week, month or three months - or, for an older one, a range
 * from the day before it.
 */
export function getRangeHolding(
  newest: Date,
  now: Date,
): { range: TimeRange; startTime?: Date | undefined } {
  const age: number = now.getTime() - newest.getTime();

  if (age < 7 * DAY_IN_MS) {
    return { range: TimeRange.PAST_ONE_WEEK };
  }

  if (age < 30 * DAY_IN_MS) {
    return { range: TimeRange.PAST_ONE_MONTH };
  }

  if (age < 90 * DAY_IN_MS) {
    return { range: TimeRange.PAST_THREE_MONTHS };
  }

  return {
    range: TimeRange.CUSTOM,
    startTime: new Date(newest.getTime() - DAY_IN_MS),
  };
}

// A metric source as the product names it.
export function getLlmMetricSourceTitle(source: LlmMetricSource): string {
  return LLM_METRIC_SOURCE_TITLES[source] || source;
}

// A connection as a sentence names it: what it is, not what it was called.
export function getConnectionKindTitle(
  connection: LlmSetupCheckConnection,
): string {
  return getLlmConnectionTitle(connection.provider as LlmConnectionProvider);
}

export function getLlmEmptyViewWords(data: {
  finding: LlmEmptyViewFinding;
  view: LlmEmptyView;
  translator: Translator;
  // The app's name, from its id; "" when unknown.
  serviceName: (serviceId: string) => string;
  now: Date;
}): LlmEmptyViewWords {
  const { finding, view, translator } = data;

  switch (finding.key) {
    case LlmEmptyViewFindingKey.CallsOutsideWindow: {
      const newest: Date = new Date(finding.newestCallAt || 0);
      const widenTo: { range: TimeRange; startTime?: Date | undefined } =
        getRangeHolding(newest, data.now);

      return {
        title: NO_CALLS_IN_RANGE_TITLE[view],
        description: translator.translateTemplate(NEWEST_CALL_WAS, {
          time: OneUptimeDate.fromNow(newest, data.now),
        }),
        primary: "widen-range",
        widenTo: widenTo,
      };
    }

    case LlmEmptyViewFindingKey.Uninstrumented: {
      const calls: LlmSetupCheckUninstrumentedCalls | undefined =
        finding.uninstrumented;
      const service: string =
        (calls && data.serviceName(calls.serviceId)) ||
        translator.translateText(ONE_OF_YOUR_APPS) ||
        ONE_OF_YOUR_APPS;

      return {
        title: UNINSTRUMENTED_TITLE,
        description: translator.translatePlural(
          UNINSTRUMENTED_SENTENCE,
          calls?.calls || 0,
          { service: service, host: calls?.host || "" },
        ),
        primary: "send-calls",
      };
    }

    case LlmEmptyViewFindingKey.CompanyToolsQuiet: {
      const tools: Array<LlmSetupCheckConnection> = finding.connections || [];
      const failing: LlmSetupCheckConnection | undefined = tools.find(
        (tool: LlmSetupCheckConnection): boolean => {
          return isConnectionFailing(tool);
        },
      );

      if (failing) {
        return {
          title: translator.translateTemplate(TOOL_NOT_WORKING_TITLE, {
            tool: getConnectionKindTitle(failing),
          }),
          description:
            translator.translateText(TOOL_NOT_WORKING_SENTENCE) ||
            TOOL_NOT_WORKING_SENTENCE,
          primary: "open-connect",
        };
      }

      const titles: Array<string> = uniqueTitles(tools);

      return {
        title: TOOLS_QUIET_TITLE,
        description: translator.translatePlural(
          TOOLS_QUIET_SENTENCE,
          titles.length,
          {
            tools: composedValue((sentence: Translator): string => {
              return formatNameList(titles, "and", sentence);
            }),
          },
        ),
        primary: "widen-range",
        widenTo: { range: TimeRange.PAST_ONE_MONTH },
        secondary: "send-calls",
      };
    }

    case LlmEmptyViewFindingKey.ProviderAccountsOnly: {
      const count: number = (finding.connections || []).length;

      return {
        title: COME_FROM_APPS_TITLE[view],
        description: translator.translatePlural(
          PROVIDER_ACCOUNTS_ONLY_SENTENCE,
          count,
        ),
        primary: "send-calls",
        secondary: "see-provider-usage",
      };
    }

    case LlmEmptyViewFindingKey.CodingToolsOnly: {
      const titles: Array<string> = (finding.metricSources || []).map(
        (source: LlmMetricSource): string => {
          return getLlmMetricSourceTitle(source);
        },
      );

      return {
        title: COME_FROM_APPS_TITLE[view],
        description: translator.translatePlural(
          CODING_TOOLS_ONLY_SENTENCE,
          titles.length,
          {
            tools: composedValue((sentence: Translator): string => {
              return formatNameList(titles, "and", sentence);
            }),
          },
        ),
        primary: "see-usage",
        secondary: "send-calls",
      };
    }

    case LlmEmptyViewFindingKey.Nothing:
    default:
      return {
        title: NOTHING_TITLE[view],
        description:
          translator.translateText(NOTHING_SENTENCE[view]) ||
          NOTHING_SENTENCE[view],
        primary: "send-calls",
      };
  }
}

// The words of a range-widening button.
export function getWidenTitle(
  widenTo: { range: TimeRange; startTime?: Date | undefined },
  translator: Translator,
): string {
  const title: string | undefined = WIDEN_TITLES[widenTo.range];

  if (title) {
    return translator.translateText(title) || title;
  }

  return translator.translateTemplate(WIDEN_FROM_TITLE, {
    date: OneUptimeDate.getDateAsCompactLocalString(
      widenTo.startTime || new Date(),
      { onlyShowDate: true },
    ),
  });
}

function uniqueTitles(
  connections: Array<LlmSetupCheckConnection>,
): Array<string> {
  return Array.from(
    new Set<string>(
      connections.map((connection: LlmSetupCheckConnection): string => {
        return getConnectionKindTitle(connection);
      }),
    ),
  );
}

/*
 * A connection's state, by the rule the Connect page's list uses
 * (LlmConnectionHealth): a read that failed after the last good one.
 */
export function isConnectionFailing(
  connection: LlmSetupCheckConnection,
): boolean {
  if (!connection.isEnabled || !connection.lastError) {
    return false;
  }

  const lastRead: number = Date.parse(connection.lastReadAt || "");
  const lastGood: number = Date.parse(connection.lastSuccessfulReadAt || "");

  return (
    !Number.isFinite(lastGood) ||
    (Number.isFinite(lastRead) && lastRead > lastGood)
  );
}

/*
 * THE CONNECT PAGE'S SETUP CHECK: one line per finding, in the reader's
 * words, with how it stands: ok, a warning, not working, waiting for a
 * first read, or off (not set up, turned off, or not known).
 */

export type LlmSetupCheckTone = "ok" | "warning" | "off" | "error" | "waiting";

export interface LlmSetupCheckLine {
  key: string;
  tone: LlmSetupCheckTone;
  text: string;
  // A muted second line: what this means, or what to do.
  detail?: string | undefined;
  /*
   * A failed read's own words, as the provider or the server wrote them
   * (untranslated, secrets removed before they were stored): shown apart
   * from the sentence, only when the product has no words for the failure.
   */
  error?: string | undefined;
}

// The whole check, when nothing is set up and nothing arrives.
export const NOTHING_COMING_IN: string = translationKey(
  "Nothing is coming in yet. Pick a way below to bring AI in.",
);

// A failed read the product has no words for.
export const CONNECTION_READ_FAILED: string = translationKey(
  "Its last read failed",
);

export const APPS_RECEIVING: PluralTemplate = {
  one: "{{count}} AI call in the past 7 days, from {{apps}}.",
  other: "{{count}} AI calls in the past 7 days, from {{apps}}.",
};

export const APPS_THROUGH_PROVIDERS: string = translationKey(
  "Through {{providers}}. The newest arrived {{time}}.",
);

export const APPS_QUIET: string = translationKey(
  "No AI calls in the past 7 days. The newest arrived {{time}}.",
);

export const APPS_NONE: string = translationKey(
  "No app has sent an AI call yet. Calls and conversations come from your apps.",
);

export const CONTENT_NOT_RECORDED: string = translationKey(
  "Prompts and answers aren't recorded, so conversations show each call's time, tokens and cost but not what was said.",
);

export const CONTENT_IN_LOGS: string = translationKey(
  "Your app sends them as log records, which conversations don't read: record them on the spans instead.",
);

export const CONTENT_HOW: string = translationKey(
  "Turn on your instrumentation's content capture. Prompts can hold personal data: scrub rules mask it before it is stored.",
);

export const CONTENT_SHARE: string = translationKey(
  "Prompts and answers recorded on {{share}} of answers.",
);

export const METRICS_RECEIVING: PluralTemplate = {
  one: "{{tools}} sends usage metrics. The newest arrived {{time}}.",
  other: "{{tools}} send usage metrics. The newest arrived {{time}}.",
};

export const METRICS_WHERE: string = translationKey(
  "They show on Usage: who uses what, and what it costs. Coding assistants send no conversations.",
);

export const ACCOUNTS_NONE: string = translationKey(
  "None connected. An account brings its usage and cost by day, with no code.",
);

export const TOOLS_NONE: string = translationKey(
  "None connected. A company AI tool brings what your people ask it, by person.",
);

export const CONNECTION_OFF: string = translationKey("Turned off");
export const CONNECTION_WAITING: string = translationKey(
  "Waiting for the first read",
);
export const CONNECTION_LAST_USED: string = translationKey(
  "Read {{time}}. Last used {{date}}.",
);
export const CONNECTION_NO_RESOURCES: string = translationKey(
  "Read {{time}}. No Azure OpenAI or Foundry resource found: give the app registration the Monitoring Reader role where they are.",
);
export const CONNECTION_NO_USAGE_SINCE: string = translationKey(
  "Read {{time}}. No usage since {{date}}.",
);
export const CONNECTION_NO_USAGE: string = translationKey(
  "Read {{time}}. No usage yet.",
);
export const TOOL_CHATS: PluralTemplate = {
  one: "Read {{time}}. {{count}} chat in the past 7 days.",
  other: "Read {{time}}. {{count}} chats in the past 7 days.",
};

/*
 * What each provider account's reads cover, for the reader who expected
 * something else in them: OpenAI's reports leave out Azure OpenAI, and
 * Azure's need a role where the resources are.
 */
export const PROVIDER_READS: Partial<Record<LlmConnectionProvider, string>> = {
  [LlmConnectionProvider.OpenAI]: translationKey(
    "Reads the usage of API calls made with your OpenAI organization's keys. Azure OpenAI and ChatGPT use are not in it.",
  ),
  [LlmConnectionProvider.AzureOpenAI]: translationKey(
    "Reads Azure Monitor's token counts of every Azure OpenAI and Foundry resource the app registration can see.",
  ),
  [LlmConnectionProvider.Anthropic]: translationKey(
    "Reads the usage of Claude API calls made with your organization's keys. Claude.ai chats are not in it.",
  ),
  [LlmConnectionProvider.AwsBedrock]: translationKey(
    "Reads CloudWatch's Bedrock metrics in the Regions you named.",
  ),
  [LlmConnectionProvider.GoogleVertexAI]: translationKey(
    "Reads Cloud Monitoring's Vertex AI metrics of the project.",
  ),
  [LlmConnectionProvider.Cursor]: translationKey(
    "Reads the requests of your Cursor team's members with Cursor's Admin API, an hour at a time: the newest hour arrives with the next read.",
  ),
};

/*
 * A Cursor team read with an Admin API key whose OpenTelemetry Export
 * arrives as well: the same requests, counted twice over if anything added
 * the two. Nothing does - Usage keeps them apart and a budget counts one -
 * and the account's line says so, so nobody adds them up by hand.
 */
export const CURSOR_BOTH_WAYS: string = translationKey(
  "Cursor's OpenTelemetry Export arrives too. Usage shows it under Your AI calls and this account under Provider accounts, never added together, and a budget counts one of them.",
);

/*
 * The apps a sentence names: up to three by name; with more, or with one
 * the reader cannot name, the first two and "other apps"; "your apps" when
 * it can name none. Never "One of your apps" mid-sentence, never three
 * names as if they were all.
 */
export function getAppNames(data: {
  serviceIds: Array<string>;
  serviceName: (serviceId: string) => string;
  translator: Translator;
}): Array<string> {
  const names: Array<string> = [];
  let unnamed: number = 0;

  for (const serviceId of data.serviceIds) {
    const name: string = data.serviceName(serviceId) || "";

    if (!name) {
      unnamed++;
    } else if (!names.includes(name)) {
      names.push(name);
    }
  }

  if (names.length === 0) {
    return [data.translator.translateText(YOUR_APPS) || YOUR_APPS];
  }

  if (names.length > 3 || unnamed > 0) {
    return [
      ...names.slice(0, 2),
      data.translator.translateText(OTHER_APPS) || OTHER_APPS,
    ];
  }

  return names;
}

export function getAppsLines(data: {
  apps: LlmSetupCheckApps;
  translator: Translator;
  serviceName: (serviceId: string) => string;
  now: Date;
}): Array<LlmSetupCheckLine> {
  const { apps, translator } = data;
  const lines: Array<LlmSetupCheckLine> = [];

  if (apps.callsRecently > 0) {
    const appNames: Array<string> = getAppNames({
      serviceIds: apps.services.map((service: { serviceId: string }) => {
        return service.serviceId;
      }),
      serviceName: data.serviceName,
      translator,
    });

    const providerNames: Array<string> = apps.providers
      .filter((provider: { name: string }): boolean => {
        return Boolean(provider.name);
      })
      .slice(0, 3)
      .map((provider: { name: string }): string => {
        return getLlmProviderTitle(provider.name);
      });

    lines.push({
      key: "apps-receiving",
      tone: "ok",
      text: translator.translatePlural(APPS_RECEIVING, apps.callsRecently, {
        apps: composedValue((sentence: Translator): string => {
          return formatNameList(appNames, "and", sentence);
        }),
      }),
      detail:
        providerNames.length > 0 && apps.newestCallAt
          ? translator.translateTemplate(APPS_THROUGH_PROVIDERS, {
              providers: composedValue((sentence: Translator): string => {
                return formatNameList(providerNames, "and", sentence);
              }),
              time: OneUptimeDate.fromNow(
                new Date(apps.newestCallAt),
                data.now,
              ),
            })
          : undefined,
    });

    if (apps.answersRecently > 0 && apps.answersWithContent === 0) {
      lines.push({
        key: "apps-content",
        tone: "warning",
        text:
          translator.translateText(CONTENT_NOT_RECORDED) ||
          CONTENT_NOT_RECORDED,
        detail: apps.contentInLogs
          ? translator.translateText(CONTENT_IN_LOGS) || CONTENT_IN_LOGS
          : translator.translateText(CONTENT_HOW) || CONTENT_HOW,
      });
    } else if (apps.answersRecently > 0) {
      lines.push({
        key: "apps-content",
        tone: "ok",
        text: translator.translateTemplate(CONTENT_SHARE, {
          share: `${Math.round(
            (apps.answersWithContent / apps.answersRecently) * 100,
          )}%`,
        }),
      });
    }

    return lines;
  }

  if (apps.uninstrumented && apps.uninstrumented.length > 0) {
    const calls: LlmSetupCheckUninstrumentedCalls = apps.uninstrumented[0]!;

    lines.push({
      key: "apps-uninstrumented",
      tone: "warning",
      text: translator.translatePlural(UNINSTRUMENTED_SENTENCE, calls.calls, {
        service:
          data.serviceName(calls.serviceId) ||
          translator.translateText(ONE_OF_YOUR_APPS) ||
          ONE_OF_YOUR_APPS,
        host: calls.host,
      }),
    });

    return lines;
  }

  if (apps.newestCallAt) {
    lines.push({
      key: "apps-quiet",
      tone: "warning",
      text: translator.translateTemplate(APPS_QUIET, {
        time: OneUptimeDate.fromNow(new Date(apps.newestCallAt), data.now),
      }),
    });

    return lines;
  }

  lines.push({
    key: "apps-none",
    tone: "off",
    text: translator.translateText(APPS_NONE) || APPS_NONE,
  });

  return lines;
}

/*
 * A date that ends with its own full stop ("9. Okt." in German, "9 okt." in
 * Dutch and Swedish) ends a sentence with that one stop, never two.
 */
export function withOneStop(text: string, value: string): string {
  if (!value || !value.endsWith(".")) {
    return text;
  }

  return text.split(`${value}.`).join(value);
}

/*
 * Nothing set up and nothing arriving: no app has sent an AI call within
 * retention or calls an AI API unrecorded, no metrics arrive, and nothing is
 * connected. The card then says so in one line, above the three ways in. A
 * part that could not be read is not "nothing".
 */
export function isLlmSetupCheckQuiet(check: LlmSetupCheckResponse): boolean {
  const apps: LlmSetupCheckApps | null = check.apps;

  if (!apps || check.metrics === null || check.connections === null) {
    return false;
  }

  return (
    apps.callsRecently === 0 &&
    (apps.callsInWindow ?? 0) === 0 &&
    !apps.newestCallAt &&
    (apps.uninstrumented || []).length === 0 &&
    check.metrics.every((metric: LlmSetupCheckMetricSource): boolean => {
      return metric.points === 0;
    }) &&
    check.connections.length === 0
  );
}

export function getConnectionLine(data: {
  connection: LlmSetupCheckConnection;
  translator: Translator;
  now: Date;
  /*
   * The coding assistants' metrics the check found (Cursor's OpenTelemetry
   * Export among them): a Cursor account's line then says the two are
   * kept apart.
   */
  metricSources?: Array<LlmSetupCheckMetricSource> | null | undefined;
}): LlmSetupCheckLine {
  const { connection, translator } = data;
  const key: string = `connection-${connection.connectionId}`;
  const readAt: string = connection.lastSuccessfulReadAt || "";
  const time: string = readAt
    ? OneUptimeDate.fromNow(new Date(readAt), data.now)
    : "";

  if (!connection.isEnabled) {
    return {
      key,
      tone: "off",
      text: translator.translateText(CONNECTION_OFF) || CONNECTION_OFF,
    };
  }

  if (isConnectionFailing(connection)) {
    /*
     * What failed, in the words the connection's View error and its test
     * use ("The key or secret was not accepted.") and what to do about it.
     * Only a failure the product has no words for shows the provider's own
     * text - set apart, as it is English and often JSON.
     */
    const failure: LlmConnectionTestWords | undefined =
      getLlmConnectionReadFailureWords({
        definition: getLlmConnectionDefinition(connection.provider),
        lastPullResult: connection.failureKind
          ? { failureKind: connection.failureKind }
          : undefined,
      });

    if (failure) {
      return {
        key,
        tone: "error",
        text: translator.translateText(failure.headline) || failure.headline,
        detail: failure.advice
          ? translator.translateText(failure.advice) || failure.advice
          : undefined,
        /*
         * "Fix the setting named below": the server's words name it, so a
         * settings failure keeps them under its advice.
         */
        error:
          connection.failureKind === LlmConnectionFailureKind.Settings &&
          connection.lastError
            ? connection.lastError
            : undefined,
      };
    }

    return {
      key,
      tone: "error",
      text:
        translator.translateText(CONNECTION_READ_FAILED) ||
        CONNECTION_READ_FAILED,
      error: connection.lastError || undefined,
    };
  }

  if (!readAt) {
    return {
      key,
      tone: "waiting",
      text: translator.translateText(CONNECTION_WAITING) || CONNECTION_WAITING,
    };
  }

  if (connection.kind === "company-tool") {
    return {
      key,
      tone: "ok",
      text: translator.translatePlural(
        TOOL_CHATS,
        connection.callsRecently || 0,
        { time },
      ),
    };
  }

  /*
   * What the account's reads cover, said where it explains something: on
   * an account that reads no usage ("Azure OpenAI and ChatGPT use are not
   * in it"), not under every working one.
   */
  const detail: string | undefined =
    PROVIDER_READS[connection.provider as LlmConnectionProvider];
  const translatedDetail: string | undefined = detail
    ? translator.translateText(detail) || detail
    : undefined;

  /*
   * Both of Cursor's ways in at once: said on the account's line whatever
   * its reads found, before what its reads cover.
   */
  const bothWays: string | undefined =
    connection.provider === LlmConnectionProvider.Cursor &&
    (data.metricSources || []).some(
      (metric: LlmSetupCheckMetricSource): boolean => {
        return metric.source === LlmMetricSource.Cursor && metric.points > 0;
      },
    )
      ? translator.translateText(CURSOR_BOTH_WAYS) || CURSOR_BOTH_WAYS
      : undefined;

  /*
   * Before the day of the last usage: a read that found no resource reads
   * nothing now, even when an earlier read - before the role was taken
   * away - found usage.
   */
  if (connection.resources === 0) {
    return {
      key,
      tone: "warning",
      text: translator.translateTemplate(CONNECTION_NO_RESOURCES, { time }),
    };
  }

  if (connection.newestUsageAt) {
    const date: string = formatLlmUsageDay(connection.newestUsageAt);

    return {
      key,
      tone: "ok",
      text: withOneStop(
        translator.translateTemplate(CONNECTION_LAST_USED, { time, date }),
        date,
      ),
      ...(bothWays ? { detail: bothWays } : {}),
    };
  }

  if (connection.readSince) {
    const date: string = formatLlmUsageDay(connection.readSince);

    return {
      key,
      tone: "warning",
      text: withOneStop(
        translator.translateTemplate(CONNECTION_NO_USAGE_SINCE, {
          time,
          date,
        }),
        date,
      ),
      detail: bothWays || translatedDetail,
    };
  }

  return {
    key,
    tone: "warning",
    text: translator.translateTemplate(CONNECTION_NO_USAGE, { time }),
    detail: bothWays || translatedDetail,
  };
}
