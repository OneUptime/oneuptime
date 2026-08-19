import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";

export enum ToastType {
  DANGER,
  SUCCESS,
  INFO,
  WARNING,
  NORMAL,
}

export interface ComponentProps {
  title: string;
  description: string;
  onClose?: undefined | (() => void);
  type?: undefined | ToastType;
  icon?: IconProp | undefined;
}

/* How long the exit fade runs before the toast actually unmounts. */
const EXIT_DURATION_IN_MS: number = 150;

const Component: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const [show, setShow] = useState<boolean>(true);

  /*
   * The toast is mounted in its closed state (faded, nudged down) and flipped
   * open one frame later so the browser has something to transition from —
   * the same pattern Modal uses for its entrance.
   */
  const [hasEntered, setHasEntered] = useState<boolean>(false);

  /*
   * Dismissal fades the card out first and only unmounts (and notifies the
   * owner) once the fade has finished, so the toast never blinks away.
   */
  const [isLeaving, setIsLeaving] = useState<boolean>(false);

  useEffect(() => {
    const open: () => void = (): void => {
      setHasEntered(true);
    };

    const frame: number = requestAnimationFrame(open);

    /*
     * A hidden or throttled tab never runs an animation frame; the timer
     * skips the transition rather than leaving the toast at zero opacity.
     */
    const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(open, 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallbackTimer);
    };
  }, []);

  /*
   * The latest onClose lives in a ref so the exit effect can depend on
   * isLeaving alone. Owners may recreate onClose every render, and a dep on
   * it would restart the unmount timer whenever a sibling toast re-renders
   * the stack mid-exit — leaving an invisible pointer-events-auto card
   * intercepting clicks past its original deadline.
   */
  const onCloseRef: React.MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(props.onClose);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    if (!isLeaving) {
      return undefined;
    }

    const exitTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setShow(false);
      if (onCloseRef.current) {
        onCloseRef.current();
      }
    }, EXIT_DURATION_IN_MS);

    return () => {
      clearTimeout(exitTimer);
    };
  }, [isLeaving]);

  let typeCssClass: string = "text-gray-400";
  let iconType: IconProp = IconProp.Info;

  if (props.type === ToastType.NORMAL) {
    typeCssClass = "text-gray-400";
    iconType = IconProp.Info;
  }
  if (props.type === ToastType.DANGER) {
    typeCssClass = "text-red-400";
    iconType = IconProp.Error;
  }
  if (props.type === ToastType.WARNING) {
    typeCssClass = "text-yellow-400";
    iconType = IconProp.Alert;
  }
  if (props.type === ToastType.SUCCESS) {
    typeCssClass = "text-green-400";
    iconType = IconProp.CheckCircle;
  }
  if (props.type === ToastType.INFO) {
    typeCssClass = "text-blue-400";
    iconType = IconProp.Info;
  }

  if (props.icon) {
    iconType = props.icon;
  }

  /*
   * Settled state carries no transform class at all — leaving a translate on
   * the card would make it the containing block for position:fixed
   * descendants (the Modal invariant).
   */
  let motionClassName: string = "translate-y-2 opacity-0";

  if (isLeaving) {
    motionClassName = "opacity-0";
  } else if (hasEntered) {
    motionClassName = "opacity-100";
  }

  if (show) {
    return (
      <div
        data-testid="toast"
        className={`pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 transition duration-150 ease-out motion-reduce:transition-none ${motionClassName}`}
      >
        <div className="p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <Icon
                className={`h-6 w-6 ${typeCssClass}`}
                data-testid="toast-icon"
                icon={iconType}
              />
            </div>
            <div className="ml-3 w-0 flex-1 pt-0.5">
              <p
                data-testid="title"
                className="text-sm font-medium text-gray-900"
              >
                {translateString(props.title)}
              </p>
              <p
                data-testid="description"
                className="mt-1 text-sm text-gray-500"
              >
                {translateString(props.description)}
              </p>
            </div>
            <div className="ml-4 flex flex-shrink-0">
              <button
                onClick={() => {
                  setIsLeaving(true);
                }}
                data-testid="close-button"
                type="button"
                className="inline-flex rounded-md bg-white text-gray-400 transition-colors duration-150 ease-out hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                <span className="sr-only">Close</span>
                <Icon className={`h-5 w-5`} icon={IconProp.Close} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return <></>;
};

export default Component;
