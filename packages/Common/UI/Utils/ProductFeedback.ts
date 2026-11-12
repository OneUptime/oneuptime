import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";
import ProductEvents from "./ProductEvents";
import UserUtil from "./User";
import { APP_API_URL, VERSION } from "../Config";
import User from "../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { ProductEventName } from "../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../Types/JSON";
import {
  PRODUCT_FEEDBACK_ASK_ROUTE,
  PRODUCT_FEEDBACK_DETAILS_ROUTE,
  PRODUCT_FEEDBACK_ROUTE,
  PRODUCT_FEEDBACK_SETTINGS_ROUTE,
  ProductFeedbackKind,
  ProductFeedbackSettings,
  getFeedbackQuestionKey,
  readProductFeedbackSettings,
  toFeedbackPage,
} from "../../Types/ProductFeedback/ProductFeedback";
import { useSyncExternalStore } from "react";

/*
 * ASKING PEOPLE, IN THE BROWSER (issue #6832). The rules are in Types/
 * ProductFeedback/ProductFeedback; the server keeps the answers
 * (Server/API/ProductFeedbackAPI).
 *
 *   - The settings - does this server ask, does it ask me - are read once,
 *     when the Dashboard starts (loadSettings, from its App), and kept
 *     here for every component to read (useProductFeedbackSettings). Until
 *     they arrive, or when they cannot be read, nothing is asked and
 *     nothing is offered: a page drawn without the Dashboard around it
 *     asks nothing.
 *   - ask() asks the server whether to ask a question now; the server
 *     writes it down as asked when it says yes.
 *   - submit() keeps an answer, with the page as a route with no ids and
 *     the product version - nothing else - and sends feedback/given
 *     (Types/Analytics/ProductEvent) where product analytics is set up:
 *     never the words.
 *
 * None of them throws: feedback is never worth an error on the page.
 */

export interface ProductFeedbackAnswer {
  kind: ProductFeedbackKind;
  topic: string;
  score?: number | null | undefined;
  isPositive?: boolean | null | undefined;
  details?: string | null | undefined;
}

type Listener = () => void;

const apiUrl: (route: string) => URL = (route: string): URL => {
  return URL.fromURL(APP_API_URL).addRoute(new Route(route));
};

export default class ProductFeedback {
  private static settings: ProductFeedbackSettings | null = null;
  private static listeners: Set<Listener> = new Set<Listener>();
  /*
   * The page an answer was given on, as a route with no ids. The
   * Dashboard sets its own (the pattern of the route it matched); anything
   * else scrubs the address it is on (toFeedbackPage).
   */
  private static pageResolver: () => string = (): string => {
    try {
      return toFeedbackPage(window.location.pathname);
    } catch {
      return "/";
    }
  };

  public static getSettings(): ProductFeedbackSettings | null {
    return ProductFeedback.settings;
  }

  public static setSettings(settings: ProductFeedbackSettings | null): void {
    ProductFeedback.settings = settings;

    for (const listener of Array.from(ProductFeedback.listeners)) {
      listener();
    }
  }

  public static subscribe(listener: Listener): () => void {
    ProductFeedback.listeners.add(listener);

    return () => {
      ProductFeedback.listeners.delete(listener);
    };
  }

  // Whether this server takes feedback: Give feedback is offered.
  public static isOn(): boolean {
    return ProductFeedback.settings?.isOn === true;
  }

  // Whether OneUptime may ask this person: the questions, and the thumbs.
  public static isAskingMe(): boolean {
    return (
      ProductFeedback.settings?.isOn === true &&
      ProductFeedback.settings.isAskingMe === true
    );
  }

  public static setPageResolver(resolver: () => string): void {
    ProductFeedback.pageResolver = resolver;
  }

  // The page as it is attached to an answer: a route with no ids.
  public static getPage(): string {
    try {
      return toFeedbackPage(ProductFeedback.pageResolver());
    } catch {
      return "/";
    }
  }

  public static getVersion(): string {
    try {
      return VERSION.toString();
    } catch {
      return "";
    }
  }

