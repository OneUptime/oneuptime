import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Toast, { ToastItem, ToastType } from "../../Utils/Toast";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  KeyboardEvent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Where the app's toasts are drawn (Common/UI/Utils/Toast, #9120): mounted
 * once, at the root of every app, beside NewVersionNotice.
 *
 * - Two live regions that are always on the page, empty or not, so a
 *   screen reader hears what is put in them: a polite one (role="status")
 *   for a success or a note, read when the reader is free, and an
 *   assertive one (role="alert") for an error, read at once.
 * - Each toast has its close button, and Escape closes the toast the focus
 *   is in. A success goes by itself; the pointer or the focus on it holds
 *   it there until they leave. An error stays until it is closed.
 * - It comes in with the product's pop-in, which a reader who asks for less
 *   motion does not get (ou-animate-pop-in in Theme.css).
 * - The bottom corner at the end of the reading direction (the right, or
 *   the left in Arabic and Persian), away from NewVersionNotice at the
 *   start; the width of a phone's screen less its margins on a phone.
 *   Over dialogs (z-50): a dialog that saved and closed, or one still open
 *   when something failed, does not hide what is said about it.
 * - Drawn with colour classes Theme.css re-colours under html.dark
 *   (ToastDarkMode guards them), so it reads the same in the dark theme.
 */

interface ToastLook {
  icon: IconProp;
  iconClassName: string;
}

const LOOK_BY_TYPE: Record<ToastType, ToastLook> = {
  [ToastType.Success]: {
    icon: IconProp.CheckCircle,
    iconClassName: "h-5 w-5 text-green-600",
  },
  [ToastType.Error]: {
    icon: IconProp.ExclaimationCircle,
    iconClassName: "h-5 w-5 text-red-600",
  },
  [ToastType.Info]: {
    icon: IconProp.InformationCircle,
    iconClassName: "h-5 w-5 text-indigo-600",
  },
};

interface ToastCardProps {
  toast: ToastItem;
  translator: Translator;
}

const ToastCard: FunctionComponent<ToastCardProps> = (
  props: ToastCardProps,
): ReactElement => {
  const { toast } = props;
  const [isHeld, setIsHeld] = useState<boolean>(false);
  const remainingInMsRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(toast.durationInMs);

  /*
   * Shown again (the same words twice), or given another time: its time
   * starts again. Before the timer below, so the timer reads it.
   */
  useEffect(() => {
    remainingInMsRef.current = toast.durationInMs;
  }, [toast.revision, toast.durationInMs]);

  useEffect(() => {
    const remainingInMs: number | null = remainingInMsRef.current;

    if (remainingInMs === null || isHeld) {
      return;
    }

    const startedAt: number = Date.now();
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        Toast.dismiss(toast.id);
      },
      Math.max(0, remainingInMs),
    );

    return () => {
      clearTimeout(timer);

      // Held, or shown again: what is left of its time.
      if (remainingInMsRef.current !== null) {
        remainingInMsRef.current = Math.max(
          0,
          remainingInMsRef.current - (Date.now() - startedAt),
        );
      }
    };
  }, [isHeld, toast.id, toast.revision, toast.durationInMs]);

  const look: ToastLook = LOOK_BY_TYPE[toast.type];

  const onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void = (
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Escape") {
      // The toast, not the dialog under it.
      event.stopPropagation();
      Toast.dismiss(toast.id);
    }
  };

  return (
    <div
      className="ou-animate-pop-in pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-start shadow-lg"
      data-testid={toast.dataTestId || "toast"}
      data-toast-type={toast.type}
      onMouseEnter={() => {
        setIsHeld(true);
      }}
      onMouseLeave={() => {
        setIsHeld(false);
      }}
      onFocus={() => {
        setIsHeld(true);
      }}
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        // Still in the toast: from its action to its close button.
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }

        setIsHeld(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div className="flex-none pt-0.5" aria-hidden="true">
        <Icon icon={look.icon} className={look.iconClassName} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p
          className="break-words text-sm font-medium text-gray-900 text-pretty"
          data-testid="toast-title"
        >
          {toast.title}
        </p>
        {toast.description ? (
          <div
            className="mt-1 break-words text-sm text-gray-500 text-pretty"
            data-testid="toast-description"
          >
            {toast.description}
          </div>
        ) : (
          <></>
        )}
        {toast.action ? (
          <button
            type="button"
            className="mt-2 rounded-md text-sm font-semibold text-indigo-600 transition-colors duration-150 ease-out hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            data-testid="toast-action"
            onClick={() => {
              Toast.dismiss(toast.id);
              toast.action?.onClick();
            }}
          >
            {toast.action.title}
          </button>
        ) : (
          <></>
        )}
      </div>
      <button
        type="button"
        className="-m-1 flex-none rounded-md p-1 text-gray-400 transition-colors duration-150 ease-out hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-label={props.translator.translateText("Dismiss")}
        data-testid="toast-dismiss"
        onClick={() => {
          Toast.dismiss(toast.id);
        }}
      >
        <Icon icon={IconProp.Close} className="h-5 w-5" />
      </button>
    </div>
  );
};

const ToastRegion: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [toasts, setToasts] = useState<ReadonlyArray<ToastItem>>(
    Toast.getToasts(),
  );

  useEffect(() => {
    // Whatever was shown before this subscribed.
    setToasts(Toast.getToasts());

    return Toast.subscribe((next: ReadonlyArray<ToastItem>): void => {
      setToasts(next);
    });
  }, []);

  const errors: Array<ToastItem> = toasts.filter(
    (toast: ToastItem): boolean => {
      return toast.type === ToastType.Error;
    },
  );

  const others: Array<ToastItem> = toasts.filter(
    (toast: ToastItem): boolean => {
      return toast.type !== ToastType.Error;
    },
  );

  const drawToast: (toast: ToastItem) => ReactElement = (
    toast: ToastItem,
  ): ReactElement => {
    return <ToastCard key={toast.id} toast={toast} translator={translator} />;
  };

  return (
    <div
      data-testid="toast-region"
      className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] flex flex-col gap-2 print:hidden sm:inset-x-auto sm:bottom-6 sm:end-6 sm:w-[24rem]"
    >
      <div
        role="alert"
        aria-live="assertive"
        data-testid="toast-region-errors"
        className="flex flex-col gap-2"
      >
        {errors.map(drawToast)}
      </div>
      <div
        role="status"
        aria-live="polite"
        data-testid="toast-region-status"
        className="flex flex-col gap-2"
      >
        {others.map(drawToast)}
      </div>
    </div>
  );
};

export default ToastRegion;
