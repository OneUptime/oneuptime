import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import RememberedView from "Common/UI/Components/ViewSwitch/RememberedView";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  LLM_CONNECT_DEFAULT_WAY,
  LLM_CONNECT_WAYS,
  LLM_CONNECT_WAY_KEYS,
  LLM_CONNECT_WAY_STORAGE_KEY,
  LlmConnectWay,
  LlmConnectWayChip,
  LlmConnectWayKey,
  LlmConnectWayStatus,
  getLlmConnectWayChips,
} from "./LlmConnectWays";

/*
 * The top of AI / LLM > Connect: the three ways AI comes in, side by side,
 * each saying what it brings and whether it is working yet. They are the
 * page's tabs: picking one shows its path under them, and the others wait
 * a click away - a reader who came to connect OpenAI sees the provider
 * tiles, not an ingestion key.
 *
 * A way ticks itself from what is true (LlmConnectWayStatus): AI calls
 * arriving, accounts or tools connected, and any of them not working.
 */

// The reader's last pick, for the next visit (the address wins over it).
export const llmConnectWayChoice: RememberedView<LlmConnectWayKey> =
  new RememberedView<LlmConnectWayKey>({
    storageKey: LLM_CONNECT_WAY_STORAGE_KEY,
    values: LLM_CONNECT_WAY_KEYS,
    defaultValue: LLM_CONNECT_DEFAULT_WAY,
  });

export function getLlmConnectWayTabId(key: LlmConnectWayKey): string {
  return `llm-connect-way-${key}`;
}

export function getLlmConnectWayPanelId(key: LlmConnectWayKey): string {
  return `llm-connect-panel-${key}`;
}

const CHIP_TONES: Record<
  LlmConnectWayChip["tone"],
  { className: string; icon: IconProp }
> = {
  success: {
    className: "bg-emerald-50 text-emerald-700",
    icon: IconProp.Check,
  },
  danger: {
    className: "bg-red-50 text-red-700",
    icon: IconProp.Alert,
  },
};

export interface ComponentProps {
  value: LlmConnectWayKey;
  statuses: Record<LlmConnectWayKey, LlmConnectWayStatus>;
  /*
   * A way picked: clicked or tapped, or reached with the arrow keys (the
   * page then keeps the reader where they are, on the tabs).
   */
  onChange: (key: LlmConnectWayKey, withKeyboard: boolean) => void;
}

const LlmConnectWayPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Arrow keys move along the tabs, as a tab list's do; Home and End jump.
  const onKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    const last: number = LLM_CONNECT_WAYS.length - 1;
    let next: number | undefined = undefined;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = index === last ? 0 : index + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = index === 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }

    if (next === undefined) {
      return;
    }

    event.preventDefault();

    const way: LlmConnectWay = LLM_CONNECT_WAYS[next]!;
    props.onChange(way.key, true);
    document.getElementById(getLlmConnectWayTabId(way.key))?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={translator.translateText("Ways to bring AI in")}
      // Side by side from lg: three to a row at 768px left each one 200px.
      className="grid grid-cols-1 gap-3 lg:grid-cols-3"
      data-testid="llm-connect-ways"
    >
      {LLM_CONNECT_WAYS.map((way: LlmConnectWay, index: number) => {
        const isActive: boolean = way.key === props.value;
        const status: LlmConnectWayStatus = props.statuses[way.key];
        const chips: Array<LlmConnectWayChip> = getLlmConnectWayChips(
          way.key,
          status,
        );

        return (
          <button
            key={way.key}
            type="button"
            role="tab"
            id={getLlmConnectWayTabId(way.key)}
            aria-selected={isActive}
            aria-controls={getLlmConnectWayPanelId(way.key)}
            tabIndex={isActive ? 0 : -1}
            data-testid={getLlmConnectWayTabId(way.key)}
            data-done={
              status.isSetUp === undefined ? "unknown" : String(status.isSetUp)
            }
            onClick={() => {
              if (!isActive) {
                props.onChange(way.key, false);
              }
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
              onKeyDown(event, index);
            }}
            className={`flex h-full w-full items-start gap-3 rounded-lg border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              isActive
                ? "border-indigo-500 bg-indigo-50 shadow-sm"
                : "border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                isActive
                  ? "bg-indigo-100 text-indigo-600"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              <Icon icon={way.icon} className="h-5 w-5" />
            </span>
            <span className="block min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">
                {translator.translateText(way.title)}
              </span>
              <span className="mt-1 block text-sm text-gray-600">
                {translator.translateText(way.description)}
              </span>
              {chips.length > 0 ? (
                <span
                  className="mt-2 flex flex-wrap gap-1.5"
                  data-testid={`${getLlmConnectWayTabId(way.key)}-status`}
                >
                  {chips.map((chip: LlmConnectWayChip): ReactElement => {
                    return (
                      <span
                        key={chip.key}
                        data-testid={`${getLlmConnectWayTabId(way.key)}-${chip.key}`}
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_TONES[chip.tone].className}`}
                      >
                        <Icon
                          icon={CHIP_TONES[chip.tone].icon}
                          className="h-3 w-3"
                        />
                        {chip.count !== undefined
                          ? translator.translateTemplate(chip.text, {
                              count: String(chip.count),
                            })
                          : translator.translateText(chip.text)}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <></>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default LlmConnectWayPicker;
