import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../AppLink/AppLink";
import { buildCustomSignalSessionsQuery } from "../../SessionReplay/SessionReplayListFilters";
import {
  findSignalName,
  readSignalMonitorTarget,
  SignalMonitorTarget,
} from "./SignalMonitorTarget";

/*
 * On the page of a monitor that watches one of a RUM application's own
 * signals (issue #6518): which signal, by the name it has now, and See
 * sessions - the application's session list filtered to it. The monitor
 * keeps the signal's id, so a rename on the Frustration Signals page is
 * followed here; a signal that was deleted says so instead.
 *
 * Nothing at all for any other monitor, and nothing for a reader who may
 * not read the application.
 */

export const SIGNAL_MONITOR_SENTENCE: string = translationKey(
  "This monitor counts the recorded sessions that hit your signal {{name}}.",
);

export const SIGNAL_MONITOR_GONE_SENTENCE: string = translationKey(
  "This monitor's signal is no longer on the application's Frustration Signals page, so no session counts toward it.",
);

export const SEE_SESSIONS: string = translationKey("See sessions");

export interface ComponentProps {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "found"; name: string }
  | { kind: "gone" }
  | { kind: "unreadable" };

const SignalMonitorSessionsLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const target: SignalMonitorTarget | null = readSignalMonitorTarget(
    props.monitorType,
    props.monitorStep,
  );
  const [signal, setSignal] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!target) {
      return;
    }

    let isCurrent: boolean = true;

    setSignal({ kind: "loading" });

    ModelAPI.getItem<RumApplication>({
      modelType: RumApplication,
      id: new ObjectID(target.rumApplicationId),
      select: { _id: true, sessionReplayFrustrationSignals: true },
    })
      .then((application: RumApplication | null): void => {
        if (!isCurrent) {
          return;
        }

        if (!application) {
          setSignal({ kind: "unreadable" });
          return;
        }

        const name: string | null = findSignalName(
          (application as unknown as Record<string, unknown>)[
            "sessionReplayFrustrationSignals"
          ],
          target.signalId,
        );

        setSignal(name ? { kind: "found", name: name } : { kind: "gone" });
      })
      .catch((): void => {
        if (isCurrent) {
          setSignal({ kind: "unreadable" });
        }
      });

    return (): void => {
      isCurrent = false;
    };
  }, [target?.rumApplicationId, target?.signalId]);

  if (!target || signal.kind === "unreadable") {
    return null;
  }

  if (signal.kind === "gone") {
    return (
      <p
        className="mt-5 flex items-start gap-2 text-sm text-gray-600"
        data-testid="monitor-signal-gone"
      >
        <Icon
          icon={IconProp.Film}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span>{translator.translateText(SIGNAL_MONITOR_GONE_SENTENCE)}</span>
      </p>
    );
  }

  const route: Route | null =
    signal.kind === "found"
      ? RouteUtil.getPageRoute(PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY, {
          modelId: target.rumApplicationId,
          query: buildCustomSignalSessionsQuery(signal.name),
        })
      : null;

  return (
    <div
      className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600"
      data-testid="monitor-signal-sessions"
    >
      <span className="flex items-start gap-2">
        <Icon
          icon={IconProp.Film}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        {/* One item of the row: its words and the name, one line of text. */}
        <span>
          <TranslatedSentence
            template={SIGNAL_MONITOR_SENTENCE}
            slots={{
              name:
                signal.kind === "found" ? (
                  <bdi className="font-medium text-gray-900">{signal.name}</bdi>
                ) : (
                  <InlineValueSkeleton widthClassName="w-24" />
                ),
            }}
          />
        </span>
      </span>
      {route && (
        <AppLink
          to={route}
          className="font-medium text-indigo-600 hover:underline"
          dataTestId="monitor-signal-see-sessions"
        >
          {translator.translateText(SEE_SESSIONS) || SEE_SESSIONS}
        </AppLink>
      )}
    </div>
  );
};

export default SignalMonitorSessionsLink;
