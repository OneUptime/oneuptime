import AppLink from "../../AppLink/AppLink";
import WhoIsToldApi from "../../Monitor/Overview/WhoIsToldApi";
import {
  WhoIsToldFixLink,
  getBreakSentence,
  getFixLink,
  getWhoIsToldSummary,
} from "../../Monitor/Overview/WhoIsToldWords";
import { TelemetrySetupMonitor } from "./TelemetrySetupApi";
import IconProp from "Common/Types/Icon/IconProp";
import {
  WhoIsToldBreak,
  WhoIsToldResult,
} from "Common/Types/Monitor/WhoIsTold";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHO IS TOLD, IN THE TELEMETRY SETUP'S SUMMARY (#7164), read from the
 * records as the monitor's own "When this goes down" card reads them: each
 * monitor the setup made is asked of WhoIsToldService (GET
 * /who-is-told/monitor/:id), and its answer worded with the card's own
 * sentences (WhoIsToldWords) - what it opens, who it emails, who it pages -
 * with every break named and the page that puts it right. The usual one for
 * a telemetry monitor: it opens an alert, and only incidents have on-call
 * rules (OnlyIncidentsHaveRules), so nobody is paged.
 *
 * Short: the monitors of one setup are made alike, so an answer they share
 * is said once, and only monitors told otherwise are named. A break is said
 * once however many monitors it stops. Until the answers come the row keeps
 * the line's room; with none (no monitor, or none could be read) it says
 * what the counts said before (`fallback`).
 */

export interface TelemetryWhoIsToldAnswer {
  monitorId: string;
  monitorName: string;
  result: WhoIsToldResult;
}

export interface TelemetryWhoIsToldLine {
  // The monitor it is about, when the monitors are not all told alike.
  monitorName?: string | undefined;
  text: string;
}

export interface TelemetryWhoIsToldBreakLine {
  // The monitor the break was found on: a criteria break opens its page.
  monitorId: string;
  brk: WhoIsToldBreak;
  text: string;
}

export interface TelemetryWhoIsToldWords {
  lines: Array<TelemetryWhoIsToldLine>;
  breaks: Array<TelemetryWhoIsToldBreakLine>;
}

/*
 * What the summary says from the monitors' answers: one line when every
 * monitor is told alike, else one per monitor (by its name), in the order
 * the setup made them; and each break once, in the order met.
 */
export function getTelemetryWhoIsToldWords(data: {
  answers: ReadonlyArray<TelemetryWhoIsToldAnswer>;
  translator: Translator;
}): TelemetryWhoIsToldWords {
  const said: Array<{ answer: TelemetryWhoIsToldAnswer; text: string }> =
    data.answers.map(
      (
        answer: TelemetryWhoIsToldAnswer,
      ): { answer: TelemetryWhoIsToldAnswer; text: string } => {
        return {
          answer: answer,
          text: getWhoIsToldSummary(answer.result, data.translator),
        };
      },
    );

  const spoken: Array<{ answer: TelemetryWhoIsToldAnswer; text: string }> =
    said.filter(
      (item: { answer: TelemetryWhoIsToldAnswer; text: string }): boolean => {
        return Boolean(item.text);
      },
    );

  const isAllAlike: boolean =
    new Set<string>(
      spoken.map(
        (item: { answer: TelemetryWhoIsToldAnswer; text: string }): string => {
          return item.text;
        },
      ),
    ).size <= 1;

  const lines: Array<TelemetryWhoIsToldLine> = isAllAlike
    ? spoken
        .slice(0, 1)
        .map(
          (item: {
            answer: TelemetryWhoIsToldAnswer;
            text: string;
          }): TelemetryWhoIsToldLine => {
            return { text: item.text };
          },
        )
    : spoken.map(
        (item: {
          answer: TelemetryWhoIsToldAnswer;
          text: string;
        }): TelemetryWhoIsToldLine => {
          return { monitorName: item.answer.monitorName, text: item.text };
        },
      );

  const breaks: Array<TelemetryWhoIsToldBreakLine> = [];
  const seen: Set<string> = new Set<string>();

  for (const answer of data.answers) {
    for (const brk of answer.result.breaks) {
      const text: string = getBreakSentence(brk, data.translator);

      if (!text || seen.has(text)) {
        continue;
      }

      seen.add(text);
      breaks.push({ monitorId: answer.monitorId, brk: brk, text: text });
    }
  }

  return { lines: lines, breaks: breaks };
}

