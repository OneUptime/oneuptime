import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import {
  LlmMetricSource,
  LlmSetupCheckConnection,
  LlmSetupCheckMetricSource,
  LlmSetupCheckResponse,
} from "Common/Types/Telemetry/LlmSetupCheckApi";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import { LlmConnectWayKey } from "../Connect/LlmConnectWays";
import LlmConnectionLogo from "../Connect/LlmConnectionLogo";
import {
  ACCOUNTS_NONE,
  LlmSetupCheckLine,
  LlmSetupCheckTone,
  METRICS_RECEIVING,
  METRICS_WHERE,
  NOTHING_COMING_IN,
  TOOLS_NONE,
  getAppsLines,
  getConnectionLine,
  getLlmMetricSourceTitle,
  isLlmSetupCheckQuiet,
} from "./LlmSetupCheckWords";
import useLlmSetupCheck, { LlmSetupCheckState } from "./useLlmSetupCheck";

/*
 * AI / LLM > Connect > SETUP CHECK: what each way is sending right now, for
 * this project, in one look.
 *
 * The three ways fill different views, and a project can have one working
 * and not the others: provider accounts that read fine while no app sends
 * an AI call, apps whose prompts are not recorded, an Azure connection that
 * finds no resource. The ways' tabs below say whether each is set up; this
 * says what each is bringing in, and what is missing - your apps (AI calls,
 * the apps and providers they come from, whether what was said is
 * recorded, or the AI calls nothing records), coding assistants (usage
 * metrics), each provider account (when it was read, the last day it had
 * usage, why it has none) and each company AI tool.
 *
 * Each group is a heading, its findings, and - where something is missing -
 * the one next step under them, where the eye lands after reading. A
 * connection is a row: its name and how it stands side by side where the
 * card is wide, one under the other on a phone.
 *
 * A project with nothing set up and nothing arriving gets one line instead
 * of three "none" groups that repeat the ways right below the card.
 *
 * Read when the page opens and on "Check again" (LlmSetupCheckReader caps
 * every read, so it is cheap). While it reads again, the last answer stays.
 */

export interface ComponentProps {
  // Opens a way's path on the page, as its tab does.
  onPickWay: (key: LlmConnectWayKey) => void;
  // App names, by service id.
  serviceName: (serviceId: string) => string;
  // Bumped by the page when a connection changes.
  refreshToken?: number | undefined;
}

interface ToneStyle {
  icon: IconProp;
  className: string;
  /*
   * What the icon says, to a screen reader and on hover. A line that is off
   * or waiting says it in its own words ("Turned off", "Waiting for the
   * first read"), so its icon is decoration only.
   */
  label?: string | undefined;
}

export const LLM_SETUP_CHECK_TONES: Record<LlmSetupCheckTone, ToneStyle> = {
  ok: {
    icon: IconProp.CheckCircle,
    className: "text-emerald-600",
    label: translationKey("Working"),
  },
  warning: {
    icon: IconProp.Alert,
    className: "text-amber-500",
    label: translationKey("Needs a look"),
  },
  error: {
    icon: IconProp.Error,
    className: "text-red-600",
    label: translationKey("Not working"),
  },
  waiting: {
    icon: IconProp.Clock,
    className: "text-gray-400",
  },
  off: {
    icon: IconProp.MinusCircle,
    className: "text-gray-400",
  },
};

