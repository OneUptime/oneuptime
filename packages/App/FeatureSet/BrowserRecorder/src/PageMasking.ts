import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";

/*
 * What the PAGE asks of masking, on top of the application's policy.
 *
 * The policy (the RUM application's settings, served as the replay config)
 * decides how much is masked. A page can ask for more, never for less:
 *
 *   window.__ONEUPTIME_SESSION_REPLAY__ = {
 *     host, token, appIdentifier,
 *     maskAllText: true,                       // MaskAllText, whatever the policy says
 *     blockSelectors: ["img", "pre", "code"],  // added to the policy's
 *   };
 *
 * It exists for a page that knows it shows other people's data and must not
 * depend on somebody keeping a setting right elsewhere: OneUptime's own
 * Dashboard (issue #6834) forces MaskAllText and blocks images, canvases,
 * code and log lines this way, so a policy changed by mistake cannot record
 * a customer's logs in plain text.
 *
 * Read from the init global only, and here rather than in Config: the loader
 * stub reads the init options under a byte budget, and nothing it decides
 * depends on these two. Bundled into the recorder artifact only - the loader
 * must never import this file (SourceHygiene.test.ts).
 */

const INIT_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY__";

// As many as a page sensibly lists, each as long as a selector sensibly is.
export const MAX_PAGE_BLOCK_SELECTORS: number = 50;
export const MAX_PAGE_BLOCK_SELECTOR_LENGTH: number = 200;

export interface PageMaskingOptions {
  maskAllText: boolean;
  blockSelectors: Array<string>;
}

/*
 * A selector the browser can parse, or false. rrweb receives every block
 * selector joined into one, so a single bad entry would make the whole list
 * fail to match - or throw inside rrweb's serializer on the host page.
 */
function isUsableSelector(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

export function readPageMaskingOptions(
  windowRef: Window | null | undefined,
): PageMaskingOptions {
  const options: PageMaskingOptions = {
    maskAllText: false,
    blockSelectors: [],
  };

  let raw: unknown = null;

  try {
    raw = windowRef
      ? (windowRef as unknown as Record<string, unknown>)[INIT_GLOBAL]
      : null;
  } catch {
    return options;
  }

  if (!raw || typeof raw !== "object") {
    return options;
  }

  const record: Record<string, unknown> = raw as Record<string, unknown>;

  options.maskAllText = record["maskAllText"] === true;

  const selectors: unknown = record["blockSelectors"];

  if (Array.isArray(selectors)) {
    for (const selector of selectors) {
      if (options.blockSelectors.length >= MAX_PAGE_BLOCK_SELECTORS) {
        break;
      }

      if (
        typeof selector === "string" &&
        selector.trim() &&
        selector.length <= MAX_PAGE_BLOCK_SELECTOR_LENGTH &&
        isUsableSelector(selector.trim())
      ) {
        options.blockSelectors.push(selector.trim());
      }
    }
  }

  return options;
}

/*
 * The policy with the page's requests applied: MaskAllText when the page
 * asks for it, and the page's block selectors after the policy's. A new
 * object; the policy itself is left as it came.
 */
export function applyPageMasking<TConfig extends SessionReplayConfigResponse>(
  config: TConfig,
  page: PageMaskingOptions,
): TConfig {
  if (!page.maskAllText && page.blockSelectors.length === 0) {
    return config;
  }

  const blockSelectors: Array<string> = config.blockSelectors.slice();

  for (const selector of page.blockSelectors) {
    if (!blockSelectors.includes(selector)) {
      blockSelectors.push(selector);
    }
  }

  return {
    ...config,
    maskingMode: page.maskAllText
      ? SessionReplayMaskingMode.MaskAllText
      : config.maskingMode,
    blockSelectors: blockSelectors,
  };
}