export interface ComponentProps {
  // The monitors the setup made, in the order it made them.
  monitors: ReadonlyArray<TelemetrySetupMonitor>;
  // What to say when no monitor's answer can be read: the counts' sentence.
  fallback: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; answers: Array<TelemetryWhoIsToldAnswer> };

const linkClassName: string =
  "text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

const TelemetryWhoIsTold: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // The monitors by id: asked again only when they change.
  const monitorKey: string = props.monitors
    .map((monitor: TelemetrySetupMonitor): string => {
      return monitor.id;
    })
    .join(",");

  useEffect(() => {
    let isActive: boolean = true;

    if (props.monitors.length === 0) {
      setState({ status: "loaded", answers: [] });
      return undefined;
    }

    setState({ status: "loading" });

    /*
     * Each monitor asked on its own: one that can't be read (deleted a
     * moment ago, a server error) leaves the others' answers standing.
     */
    void Promise.allSettled(
      props.monitors.map(
        async (
          monitor: TelemetrySetupMonitor,
        ): Promise<TelemetryWhoIsToldAnswer> => {
          return {
            monitorId: monitor.id,
            monitorName: monitor.name,
            result: await WhoIsToldApi.getForMonitor({
              monitorId: new ObjectID(monitor.id),
            }),
          };
        },
      ),
    ).then(
      (
        settled: Array<PromiseSettledResult<TelemetryWhoIsToldAnswer>>,
      ): void => {
        if (!isActive) {
          return;
        }

        const answers: Array<TelemetryWhoIsToldAnswer> = [];

        for (const item of settled) {
          if (item.status === "fulfilled") {
            answers.push(item.value);
          }
        }

        setState({ status: "loaded", answers: answers });
      },
    );

    return () => {
      isActive = false;
    };
  }, [monitorKey]);

  if (state.status === "loading") {
    return (
      <div data-testid="guided-setup-summary-who-is-told-loading">
        <InlineValueSkeleton widthClassName="w-64" />
      </div>
    );
  }

  const words: TelemetryWhoIsToldWords = getTelemetryWhoIsToldWords({
    answers: state.answers,
    translator: translator,
  });

  if (words.lines.length === 0 && words.breaks.length === 0) {
    return (
      <span data-testid="guided-setup-summary-who-is-told-fallback">
        {props.fallback}
      </span>
    );
  }

  return (
    <div
      className="space-y-2"
      data-testid="guided-setup-summary-who-is-told-words"
    >
      {words.lines.map(
        (line: TelemetryWhoIsToldLine, index: number): ReactElement => {
          return (
            <div
              key={`line-${index}`}
              data-testid="guided-setup-who-is-told-line"
            >
              {line.monitorName ? (
                <p className="font-medium text-gray-900" dir="auto">
                  {line.monitorName}
                </p>
              ) : (
                <></>
              )}
              <p>{line.text}</p>
            </div>
          );
        },
      )}
      {words.breaks.length > 0 ? (
        <ul
          className="space-y-2"
          aria-label={translator.translateText("What stops people being told")}
        >
          {words.breaks.map(
            (
              item: TelemetryWhoIsToldBreakLine,
              index: number,
            ): ReactElement => {
              const fix: WhoIsToldFixLink | null = getFixLink({
                brk: item.brk,
                monitorId: new ObjectID(item.monitorId),
                translator: translator,
              });

              return (
                <li
                  key={`break-${index}`}
                  className="flex items-start gap-2"
                  data-testid="guided-setup-who-is-told-break"
                  data-kind={item.brk.kind}
                >
                  <Icon
                    icon={IconProp.Alert}
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                  />
                  <div className="min-w-0">
                    <p className="text-gray-900">{item.text}</p>
                    {fix ? (
                      <AppLink
                        to={fix.route}
                        className={linkClassName}
                        dataTestId="guided-setup-who-is-told-fix"
                      >
                        {fix.text}
                      </AppLink>
                    ) : (
                      <></>
                    )}
                  </div>
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryWhoIsTold;
