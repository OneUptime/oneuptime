import Icon from "../Icon/Icon";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  MouseEvent,
  ReactElement,
  useId,
  useRef,
} from "react";

export enum AlertType {
  INFO,
  SUCCESS,
  DANGER,
  WARNING,
}

export enum AlertSize {
  Normal,
  Large,
}

export interface ComponentProps {
  strongTitle?: string;
  title?: string | ReactElement;
  onClose?: () => void;
  type?: AlertType;
  onClick?: () => void;
  doNotShowIcon?: boolean | undefined;
  dataTestId?: string | undefined;
  textClassName?: string | undefined;
  className?: string | undefined;
  color?: Color | undefined;
  id?: string | undefined;
  textOnRight?: string | undefined;
  size?: AlertSize | undefined;
  icon?: IconProp | undefined;
}

const Alert: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, translateValue } = useTranslateValue();
  const translatedStrongTitle: string | undefined = translateString(
    props.strongTitle,
  );
  const translatedTitle: string | ReactElement | undefined = translateValue(
    props.title,
  );
  const translatedTextOnRight: string | undefined = translateString(
    props.textOnRight,
  );
  const type: AlertType = props.type ?? AlertType.INFO;
  const messageId: string = useId();
  const actionButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  const typeClassNames: {
    [key in AlertType]: {
      surface: string;
      icon: string;
      hover: string;
    };
  } = {
    [AlertType.DANGER]: {
      surface: "border-red-200 bg-red-50 text-red-800",
      icon: "bg-red-100 text-red-700",
      hover: "hover:bg-red-100",
    },
    [AlertType.INFO]: {
      surface: "border-blue-200 bg-blue-50 text-blue-800",
      icon: "bg-blue-100 text-blue-700",
      hover: "hover:bg-blue-100",
    },
    [AlertType.WARNING]: {
      surface: "border-amber-200 bg-amber-50 text-amber-900",
      icon: "bg-amber-100 text-amber-700",
      hover: "hover:bg-amber-100",
    },
    [AlertType.SUCCESS]: {
      surface: "border-emerald-200 bg-emerald-50 text-emerald-800",
      icon: "bg-emerald-100 text-emerald-700",
      hover: "hover:bg-emerald-100",
    },
  };

  // Public status pages provide their own status color and use a filled banner.
  const surfaceClassName: string = props.color
    ? "border-transparent text-white"
    : typeClassNames[type].surface;
  const iconClassName: string = props.color
    ? "bg-white/10 text-white"
    : typeClassNames[type].icon;
  const hoverClassName: string = props.color
    ? "hover:bg-white/10"
    : typeClassNames[type].hover;
  const icon: IconProp =
    props.icon ??
    (type === AlertType.SUCCESS
      ? IconProp.CheckCircle
      : type === AlertType.INFO
        ? IconProp.Info
        : IconProp.Alert);

  const onClick: (event: MouseEvent<HTMLDivElement>) => void = (
    event: MouseEvent<HTMLDivElement>,
  ): void => {
    // Rich messages can contain their own links and controls. Activating one
    // must not also activate the banner's action.
    const control: Element | null =
      event.target instanceof Element
        ? event.target.closest(
            "a, button, input, select, textarea, [role='button'], [role='link']",
          )
        : null;
    if (control && control !== actionButtonRef.current) {
      return;
    }
    props.onClick?.();
  };

  return (
    <div
      id={props.id}
      className={`alert relative min-w-0 rounded-lg border p-4 ${surfaceClassName} ${props.onClick ? `cursor-pointer transition-colors ${hoverClassName}` : ""} ${props.className || ""}`}
      data-testid={props.dataTestId}
      onClick={props.onClick ? onClick : undefined}
      role="alert"
      aria-live="polite"
      style={props.color ? { backgroundColor: props.color.toString() } : {}}
    >
      {props.onClick && (
        <button
          ref={actionButtonRef}
          type="button"
          aria-labelledby={messageId}
          className="absolute inset-0 w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        />
      )}
      <div className="alert-content relative flex items-start gap-3">
        {!props.doNotShowIcon && (
          <div
            className={`alert-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClassName}`}
            aria-hidden="true"
          >
            <Icon icon={icon} className="h-5 w-5" />
          </div>
        )}
        <div
          className={`alert-text min-w-0 flex-1 ${!props.doNotShowIcon && !(translatedStrongTitle && translatedTitle) ? "py-1" : ""} ${props.textClassName || ""}`}
        >
          <div
            id={messageId}
            className={`alert-message flex w-full min-w-0 flex-col gap-2 [overflow-wrap:anywhere] sm:flex-row sm:items-start sm:justify-between sm:gap-4 ${props.size === AlertSize.Large ? "text-lg leading-7" : "text-sm leading-6"}`}
          >
            <div className="min-w-0 space-y-1">
              {translatedStrongTitle && (
                <div className="font-semibold">{translatedStrongTitle}</div>
              )}
              {translatedTitle && <div>{translatedTitle}</div>}
            </div>
            {translatedTextOnRight && (
              <div className="min-w-0 font-medium sm:ml-auto sm:text-right">
                {translatedTextOnRight}
              </div>
            )}
          </div>
        </div>
        {props.onClose && (
          <button
            type="button"
            onClick={(event: MouseEvent<HTMLButtonElement>): void => {
              event.stopPropagation();
              props.onClose?.();
            }}
            aria-label={translateString("Close")}
            className={`alert-close flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${hoverClassName}`}
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default Alert;
