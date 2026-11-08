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
import React, { FunctionComponent, ReactElement, useState } from "react";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import { LlmConnectWayKey } from "../Connect/LlmConnectWays";
import LlmConnectionLogo from "../Connect/LlmConnectionLogo";
import {
  ACCOUNTS_NONE,
  LlmSetupCheckLine,
  LlmSetupCheckTone,
  METRICS_RECEIVING,
  METRICS_WHERE,
  TOOLS_NONE,
  getAppsLines,
  getConnectionLine,
  getLlmMetricSourceTitle,
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
 * Read when the page opens and on "Check again" (LlmSetupCheckReader caps
 * every read, so it is cheap).
 */

export interface ComponentProps {
  // Opens a way's path on the page, as its tab does.
  onPickWay: (key: LlmConnectWayKey) => void;
  // App names, by service id.
  serviceName: (serviceId: string) => string;
  // Bumped by the page when a connection changes.
  refreshToken?: number | undefined;
}

const TONES: Record<
  LlmSetupCheckTone,
  { icon: IconProp; className: string; label: string }
> = {
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
  off: {
    icon: IconProp.MinusCircle,
    className: "text-gray-400",
    label: translationKey("Not set up"),
  },
};

const SetupLine: FunctionComponent<{ line: LlmSetupCheckLine }> = (props: {
  line: LlmSetupCheckLine;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: { icon: IconProp; className: string; label: string } =
    TONES[props.line.tone];

  return (
    <div
      className="flex min-w-0 items-start gap-2"
      data-testid={`llm-setup-check-line-${props.line.key}`}
      data-tone={props.line.tone}
    >
      <span
        className="mt-0.5 flex-shrink-0"
        title={translator.translateText(tone.label) || tone.label}
      >
        <Icon icon={tone.icon} className={`h-4 w-4 ${tone.className}`} />
        <span className="sr-only">
          {translator.translateText(tone.label) || tone.label}
        </span>
      </span>
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
      </div>
    </div>
  );
};

const Group: FunctionComponent<{
  title: string;
  dataTestId: string;
  children: ReactElement | Array<ReactElement>;
  action?: { title: string; onClick: () => void } | undefined;
}> = (props: {
  title: string;
  dataTestId: string;
  children: ReactElement | Array<ReactElement>;
  action?: { title: string; onClick: () => void } | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0"
      data-testid={props.dataTestId}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {translator.translateText(props.title) || props.title}
        </div>
        {props.action ? (
          <button
            type="button"
            onClick={props.action.onClick}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            data-testid={`${props.dataTestId}-action`}
          >
            {translator.translateText(props.action.title) ||
              props.action.title}
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </button>
        ) : (
          <></>
        )}
      </div>
      <div className="flex flex-col gap-3">{props.children}</div>
    </div>
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

  const now: Date = OneUptimeDate.getCurrentDate();

  const renderBody: () => ReactElement = (): ReactElement => {
    if (state.kind === "loading" || state.kind === "idle") {
      return (
        <div className="space-y-3" data-testid="llm-setup-check-loading">
          {[0, 1, 2].map((index: number) => {
            return (
              <div key={index} className="flex items-start gap-2">
                <div className="mt-0.5 h-4 w-4 rounded-full bg-gray-100" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
              </div>
            );
          })}
        </div>
      );
    }

    if (state.kind === "error") {
      return (
        <div
          className="text-sm text-gray-600"
          data-testid="llm-setup-check-error"
        >
          {translator.translateText(SETUP_CHECK_FAILED) || SETUP_CHECK_FAILED}
        </div>
      );
    }

    const check: LlmSetupCheckResponse = state.check;
    const unknown: LlmSetupCheckLine = {
      key: "unknown",
      tone: "off",
      text:
        translator.translateText(SETUP_CHECK_PART_UNKNOWN) ||
        SETUP_CHECK_PART_UNKNOWN,
    };

    const appsLines: Array<LlmSetupCheckLine> = check.apps
      ? getAppsLines({
          apps: check.apps,
          translator,
          serviceName: props.serviceName,
          now,
        })
      : [unknown];

    const appsWorking: boolean = Boolean(
      check.apps && check.apps.callsRecently > 0,
    );

    const toolSources: Array<LlmSetupCheckMetricSource> = (
      check.metrics || []
    ).filter((metric: LlmSetupCheckMetricSource): boolean => {
      return metric.points > 0 && metric.source !== LlmMetricSource.GenAi;
    });

    const connections: Array<LlmSetupCheckConnection> =
      check.connections || [];
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

    const renderConnection: (
      connection: LlmSetupCheckConnection,
    ) => ReactElement = (
      connection: LlmSetupCheckConnection,
    ): ReactElement => {
      return (
        <div
          key={connection.connectionId}
          className="flex min-w-0 items-start gap-3"
          data-testid={`llm-setup-check-connection-${connection.connectionId}`}
        >
          <LlmConnectionLogo
            provider={connection.provider as LlmConnectionProvider}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900">
              {connection.name}
            </div>
            <div className="mt-1">
              <SetupLine
                line={getConnectionLine({ connection, translator, now })}
              />
            </div>
          </div>
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
            appsWorking
              ? undefined
              : {
                  title: translationKey("Send your app's AI calls"),
                  onClick: () => {
                    props.onPickWay("apps");
                  },
                }
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
            accounts.length === 0
              ? {
                  title: translationKey("Connect one"),
                  onClick: () => {
                    props.onPickWay("providers");
                  },
                }
              : undefined
          }
        >
          {check.connections === null
            ? [<SetupLine key="unknown" line={unknown} />]
            : accounts.length > 0
              ? accounts.map(renderConnection)
              : [
                  <SetupLine
                    key="none"
                    line={{
                      key: "accounts-none",
                      tone: "off",
                      text:
                        translator.translateText(ACCOUNTS_NONE) ||
                        ACCOUNTS_NONE,
                    }}
                  />,
                ]}
        </Group>

        <Group
          title={translationKey("Your company's AI tools")}
          dataTestId="llm-setup-check-tools"
          action={
            tools.length === 0
              ? {
                  title: translationKey("Connect one"),
                  onClick: () => {
                    props.onPickWay("tools");
                  },
                }
              : undefined
          }
        >
          {check.connections === null
            ? [<SetupLine key="unknown" line={unknown} />]
            : tools.length > 0
              ? tools.map(renderConnection)
              : [
                  <SetupLine
                    key="none"
                    line={{
                      key: "tools-none",
                      tone: "off",
                      text: translator.translateText(TOOLS_NONE) || TOOLS_NONE,
                    }}
                  />,
                ]}
        </Group>
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
