import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import OneUptimeDate from "../../../Types/Date";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface ComponentProps {
  value?: string | Date | undefined; // ISO string or Date
  onChange?: undefined | ((value: string) => void); // emits ISO string
  placeholder?: string | undefined;
  className?: string | undefined;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  tabIndex?: number | undefined;
  autoFocus?: boolean | undefined;
  error?: string | undefined;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max);

const toDate = (v?: string | Date): Date | undefined => {
  if (!v) return undefined;
  try {
    return OneUptimeDate.fromString(v);
  } catch {
    return undefined;
  }
};

const TimePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const userPrefers12h: boolean = useMemo(
    () => OneUptimeDate.getUserPrefers12HourFormat(),
    [],
  );

  const initialDate: Date = useMemo(() => {
    return toDate(props.value) || OneUptimeDate.getCurrentDate();
  }, [props.value]);

  const [hours24, setHours24] = useState<number>(initialDate.getHours());
  const [minutes, setMinutes] = useState<number>(initialDate.getMinutes());

  const hoursInputRef = useRef<HTMLInputElement | null>(null);
  const minutesInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const d: Date | undefined = toDate(props.value);
    if (!d) return;
    setHours24(d.getHours());
    setMinutes(d.getMinutes());
  }, [props.value]);

  const emitChange = (h24: number, m: number) => {
    const date: Date = OneUptimeDate.getDateWithCustomTime({
      hours: clamp(h24, 0, 23),
      minutes: clamp(m, 0, 59),
      seconds: 0,
    });
    props.onChange?.(OneUptimeDate.toString(date));
  };

  const display = useMemo(() => {
    if (userPrefers12h) {
      const isPM: boolean = hours24 >= 12;
      const hr12: number = ((hours24 + 11) % 12) + 1; // 0->12
      return { hours: pad2(hr12), minutes: pad2(minutes), isPM };
    }
    return { hours: pad2(hours24), minutes: pad2(minutes), isPM: false };
  }, [hours24, minutes, userPrefers12h]);

  const setFromInputs = (hStr: string, mStr: string, isPM?: boolean) => {
    let h = parseInt(hStr.replace(/\D/g, "")) || 0;
    let m = parseInt(mStr.replace(/\D/g, "")) || 0;
    h = clamp(h, 0, userPrefers12h ? 12 : 23);
    m = clamp(m, 0, 59);

    let newH24 = h;
    if (userPrefers12h) {
      if (h === 12) {
        newH24 = isPM ? 12 : 0;
      } else {
        newH24 = isPM ? h + 12 : h;
      }
    }

    setHours24(newH24);
    setMinutes(m);
    emitChange(newH24, m);
  };

  const incrementHours = (delta: number) => {
    const newH = (hours24 + delta + 24) % 24;
    setHours24(newH);
    emitChange(newH, minutes);
  };

  const incrementMinutes = (delta: number) => {
    let total = minutes + delta;
    let newH = hours24;
    while (total < 0) {
      total += 60;
      newH = (newH + 23) % 24;
    }
    while (total >= 60) {
      total -= 60;
      newH = (newH + 1) % 24;
    }
    setHours24(newH);
    setMinutes(total);
    emitChange(newH, total);
  };

  const clickable = !(props.readOnly || props.disabled);

  const baseClass =
    props.className ||
    "flex items-center w-full rounded-md border border-gray-300 bg-white text-sm focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 shadow-sm";

  const inputClass =
    "w-12 text-center py-2 outline-none bg-transparent focus:outline-none" +
    (props.readOnly || props.disabled ? " text-gray-500" : " text-gray-900");

  const buttonClass =
    "flex flex-col items-center justify-center px-1 text-gray-400 hover:text-gray-600" +
    (clickable ? " cursor-pointer" : " cursor-not-allowed");

  return (
    <>
      <div
        className={
          (props.error
            ? baseClass +
              " border-red-300 focus-within:border-red-500 focus-within:ring-red-500"
            : baseClass) + (props.disabled ? " bg-gray-100" : "")
        }
      >
        {/* Hours */}
        <input
          ref={hoursInputRef}
          data-testid={props.dataTestId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus={props.autoFocus}
          tabIndex={props.tabIndex}
          spellCheck={false}
          placeholder={props.placeholder || (userPrefers12h ? "hh" : "HH")}
          className={inputClass + " rounded-l-md pl-3"}
          readOnly={props.readOnly || props.disabled || false}
          value={display.hours}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          onKeyDown={(e) => {
            if (!clickable) return;
            if (e.key === "ArrowUp") {
              e.preventDefault();
              incrementHours(1);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              incrementHours(-1);
            }
          }}
          onChange={(e) => {
            if (!clickable) return;
            setFromInputs(e.target.value, display.minutes, display.isPM);
          }}
        />

        <span className="px-1 text-gray-500">:</span>

        {/* Minutes */}
        <input
          ref={minutesInputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          spellCheck={false}
          placeholder="mm"
          className={inputClass + " rounded-r-md pr-1"}
          readOnly={props.readOnly || props.disabled || false}
          value={display.minutes}
          onKeyDown={(e) => {
            if (!clickable) return;
            if (e.key === "ArrowUp") {
              e.preventDefault();
              incrementMinutes(1);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              incrementMinutes(-1);
            }
          }}
          onChange={(e) => {
            if (!clickable) return;
            setFromInputs(display.hours, e.target.value, display.isPM);
          }}
        />

        {/* Steppers */}
        <div className={buttonClass + " ml-auto mr-1 select-none"}>
          <button
            type="button"
            aria-label="Increase time"
            disabled={!clickable}
            className="p-1"
            onClick={() => incrementMinutes(1)}
          >
            <Icon icon={IconProp.ChevronUp} className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Decrease time"
            disabled={!clickable}
            className="p-1"
            onClick={() => incrementMinutes(-1)}
          >
            <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
          </button>
        </div>

        {userPrefers12h && (
          <div className="border-l border-gray-200 pl-2 pr-2 ml-1 mr-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={
                  "px-2 py-1 rounded text-xs " +
                  (display.isPM
                    ? "bg-white text-gray-700 border border-gray-300"
                    : "bg-indigo-50 text-indigo-700 border border-indigo-200")
                }
                disabled={!clickable}
                onClick={() => {
                  if (!display.isPM) return; // already AM
                  // switch to AM
                  const h = hours24 >= 12 ? hours24 - 12 : hours24;
                  setHours24(h);
                  emitChange(h, minutes);
                }}
              >
                AM
              </button>
              <button
                type="button"
                className={
                  "px-2 py-1 rounded text-xs " +
                  (display.isPM
                    ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                    : "bg-white text-gray-700 border border-gray-300")
                }
                disabled={!clickable}
                onClick={() => {
                  if (display.isPM) return; // already PM
                  // switch to PM
                  const h = hours24 < 12 ? hours24 + 12 : hours24;
                  setHours24(h);
                  emitChange(h, minutes);
                }}
              >
                PM
              </button>
            </div>
          </div>
        )}

        {props.error && (
          <div className="pointer-events-none flex items-center pr-3">
            <Icon icon={IconProp.ErrorSolid} className="h-5 w-5 text-red-500" />
          </div>
        )}
      </div>

      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </>
  );
};

export default TimePicker;
