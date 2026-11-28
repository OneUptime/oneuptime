import { getProjectMonitorTemplateChanges } from "./MonitorTemplateChangeApi";
import MonitorTemplateChangeDialog, {
  MonitorTemplateChangeDialogMode,
} from "./MonitorTemplateChangeDialog";
import {
  MonitorTemplateChangePhase,
  getMonitorTemplateChangeLine,
  getMonitorTemplateChangePhase,
  isMonitorTemplateChangePhaseActive,
} from "./MonitorTemplateChangeModel";
import {
  MonitorTemplateChangeView,
  isMonitorTemplateChangeActive,
  isMonitorTemplateChangeWorthShowing,
} from "Common/Types/Monitor/MonitorTemplateChange";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * THE PROJECT'S TEMPLATE CHANGES, WHERE ITS MONITORS ARE (issue #11454).
 *
 * A change of many monitors' template runs on the server, and closing its
 * dialog never stops it. A template's page shows a change of its monitors,
 * but an Unlink from Template started on the Monitors list unlinks each
 * monitor from its own template, so it belonged to no page: once its dialog
 * was closed, nothing showed how far it got or what it left out. So the
 * Monitors list shows every change of the project still running - and one
 * that finished in the last hour with monitors left out or failed, or failed
 * as a whole - each on one line, with how far it got. Show progress opens
 * the change's own dialog: its progress, Stop, and Retry, as on the
 * template's page.
 *
 * The alert policies' and the auto import rules' pages show their own
 * changes the same way (`filter`): a policy pointed at another template
 * moves its monitors (#11452), and a rule can move its devices' (#11451).
 *
 * Read once on the page, again every few seconds while a change runs and
 * its dialog is closed - the dialog follows the change itself - and once
 * more when the dialog closes. A change seen running that is no longer
 * running has finished: the list around it is read again (`onChanged`).
 */

// How often a running change's line is read again.
export const MONITOR_TEMPLATE_CHANGES_REFRESH_MS: number = 5000;

export interface ComponentProps {
  // Which of the project's changes to show; every one when left out.
  filter?: ((view: MonitorTemplateChangeView) => boolean) | undefined;
  // A change shown here finished: what it changed should be read again.
  onChanged?: (() => void) | undefined;
  // Changed to read the changes again now: a change was just started.
  refreshToggle?: string | undefined;
  // A change to open the dialog of as soon as it is listed.
  openChangeId?: string | undefined;
}

const MonitorTemplateChangesNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [changes, setChanges] = useState<Array<MonitorTemplateChangeView>>([]);
  const [openChangeId, setOpenChangeId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  // The changes seen running, to tell when one has finished.
  const runningIds: React.MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );
  const filterRef: React.MutableRefObject<ComponentProps["filter"]> = useRef<
    ComponentProps["filter"]
  >(props.filter);
  const onChangedRef: React.MutableRefObject<ComponentProps["onChanged"]> =
    useRef<ComponentProps["onChanged"]>(props.onChanged);
  filterRef.current = props.filter;
  onChangedRef.current = props.onChanged;

  const fetchChanges: () => Promise<void> = async (): Promise<void> => {
    let views: Array<MonitorTemplateChangeView>;

    try {
      views = await getProjectMonitorTemplateChanges();
    } catch {
      // Nothing to show: a change, if any, still runs on the server.
      return;
    }

    const readAt: number = Date.now();
    const shown: Array<MonitorTemplateChangeView> = views.filter(
      (view: MonitorTemplateChangeView): boolean => {
        return (
          (!filterRef.current || filterRef.current(view)) &&
          isMonitorTemplateChangeWorthShowing({ view: view, now: readAt })
        );
      },
    );

    const stillRunning: Set<string> = new Set<string>(
      shown
        .filter((view: MonitorTemplateChangeView): boolean => {
          return isMonitorTemplateChangeActive(view.status);
        })
        .map((view: MonitorTemplateChangeView): string => {
          return view.id;
        }),
    );

    const hasOneFinished: boolean = Array.from(runningIds.current).some(
      (id: string): boolean => {
        return !stillRunning.has(id);
      },
    );

    runningIds.current = stillRunning;
    setChanges(shown);
    setNow(readAt);

    if (hasOneFinished) {
      onChangedRef.current?.();
    }
  };

  useEffect(() => {
    void fetchChanges();
  }, [props.refreshToggle]);

  // A change the page just started opens as soon as it is asked to.
  useEffect(() => {
    if (props.openChangeId) {
      setOpenChangeId(props.openChangeId);
    }
  }, [props.openChangeId]);

  const isAnyRunning: boolean = changes.some(
    (view: MonitorTemplateChangeView): boolean => {
      return isMonitorTemplateChangeActive(view.status);
    },
  );

  useEffect(() => {
    if (!isAnyRunning || openChangeId) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void fetchChanges();
    }, MONITOR_TEMPLATE_CHANGES_REFRESH_MS);

    return () => {
      clearInterval(timer);
    };
  }, [isAnyRunning, openChangeId]);

  return (
    <>
      {changes.length > 0 && (
        <div className="space-y-2" data-testid="monitor-template-changes">
          {changes.map((view: MonitorTemplateChangeView) => {
            const phase: MonitorTemplateChangePhase =
              getMonitorTemplateChangePhase(view, now);
            const isActive: boolean = isMonitorTemplateChangePhaseActive(phase);

            return (
              <Alert
                key={view.id}
                type={
                  isActive
                    ? AlertType.INFO
                    : phase === MonitorTemplateChangePhase.Failed
                      ? AlertType.DANGER
                      : AlertType.WARNING
                }
                dataTestId="monitor-template-change-line"
                title={getMonitorTemplateChangeLine({
                  translator: translator,
                  view: view,
                  phase: phase,
                })}
                textOnRight={
                  translator.translateText(
                    isActive ? "Show progress" : "Show what happened",
                  ) as string
                }
                onClick={() => {
                  setOpenChangeId(view.id);
                }}
              />
            );
          })}
        </div>
      )}

      {openChangeId && (
        <MonitorTemplateChangeDialog
          mode={MonitorTemplateChangeDialogMode.Progress}
          changeId={openChangeId}
          onChanged={() => {
            onChangedRef.current?.();
          }}
          onClose={() => {
            setOpenChangeId(null);
            void fetchChanges();
          }}
          onTemplateDeleted={() => {
            setOpenChangeId(null);
            void fetchChanges();
            onChangedRef.current?.();
          }}
        />
      )}
    </>
  );
};

export default MonitorTemplateChangesNotice;