const SetupLine: FunctionComponent<{ line: LlmSetupCheckLine }> = (props: {
  line: LlmSetupCheckLine;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: ToneStyle = LLM_SETUP_CHECK_TONES[props.line.tone];
  const label: string | undefined = tone.label
    ? translator.translateText(tone.label) || tone.label
    : undefined;

  return (
    <div
      className="flex min-w-0 items-start gap-2"
      data-testid={`llm-setup-check-line-${props.line.key}`}
      data-tone={props.line.tone}
    >
      <div
        className="mt-0.5 flex-shrink-0"
        title={label}
        aria-hidden={label ? undefined : true}
      >
        <Icon icon={tone.icon} className={`h-4 w-4 ${tone.className}`} />
        {label ? <span className="sr-only">{label}</span> : <></>}
      </div>
      <div className="min-w-0">
        <div className="break-words text-sm text-gray-900">
          {props.line.text}
        </div>
        {props.line.detail ? (
          <div className="mt-0.5 break-words text-sm text-gray-500">
            {props.line.detail}
          </div>
        ) : (
          <></>
        )}
        {props.line.error ? (
          /*
           * The provider's own words: English, often JSON, so set apart in
           * a direction of their own and cut to two lines. The list's View
           * error has all of it.
           */
          <div
            className="mt-1 line-clamp-2 break-all font-mono text-xs text-gray-500"
            dir="auto"
            title={props.line.error}
            data-testid={`llm-setup-check-error-${props.line.key}`}
          >
            {props.line.error}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

interface GroupAction {
  title: string;
  onClick: () => void;
}

const Group: FunctionComponent<{
  title: string;
  dataTestId: string;
  children: ReactElement | Array<ReactElement>;
  action?: GroupAction | undefined;
}> = (props: {
  title: string;
  dataTestId: string;
  children: ReactElement | Array<ReactElement>;
  action?: GroupAction | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section
      className="py-4 first:pt-0 last:pb-0"
      data-testid={props.dataTestId}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {translator.translateText(props.title) || props.title}
      </h3>
      <div className="mt-2 flex flex-col gap-3">{props.children}</div>
      {props.action ? (
        /*
         * The next step, under what it answers - in line with the text,
         * past the lines' icons - at every width and in every language.
         */
        <button
          type="button"
          onClick={props.action.onClick}
          className="ml-6 mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          data-testid={`${props.dataTestId}-action`}
        >
          {translator.translateText(props.action.title) || props.action.title}
          <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
        </button>
      ) : (
        <></>
      )}
    </section>
  );
};

/*
 * A connection's row: its logo, its name, and how it stands - side by side
 * once the card is wide enough for both, so a busy project's accounts read
 * as a list; the name over its status on a phone, where a long name wraps
 * rather than being cut.
 */
const ConnectionRow: FunctionComponent<{
  connection: LlmSetupCheckConnection;
  line: LlmSetupCheckLine;
}> = (props: {
  connection: LlmSetupCheckConnection;
  line: LlmSetupCheckLine;
}): ReactElement => {
  return (
    <li
      className="flex min-w-0 items-start gap-3"
      data-testid={`llm-setup-check-connection-${props.connection.connectionId}`}
    >
      <LlmConnectionLogo
        provider={props.connection.provider as LlmConnectionProvider}
        size="sm"
      />
      <div className="min-w-0 flex-1 [@container(min-width:40rem)]:flex [@container(min-width:40rem)]:items-start [@container(min-width:40rem)]:gap-4">
        <div className="min-w-0 pt-0.5 [@container(min-width:40rem)]:w-60 [@container(min-width:40rem)]:flex-none">
          {/*
           * The name in its own direction: an English name on a Persian
           * page is cut at its end ("Azure OpenAI / Foundry (prod…"), not
           * its start, and still sits at the start of the row.
           */}
          <span
            dir="auto"
            className="inline-block max-w-full break-words align-top text-sm font-medium text-gray-900 [@container(min-width:40rem)]:truncate"
            title={props.connection.name}
            data-testid="llm-setup-check-connection-name"
          >
            {props.connection.name}
          </span>
        </div>
        <div className="mt-1 min-w-0 [@container(min-width:40rem)]:mt-0 [@container(min-width:40rem)]:flex-1 [@container(min-width:40rem)]:pt-0.5">
          <SetupLine line={props.line} />
        </div>
      </div>
    </li>
  );
};

export const SETUP_CHECK_TITLE: string = translationKey("Setup check");
export const SETUP_CHECK_DESCRIPTION: string = translationKey(
  "What each way is bringing in right now, and what is missing.",
);
export const SETUP_CHECK_FAILED: string = translationKey(
  "The setup check could not be read. Check again in a moment.",
);
export const SETUP_CHECK_PART_UNKNOWN: string = translationKey(
  "This part could not be read for you.",
);

const LlmSetupCheckCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [reloadToken, setReloadToken] = useState<number>(0);
  const state: LlmSetupCheckState = useLlmSetupCheck({
    enabled: true,
    reloadToken: reloadToken + (props.refreshToken || 0),
  });

  /*
   * The last answer, kept while the check reads again: "Check again" and a
   * connection saved below re-read it, and the card would otherwise empty
   * to a placeholder and fill again under the reader's eyes.
   */
  const [lastCheck, setLastCheck] = useState<LlmSetupCheckResponse | null>(
    null,
  );

  useEffect(() => {
    if (state.kind === "loaded") {
      setLastCheck(state.check);
    }
  }, [state]);

  const shownCheck: LlmSetupCheckResponse | null =
    state.kind === "loaded"
      ? state.check
      : state.kind === "loading" || state.kind === "idle"
        ? lastCheck
        : null;

  const now: Date = OneUptimeDate.getCurrentDate();

  const unknown: LlmSetupCheckLine = {
    key: "unknown",
    tone: "off",
    text:
      translator.translateText(SETUP_CHECK_PART_UNKNOWN) ||
      SETUP_CHECK_PART_UNKNOWN,
  };

  const renderGroups: (check: LlmSetupCheckResponse) => ReactElement = (
    check: LlmSetupCheckResponse,
  ): ReactElement => {
    /*
     * Nothing set up and nothing arriving: one line, not three groups of
     * "none" that repeat the three ways right below.
     */
    if (isLlmSetupCheckQuiet(check)) {
      return (
        <div data-testid="llm-setup-check-quiet">
          <SetupLine
            line={{
              key: "quiet",
              tone: "off",
              text:
                translator.translateText(NOTHING_COMING_IN) ||
                NOTHING_COMING_IN,
            }}
          />
        </div>
      );
    }

    const appsLines: Array<LlmSetupCheckLine> = check.apps
      ? getAppsLines({
          apps: check.apps,
          translator,
          serviceName: props.serviceName,
          now,
        })
      : [unknown];

    /*
     * "Send your app's AI calls" once the apps were read and none sends:
     * never for apps the reader may not read, which may well be sending.
     */
    const appsSendNone: boolean = Boolean(
      check.apps && check.apps.callsRecently === 0,
    );

    const toolSources: Array<LlmSetupCheckMetricSource> = (
      check.metrics || []
    ).filter((metric: LlmSetupCheckMetricSource): boolean => {
      return metric.points > 0 && metric.source !== LlmMetricSource.GenAi;
    });

    const connections: Array<LlmSetupCheckConnection> = check.connections || [];
    const accounts: Array<LlmSetupCheckConnection> = connections.filter(
      (connection: LlmSetupCheckConnection): boolean => {
        return connection.kind === "provider-account";
      },
    );
    const tools: Array<LlmSetupCheckConnection> = connections.filter(
      (connection: LlmSetupCheckConnection): boolean => {
        return connection.kind === "company-tool";
      },
    );

    const renderConnections: (
      list: Array<LlmSetupCheckConnection>,
      none: { key: string; text: string },
    ) => ReactElement = (
      list: Array<LlmSetupCheckConnection>,
      none: { key: string; text: string },
    ): ReactElement => {
      if (check.connections === null) {
        return <SetupLine line={unknown} />;
      }

      if (list.length === 0) {
        return (
          <SetupLine
            line={{
              key: none.key,
              tone: "off",
              text: translator.translateText(none.text) || none.text,
            }}
          />
        );
      }

      return (
        // The card's width, for the rows' side-by-side layout.
        <div className="[container-type:inline-size]">
          <ul className="flex flex-col gap-3">
            {list.map((connection: LlmSetupCheckConnection): ReactElement => {
              return (
                <ConnectionRow
                  key={connection.connectionId}
                  connection={connection}
                  line={getConnectionLine({ connection, translator, now })}
                />
              );
            })}
          </ul>
        </div>
      );
    };

    const newestMetric: string | null = toolSources.reduce(
      (
        newest: string | null,
        metric: LlmSetupCheckMetricSource,
      ): string | null => {
        return metric.newestAt && (!newest || metric.newestAt > newest)
          ? metric.newestAt
          : newest;
      },
      null,
    );

    return (
      <div className="divide-y divide-gray-100">
        <Group
          title={translationKey("Your apps")}
          dataTestId="llm-setup-check-apps"
          action={
            appsSendNone
              ? {
                  title: translationKey("Send your app's AI calls"),
                  onClick: () => {
                    props.onPickWay("apps");
                  },
                }
              : undefined
          }
        >
          {appsLines.map((line: LlmSetupCheckLine): ReactElement => {
            return <SetupLine key={line.key} line={line} />;
          })}
        </Group>

        {toolSources.length > 0 ? (
          <Group
            title={translationKey("Coding assistants")}
            dataTestId="llm-setup-check-coding-tools"
          >
            <SetupLine
              line={{
                key: "coding-tools",
                tone: "ok",
                text: translator.translatePlural(
                  METRICS_RECEIVING,
                  toolSources.length,
                  {
                    tools: composedValue((sentence: Translator): string => {
                      return formatNameList(
                        toolSources.map(
                          (metric: LlmSetupCheckMetricSource): string => {
                            return getLlmMetricSourceTitle(metric.source);
                          },
                        ),
                        "and",
                        sentence,
                      );
                    }),
                    time: newestMetric
                      ? OneUptimeDate.fromNow(new Date(newestMetric), now)
                      : "",
                  },
                ),
                detail:
                  translator.translateText(METRICS_WHERE) || METRICS_WHERE,
              }}
            />
          </Group>
        ) : (
          <></>
        )}

        <Group
          title={translationKey("Your AI provider accounts")}
          dataTestId="llm-setup-check-accounts"
          action={
            check.connections !== null && accounts.length === 0
              ? {
                  title: translationKey("Connect one"),
                  onClick: () => {
                    props.onPickWay("providers");
                  },
                }
              : undefined
          }
        >
          {renderConnections(accounts, {
            key: "accounts-none",
            text: ACCOUNTS_NONE,
          })}
        </Group>

        <Group
          title={translationKey("Your company's AI tools")}
          dataTestId="llm-setup-check-tools"
          action={
            check.connections !== null && tools.length === 0
              ? {
                  title: translationKey("Connect one"),
                  onClick: () => {
                    props.onPickWay("tools");
                  },
                }
              : undefined
          }
        >
          {renderConnections(tools, { key: "tools-none", text: TOOLS_NONE })}
        </Group>
      </div>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (shownCheck) {
      return renderGroups(shownCheck);
    }

    if (state.kind === "error") {
      return (
        <div data-testid="llm-setup-check-error">
          <SetupLine
            line={{
              key: "check-failed",
              tone: "off",
              text:
                translator.translateText(SETUP_CHECK_FAILED) ||
                SETUP_CHECK_FAILED,
            }}
          />
        </div>
      );
    }

    // The first read: a line's worth of placeholder, as a quiet check is.
    return (
      <div
        className="space-y-3"
        data-testid="llm-setup-check-loading"
        aria-busy="true"
      >
        {[0, 1].map((index: number) => {
          return (
            <div key={index} className="flex items-start gap-2">
              <div className="mt-0.5 h-4 w-4 flex-shrink-0 animate-pulse rounded-full bg-gray-100" />
              <div
                className={`h-4 animate-pulse rounded bg-gray-100 ${
                  index === 0 ? "w-2/3" : "w-1/3"
                }`}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div data-testid="llm-setup-check">
      <Card
        title={SETUP_CHECK_TITLE}
        description={SETUP_CHECK_DESCRIPTION}
        buttons={[
          {
            title: translationKey("Check again"),
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.NORMAL,
            isLoading: state.kind === "loading",
            onClick: () => {
              setReloadToken((value: number): number => {
                return value + 1;
              });
            },
          },
        ]}
      >
        {renderBody()}
      </Card>
    </div>
  );
};

export default LlmSetupCheckCard;
