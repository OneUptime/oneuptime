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
import Modal, { ModalWidth } from "../Modal/Modal";

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

const pad2: (n: number) => string = (n: number): string => {
  return n < 10 ? `0${n}` : `${n}`;
};

const clamp: (n: number, min: number, max: number) => number = (
  n: number,
  min: number,
  max: number,
): number => {
  return Math.min(Math.max(n, min), max);
};

const toDate: (v?: string | Date) => Date | undefined = (
  v?: string | Date,
): Date | undefined => {
  if (!v) {
    return undefined;
  }
  try {
    return OneUptimeDate.fromString(v);
  } catch {
    return undefined;
  }
};

const TimePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Start with project-level preference (works on server), then update to browser preference on mount
  const [userPrefers12h, setUserPrefers12h] = useState<boolean>(
    OneUptimeDate.getUserPrefers12HourFormat(),
  );

  useEffect((): void => {
    // Resolve to actual browser preference once mounted using project utility
    setUserPrefers12h(OneUptimeDate.getUserPrefers12HourFormat());
  }, []);

  // Timezone label derived from OneUptimeDate utilities (e.g., "PDT (America/Los_Angeles)" or "GMT+5:30 (Asia/Kolkata)")
  const [timezoneLabel, setTimezoneLabel] = useState<string>("your local time zone");

  useEffect((): void => {
    const abbr: string = OneUptimeDate.getCurrentTimezoneString();
    const iana: string = OneUptimeDate.getCurrentTimezone() as unknown as string;
    setTimezoneLabel(`${abbr}${iana ? ` (${iana})` : ""}`);
  }, []);

  const initialDate: Date = useMemo(() => {
    return toDate(props.value) || OneUptimeDate.getCurrentDate();
  }, [props.value]);

  const [hours24, setHours24] = useState<number>(initialDate.getHours());
  const [minutes, setMinutes] = useState<number>(initialDate.getMinutes());

  const hoursInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);
  const minutesInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState<boolean>(false);
  const [tempHours24, setTempHours24] = useState<number>(hours24);
  const [tempMinutes, setTempMinutes] = useState<number>(minutes);

  useEffect(() => {
    const d: Date | undefined = toDate(props.value);
    if (!d) {
      return;
    }
    setHours24(d.getHours());
    setMinutes(d.getMinutes());
  }, [props.value]);

  const emitChange: (h24: number, m: number) => void = (
    h24: number,
    m: number,
  ): void => {
    const date: Date = OneUptimeDate.getDateWithCustomTime({
      hours: clamp(h24, 0, 23),
      minutes: clamp(m, 0, 59),
      seconds: 0,
    });
    props.onChange?.(OneUptimeDate.toString(date));
  };

  const display: { hours: string; minutes: string; isPM: boolean } =
    useMemo(() => {
      if (userPrefers12h) {
        const isPM: boolean = hours24 >= 12;
        const hr12: number = ((hours24 + 11) % 12) + 1; // 0->12
        return { hours: pad2(hr12), minutes: pad2(minutes), isPM };
      }
      return { hours: pad2(hours24), minutes: pad2(minutes), isPM: false };
    }, [hours24, minutes, userPrefers12h]);

  // Inline editing disabled; all updates happen inside modal

  const clickable: boolean = !(props.readOnly || props.disabled);

  const baseClass: string =
    props.className ||
    "flex items-center w-full rounded-md border border-gray-300 bg-white text-sm focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 shadow-sm";

  const inputClass: string =
    "w-14 text-center py-2 outline-none bg-transparent leading-snug focus:outline-none" +
    (props.readOnly || props.disabled ? " text-gray-500" : " text-gray-900");

  const openModal: () => void = (): void => {
    if (!clickable) {
      return;
    }
    setTempHours24(hours24);
    setTempMinutes(minutes);
    setShowModal(true);
  };

  return (
    <>
      <div
        className={
          (props.error
            ? baseClass +
              " border-red-300 focus-within:border-red-500 focus-within:ring-red-500"
            : baseClass) +
          (props.disabled ? " bg-gray-100" : "") +
          (clickable
            ? " cursor-pointer hover:bg-gray-50"
            : " cursor-not-allowed") +
          " mt-2"
        }
        role="group"
        aria-label="Time input"
        aria-disabled={props.disabled ? true : undefined}
        aria-describedby={props.error ? "timepicker-error" : undefined}
        onClick={openModal}
        aria-haspopup="dialog"
        aria-expanded={showModal || undefined}
      >
        {/* Left time icon */}
        <div className="pl-2 pr-2 text-gray-400" aria-hidden="true">
          <Icon icon={IconProp.Time} className="h-5 w-5" />
        </div>

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
          className={
            inputClass +
            " rounded-l-md pl-1 focus:ring-0 focus-visible:outline-none"
          }
          readOnly={true}
          aria-label="Hours"
          aria-invalid={props.error ? true : undefined}
          value={display.hours}
          onFocus={props.onFocus}
          onBlur={() => {
            return props.onBlur?.();
          }}
        />

        <span className="px-2 text-gray-500">:</span>

        {/* Minutes */}
        <input
          ref={minutesInputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          spellCheck={false}
          placeholder="mm"
          className={
            inputClass +
            " rounded-r-md pr-2 focus:ring-0 focus-visible:outline-none"
          }
          readOnly={true}
          aria-label="Minutes"
          aria-invalid={props.error ? true : undefined}
          value={display.minutes}
          onBlur={() => {
            return props.onBlur?.();
          }}
        />

        {/* spacer to maintain layout without right icon */}
        <div className="ml-auto mr-1" />

        {userPrefers12h && (
          <div className="border-l border-gray-200 pl-2 pr-2 ml-1 mr-1">
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="AM or PM"
            >
              <button
                type="button"
                className={
                  "px-2 py-1 rounded text-xs " +
                  (display.isPM
                    ? "bg-white text-gray-700 border border-gray-300"
                    : "bg-indigo-50 text-indigo-700 border border-indigo-200")
                }
                disabled={!clickable}
                aria-pressed={!display.isPM}
                aria-label="Open time selector for AM/PM"
                onClick={openModal}
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
                aria-pressed={display.isPM}
                aria-label="Open time selector for AM/PM"
                onClick={openModal}
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

      {/* Time picker modal */}
      {showModal && (
        <Modal
          title="Select time"
          description={
            userPrefers12h
              ? "Choose hours, minutes, and AM/PM"
              : "Choose hours and minutes"
          }
          modalWidth={ModalWidth.Medium}
          onClose={() => {
            return setShowModal(false);
          }}
          onSubmit={() => {
            setHours24(tempHours24);
            setMinutes(tempMinutes);
            emitChange(tempHours24, tempMinutes);
            setShowModal(false);
          }}
          submitButtonText="Apply"
        >
          <div className="p-2">
            <div className="mb-4 text-sm text-gray-500">
              This time is in your {timezoneLabel}
            </div>
            <div className="flex items-center justify-center gap-6">
              {/* Hours selector */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  aria-label="Increase hours"
                  className="p-2 rounded hover:bg-gray-50"
                  onClick={() => {
                    return setTempHours24((h: number): number => {
                      return (h + 1) % 24;
                    });
                  }}
                >
                  <Icon icon={IconProp.ChevronUp} className="h-6 w-6" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="Hours"
                  className="w-20 text-center text-3xl font-semibold py-2 rounded border border-gray-200 focus:ring-2 focus:ring-indigo-500"
                  value={
                    userPrefers12h
                      ? pad2(((tempHours24 + 11) % 12) + 1)
                      : pad2(tempHours24)
                  }
                  onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                    const raw: string = e.target.value.replace(/\D/g, "");
                    let h: number = parseInt(raw || "0", 10);
                    if (userPrefers12h) {
                      h = clamp(h, 1, 12);
                      // map back to 24h preserving period
                      const isPM: boolean = tempHours24 >= 12;
                      const newH: number =
                        h === 12 ? (isPM ? 12 : 0) : isPM ? h + 12 : h;
                      setTempHours24(newH);
                    } else {
                      setTempHours24(clamp(h, 0, 23));
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label="Decrease hours"
                  className="p-2 rounded hover:bg-gray-50"
                  onClick={(): void => {
                    return setTempHours24((h: number): number => {
                      return (h + 23) % 24;
                    });
                  }}
                >
                  <Icon icon={IconProp.ChevronDown} className="h-6 w-6" />
                </button>
              </div>

              <div className="text-3xl font-semibold text-gray-500">:</div>

              {/* Minutes selector */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  aria-label="Increase minutes"
                  className="p-2 rounded hover:bg-gray-50"
                  onClick={(): void => {
                    let m: number = tempMinutes + 1;
                    let h: number = tempHours24;
                    if (m >= 60) {
                      m = 0;
                      h = (h + 1) % 24;
                    }
                    setTempMinutes(m);
                    setTempHours24(h);
                  }}
                >
                  <Icon icon={IconProp.ChevronUp} className="h-6 w-6" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="Minutes"
                  className="w-20 text-center text-3xl font-semibold py-2 rounded border border-gray-200 focus:ring-2 focus:ring-indigo-500"
                  value={pad2(tempMinutes)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                    const raw: string = e.target.value.replace(/\D/g, "");
                    const m: number = clamp(parseInt(raw || "0", 10), 0, 59);
                    setTempMinutes(m);
                  }}
                />
                <button
                  type="button"
                  aria-label="Decrease minutes"
                  className="p-2 rounded hover:bg-gray-50"
                  onClick={(): void => {
                    let m: number = tempMinutes - 1;
                    let h: number = tempHours24;
                    if (m < 0) {
                      m = 59;
                      h = (h + 23) % 24;
                    }
                    setTempMinutes(m);
                    setTempHours24(h);
                  }}
                >
                  <Icon icon={IconProp.ChevronDown} className="h-6 w-6" />
                </button>
              </div>

              {/* AM/PM */}
              {userPrefers12h && (
                <div className="ml-2 flex flex-col items-stretch gap-2">
                  <button
                    type="button"
                    className={`px-3 py-2 rounded text-sm border ${tempHours24 < 12 ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-white text-gray-700 border-gray-300"}`}
                    aria-pressed={tempHours24 < 12}
                    onClick={() => {
                      if (tempHours24 >= 12) {
                        setTempHours24(tempHours24 - 12);
                      }
                    }}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-2 rounded text-sm border ${tempHours24 >= 12 ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-white text-gray-700 border-gray-300"}`}
                    aria-pressed={tempHours24 >= 12}
                    onClick={() => {
                      if (tempHours24 < 12) {
                        setTempHours24(tempHours24 + 12);
                      }
                    }}
                  >
                    PM
                  </button>
                </div>
              )}
            </div>

            {/* Quick minutes */}
            <div className="mt-6">
              <div className="text-sm text-gray-500 mb-2">Quick minutes</div>
              <div className="grid grid-cols-6 gap-2">
                {[0, 5, 10, 15, 30, 45].map((m: number) => {
                  return (
                    <button
                      key={m}
                      type="button"
                      className={`px-2 py-1 rounded border text-sm ${tempMinutes === m ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-white text-gray-700 border-gray-300"}`}
                      onClick={(): void => {
                        return setTempMinutes(m);
                      }}
                    >
                      {pad2(m)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {props.error && (
        <p
          id="timepicker-error"
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
          aria-live="polite"
        >
          {props.error}
        </p>
      )}
    </>
  );
};

export default TimePicker;