  // Reads the settings from the server; on any failure, nothing is asked.
  public static async loadSettings(): Promise<void> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: apiUrl(PRODUCT_FEEDBACK_SETTINGS_ROUTE),
          headers: ModelAPI.getCommonHeaders(),
        });

      ProductFeedback.setSettings(
        response instanceof HTTPErrorResponse
          ? null
          : readProductFeedbackSettings(response.data),
      );
    } catch {
      ProductFeedback.setSettings(null);
    }
  }

  /*
   * Whether to ask this question now (the server decides, and writes it
   * down as asked when it says yes). False whenever this person is not
   * asked at all, without asking the server.
   */
  public static async ask(question: {
    kind: ProductFeedbackKind;
    topic: string;
  }): Promise<boolean> {
    if (!ProductFeedback.isAskingMe()) {
      return false;
    }

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: apiUrl(PRODUCT_FEEDBACK_ASK_ROUTE),
          data: { question: getFeedbackQuestionKey(question) },
          headers: ModelAPI.getCommonHeaders(),
        });

      return (
        !(response instanceof HTTPErrorResponse) &&
        (response.data as JSONObject | undefined)?.["ask"] === true
      );
    } catch {
      return false;
    }
  }

  /*
   * Keeps an answer on the server. Answers with its id, to add words to it
   * (addDetails), or null when it could not be kept.
   */
  public static async submit(
    answer: ProductFeedbackAnswer,
  ): Promise<string | null> {
    if (!ProductFeedback.isOn()) {
      return null;
    }

    const page: string = ProductFeedback.getPage();
    const details: string | null =
      typeof answer.details === "string" && answer.details.trim()
        ? answer.details.trim()
        : null;

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: apiUrl(PRODUCT_FEEDBACK_ROUTE),
          data: {
            kind: answer.kind,
            topic: answer.topic,
            score: answer.score ?? null,
            isPositive: answer.isPositive ?? null,
            details: details,
            page: page,
            version: ProductFeedback.getVersion(),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        return null;
      }

      const answerId: unknown = (response.data as JSONObject | undefined)?.[
        "answerId"
      ];

      // The score and what it was about, never the words.
      ProductEvents.send(ProductEventName.FeedbackGiven, {
        kind: answer.kind,
        topic: answer.topic,
        ...(typeof answer.score === "number" ? { score: answer.score } : {}),
        ...(typeof answer.isPositive === "boolean"
          ? { is_positive: answer.isPositive }
          : {}),
        has_details: Boolean(details),
        page: page,
      });

      return typeof answerId === "string" ? answerId : "";
    } catch {
      return null;
    }
  }

  // Adds the words written after a one-click answer. Whether they were kept.
  public static async addDetails(data: {
    answerId: string;
    details: string;
  }): Promise<boolean> {
    if (!data.answerId || !data.details.trim()) {
      return false;
    }

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: apiUrl(PRODUCT_FEEDBACK_DETAILS_ROUTE),
          data: {
            answerId: data.answerId,
            details: data.details.trim(),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      return (
        !(response instanceof HTTPErrorResponse) &&
        (response.data as JSONObject | undefined)?.["added"] === true
      );
    } catch {
      return false;
    }
  }

  /*
   * "Don't ask me again": switches this person's questions off on their
   * record (User Profile shows the same switch), and here at once.
   */
  public static async stopAsking(): Promise<void> {
    const settings: ProductFeedbackSettings | null = ProductFeedback.settings;

    if (settings) {
      ProductFeedback.setSettings({ ...settings, isAskingMe: false });
    }

    try {
      await ModelAPI.updateById<User>({
        modelType: User,
        id: UserUtil.getUserId(),
        data: {
          disableFeedbackQuestions: true,
        },
      });
    } catch {
      // Not asked again on this page either way.
    }
  }
}

const subscribe: (listener: Listener) => () => void = (
  listener: Listener,
): (() => void) => {
  return ProductFeedback.subscribe(listener);
};

const getSnapshot: () => ProductFeedbackSettings | null =
  (): ProductFeedbackSettings | null => {
    return ProductFeedback.getSettings();
  };

// The settings, drawing the component again when they arrive or change.
export const useProductFeedbackSettings: () => ProductFeedbackSettings | null =
  (): ProductFeedbackSettings | null => {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  };
