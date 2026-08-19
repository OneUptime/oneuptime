import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import Toast, { ComponentProps as ToastComponentProps } from "./Toast";
import GlobalEvents from "../../Utils/GlobalEvents";

type ShowToastNotificationFunction = (toast: ToastComponentProps) => void;

export const ShowToastNotification: ShowToastNotificationFunction = (
  toast: ToastComponentProps,
): void => {
  GlobalEvents.dispatchEvent("toast", toast as any);
};

/*
 * Each queued toast gets a stable id so removals key correctly — keying by
 * array index would re-key (and so re-mount and re-animate) every toast below
 * the one that was dismissed.
 */
interface ToastEntry {
  id: number;
  toast: ToastComponentProps;
  /*
   * Built once at dispatch and stable for the toast's lifetime: recreating
   * onClose per render would hand every Toast a fresh prop on each stack
   * re-render, which used to restart the exit-unmount timer of any toast
   * mid-fade.
   */
  onClose: () => void;
}

const ToastLayout: FunctionComponent = (): ReactElement => {
  const [currentToasts, setCurrentToasts] = React.useState<Array<ToastEntry>>(
    [],
  );
  const nextToastIdRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const addToastNotification: (event: CustomEvent) => void = (
      event: CustomEvent,
    ): void => {
      const toast: ToastComponentProps = event.detail;
      const id: number = nextToastIdRef.current;
      nextToastIdRef.current += 1;

      // setCurrentToasts is stable, so this closure never goes stale.
      const onClose: () => void = (): void => {
        if (toast.onClose) {
          toast.onClose();
        }

        setCurrentToasts((toasts: Array<ToastEntry>) => {
          return toasts.filter((candidate: ToastEntry) => {
            return candidate.id !== id;
          });
        });
      };

      /*
       * Functional update: this listener is registered once, so reading
       * currentToasts from its closure would always see the mount-time empty
       * array and every new toast would clobber the ones before it.
       */
      setCurrentToasts((toasts: Array<ToastEntry>) => {
        return [...toasts, { id, toast, onClose }];
      });
    };

    GlobalEvents.addEventListener("toast", addToastNotification);

    return () => {
      GlobalEvents.removeEventListener("toast", addToastNotification);
    };
  }, []);

  /*
   * ONE fixed container for every toast. Each toast used to render its own
   * fixed strip at top-0 (the index prop that offset them was never passed),
   * so stacked toasts painted on top of each other. A single region stacking
   * cards with flex-col gap makes the order self-evident and keeps the
   * z-index ladder in exactly one place (Toast z-40, under Modal z-50).
   */
  return (
    <div
      data-testid="toast-region"
      aria-live="assertive"
      className="pointer-events-none fixed z-40 top-0 left-0 right-0 flex items-end px-4 py-6 sm:items-start sm:p-6"
    >
      <div className="flex w-full flex-col items-center gap-4 sm:items-end">
        {currentToasts.map((entry: ToastEntry) => {
          return (
            <Toast
              key={entry.id}
              title={entry.toast.title}
              description={entry.toast.description}
              type={entry.toast.type}
              icon={entry.toast.icon}
              onClose={entry.onClose}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ToastLayout;
