import { LLM_MONITOR_WINDOW_OPTIONS } from "Common/Types/Monitor/MonitorStepLlmMonitor";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { formatLlmDuration } from "../LlmConversations/LlmConversationFormat";

/*
 * The windows an AI / LLM monitor's check can read, in words: the monitor
 * form's dropdown and the preview's heading say "Last 15 minutes" the same
 * way.
 */

export const LLM_MONITOR_WINDOW_LABELS: Record<number, string> = {
  300: translationKey("Last 5 minutes"),
  900: translationKey("Last 15 minutes"),
  1800: translationKey("Last 30 minutes"),
  3600: translationKey("Last 1 hour"),
  21600: translationKey("Last 6 hours"),
  86400: translationKey("Last 24 hours"),
};

// A window in the reader's words: "Last 15 minutes", or "Last 2m 00s".
export function getLlmMonitorWindowLabel(
  seconds: number,
  translator: Translator,
): string {
  const label: string | undefined = LLM_MONITOR_WINDOW_LABELS[seconds];

  if (label) {
    return translator.translateText(label) || label;
  }

  return translator.translateTemplate("Last {{duration}}", {
    duration: formatLlmDuration(seconds * 1000),
  });
}

/*
 * The dropdown's options, in English (the dropdown translates its own
 * labels): the standard windows, and a window set through the API in its
 * place in the list, so editing a monitor never drops it.
 */
export function getLlmMonitorWindowOptions(
  current: number,
): Array<DropdownOption> {
  const seconds: Array<number> = [...LLM_MONITOR_WINDOW_OPTIONS];

  if (Number.isFinite(current) && current > 0 && !seconds.includes(current)) {
    seconds.push(current);
    seconds.sort((left: number, right: number): number => {
      return left - right;
    });
  }

  return seconds.map((value: number): DropdownOption => {
    return {
      label:
        LLM_MONITOR_WINDOW_LABELS[value] || formatLlmDuration(value * 1000),
      value: value,
    };
  });
}
