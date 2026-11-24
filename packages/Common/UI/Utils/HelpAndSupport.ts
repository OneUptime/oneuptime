import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";
import { APP_API_URL, env } from "../Config";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import {
  HELP_AND_SUPPORT_ENVIRONMENT_KEY,
  HELP_AND_SUPPORT_LINKS_ITEMS,
  HELP_AND_SUPPORT_LINKS_ROUTE,
  HelpAndSupportSettings,
  fromHelpAndSupportEnvironmentValue,
  readHelpAndSupportSettings,
} from "../../Types/HelpAndSupport/HelpAndSupport";
import { useSyncExternalStore } from "react";

/*
 * WHERE THIS SERVER SENDS ITS PEOPLE FOR HELP, IN THE BROWSER
 * (#10864-#10866). The rules are in Types/HelpAndSupport/HelpAndSupport.
 *
 *   - What env.js carried is known before the page draws (getSettings):
 *     every place's choice, the support address and the help page. So an
 *     error screen names the right address however the page broke, and
 *     nothing set to Hidden ever shows for a moment.
 *   - The links env.js holds back - a chat link, the mobile app's page - are
 *     read from the server once, when a signed-in Dashboard starts (load).
 *     Until they arrive, a place that uses one shows nothing rather than
 *     OneUptime's, and every component that draws one is drawn again when
 *     they do (useHelpAndSupport).
 *
 * Read at call time, never at module load, so a test (or a page that set
 * window.process.env late) sees the current value. None of it throws.
 */

type Listener = () => void;

/*
 * What env.js carried, or nothing when it cannot be read at all. The crash
 * screen reads the settings while the page is breaking, so this never
 * throws: a screen that cannot name the server's own address names
 * OneUptime's, as it always did, rather than going blank.
 */
const readEnvironmentValue: () => string = (): string => {
  try {
    return env(HELP_AND_SUPPORT_ENVIRONMENT_KEY) || "";
  } catch {
    return "";
  }
};

export default class HelpAndSupport {
  // What the server answered a signed-in person, or null until it has.
  private static loaded: HelpAndSupportSettings | null = null;
  private static listeners: Set<Listener> = new Set<Listener>();
  // The settings as they were last put together, and from what.
  private static lastRawValue: string | null = null;
  private static lastLoaded: HelpAndSupportSettings | null = null;
  private static lastSettings: HelpAndSupportSettings | null = null;

  /*
   * Every place's settings: env.js's, with the links signed-in people read
   * from the server in place once they have. The same object until one of
   * the two changes, as a React store's snapshot must be.
   */
  public static getSettings(): HelpAndSupportSettings {
    const rawValue: string = readEnvironmentValue();

    if (
      HelpAndSupport.lastSettings &&
      rawValue === HelpAndSupport.lastRawValue &&
      HelpAndSupport.loaded === HelpAndSupport.lastLoaded
    ) {
      return HelpAndSupport.lastSettings;
    }

    const settings: HelpAndSupportSettings =
      fromHelpAndSupportEnvironmentValue(rawValue);

    if (HelpAndSupport.loaded) {
      for (const item of HELP_AND_SUPPORT_LINKS_ITEMS) {
        settings[item] = { ...HelpAndSupport.loaded[item] };
      }
    }

    HelpAndSupport.lastRawValue = rawValue;
    HelpAndSupport.lastLoaded = HelpAndSupport.loaded;
    HelpAndSupport.lastSettings = settings;

    return settings;
  }

  // Whether the server's answer has arrived.
  public static isLoaded(): boolean {
    return HelpAndSupport.loaded !== null;
  }

  // What the server answered (or null to forget it): tests, and load.
  public static setLoaded(settings: HelpAndSupportSettings | null): void {
    HelpAndSupport.loaded = settings;

    for (const listener of Array.from(HelpAndSupport.listeners)) {
      listener();
    }
  }

  public static subscribe(listener: Listener): () => void {
    HelpAndSupport.listeners.add(listener);

    return () => {
      HelpAndSupport.listeners.delete(listener);
    };
  }

  /*
   * Reads the links a signed-in person sees from the server. On any failure
   * nothing changes: a place whose link was not read keeps showing nothing.
   */
  public static async load(): Promise<void> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute(
            new Route(HELP_AND_SUPPORT_LINKS_ROUTE),
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
        return;
      }

      HelpAndSupport.setLoaded(readHelpAndSupportSettings(response.data));
    } catch {
      // Nothing changes: no link is shown that was not read.
    }
  }
}

const subscribe: (listener: Listener) => () => void = (
  listener: Listener,
): (() => void) => {
  return HelpAndSupport.subscribe(listener);
};

const getSnapshot: () => HelpAndSupportSettings =
  (): HelpAndSupportSettings => {
    return HelpAndSupport.getSettings();
  };

// The settings, drawing the component again when the server's links arrive.
export const useHelpAndSupport: () => HelpAndSupportSettings =
  (): HelpAndSupportSettings => {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  };
