import UiAnalytics from "./Analytics";
import ProjectUtil from "./Project";
import UserUtil from "./User";
import { BILLING_ENABLED, IS_ENTERPRISE_EDITION } from "../Config";
import Project from "../../Models/DatabaseModels/Project";
import {
  ProductEventName,
  toProductEventProperties,
} from "../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../Types/JSON";

/*
 * Sends a behaviour event from the Dashboard (issue #6830):
 *
 *   ProductEvents.send(ProductEventName.ImporterOpened, { from: "home" });
 *
 * The event's name and every property it may carry are in
 * Types/Analytics/ProductEvent (PRODUCT_EVENTS): a property it does not
 * list is dropped, a Cloud-only one is dropped off Cloud, and strings are
 * cut to their length, so nothing nobody reviewed is ever sent. Every event
 * also carries project_id, plan, edition, language and is_project_creator
 * (getCommonProperties).
 *
 * It goes where every Dashboard event goes (Utils/Analytics): to PostHog
 * only where ANALYTICS_KEY and ANALYTICS_HOST are set - OneUptime Cloud -
 * and only with the visitor's consent and without Global Privacy Control.
 * It never throws: a page never breaks because of an event.
 */
export default class ProductEvents {
  public static send(name: ProductEventName, properties?: JSONObject): void {
    try {
      UiAnalytics.capture(name, {
        ...ProductEvents.getCommonProperties(),
        ...toProductEventProperties({
          name: name,
          properties: properties,
          isCloud: ProductEvents.isCloud(),
        }),
      });
    } catch {
      // An event is never worth an error on the page.
    }
  }

  // OneUptime Cloud: billing is on.
  public static isCloud(): boolean {
    return BILLING_ENABLED;
  }

  public static isEnterpriseEdition(): boolean {
    return IS_ENTERPRISE_EDITION;
  }

  public static getEdition(): string {
    if (ProductEvents.isCloud()) {
      return "cloud";
    }

    return ProductEvents.isEnterpriseEdition() ? "enterprise" : "community";
  }

  // What every Dashboard event carries (COMMON_PRODUCT_EVENT_PROPERTIES).
  public static getCommonProperties(): JSONObject {
    const properties: JSONObject = {
      edition: ProductEvents.getEdition(),
      language: ProductEvents.getLanguage(),
    };

    try {
      const projectId: string | undefined =
        ProjectUtil.getCurrentProjectId()?.toString();

      if (projectId) {
        properties["project_id"] = projectId;
      }

      properties["plan"] = ProjectUtil.getCurrentPlan() || "";

      const project: Project | null = ProjectUtil.getCurrentProject();
      const creatorId: string | undefined = project?.createdByUserId
        ?.toString()
        .toLowerCase();
      const userId: string = UserUtil.getUserId().toString().toLowerCase();

      if (creatorId && userId) {
        properties["is_project_creator"] = creatorId === userId;
      }
    } catch {
      // What could not be read is left out.
    }

    return properties;
  }

  // The language the Dashboard shows its words in (<html lang>).
  public static getLanguage(): string {
    try {
      if (typeof document !== "undefined" && document.documentElement?.lang) {
        return document.documentElement.lang;
      }
    } catch {
      // A page without a document says English.
    }

    return "en";
  }
}
