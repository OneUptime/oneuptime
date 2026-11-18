import ProductEvents from "./ProductEvents";
import { ProductEventName } from "../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../Types/JSON";
import React, { useEffect, useRef } from "react";

/*
 * A guided setup's events (issue #6830, for the guided setups #6804, #6805
 * and #6806): guided_setup/started when it opens, guided_setup/step_reached
 * as it moves on, guided_setup/finished at its end - the thing works and was
 * tested - and guided_setup/left, with the step, when it is left before
 * that. In a setup's page:
 *
 *   const setupEvents: GuidedSetupEvents = useGuidedSetupEvents("website_down");
 *   setupEvents.reachStep("pick_who_to_tell");   // each step, as it shows
 *   setupEvents.finish();                        // once the test page arrived
 *
 * The hook sends started when the page mounts, and left when it unmounts or
 * the tab closes before finish(). The setup's and the steps' keys are
 * words the code chooses (snake_case), never what a person typed.
 *
 * Started says where the setup was opened from (`from`, #7054) when a way
 * in names itself: the way in puts `?from=<entry point>` on the setup's
 * address (getGuidedSetupEntryPoint). Only the entry points below are
 * sent - an address anyone can type sends nothing it does not know.
 */

// The ways into a guided setup that name themselves (?from=).
export enum GuidedSetupEntryPoint {
  // A product's empty list, whose explanation offers its setup (#7148, #7054).
  EmptyList = "empty_list",
  // A product's How it works dialog (#7148, #7054).
  HowItWorks = "how_it_works",
  // Create Monitor, with Website or API picked (#7054).
  CreateMonitor = "create_monitor",
  // The website-down setup's summary: paging by phone, a status page (#7370, #7053).
  WebsiteDownSummary = "website_down_summary",
  /*
   * Home's "Get paged by SMS or phone call", while only email pages the
   * person who set the project up (#9442).
   */
  Home = "home",
}

export const GUIDED_SETUP_FROM_QUERY: string = "from";

const ENTRY_POINTS: ReadonlyArray<string> = Object.values(
  GuidedSetupEntryPoint,
) as Array<string>;

/*
 * The entry point a setup's address names, or null: anything else in it -
 * a typo, a word someone typed - is never sent.
 */
export const getGuidedSetupEntryPoint: (
  value: string | null | undefined,
) => GuidedSetupEntryPoint | null = (
  value: string | null | undefined,
): GuidedSetupEntryPoint | null => {
  return value && ENTRY_POINTS.includes(value)
    ? (value as GuidedSetupEntryPoint)
    : null;
};

// A setup's address, opened from `from`: "/dashboard/<id>/monitors/setup?from=empty_list".
export const withGuidedSetupEntryPoint: (
  route: string,
  from: GuidedSetupEntryPoint,
) => string = (route: string, from: GuidedSetupEntryPoint): string => {
  const separator: string = route.includes("?") ? "&" : "?";

  return `${route}${separator}${GUIDED_SETUP_FROM_QUERY}=${from}`;
};

export class GuidedSetupEvents {
  private readonly setup: string;
  private readonly from: GuidedSetupEntryPoint | null;
  private readonly now: () => number;
  private startedAtMs: number | null = null;
  private step: string | null = null;
  private stepNumber: number = 0;
  private isDone: boolean = false;

  public constructor(
    setup: string,
    now?: () => number,
    from?: GuidedSetupEntryPoint | null,
  ) {
    this.setup = setup;
    this.from = from || null;
    this.now =
      now ||
      ((): number => {
        return Date.now();
      });
  }

  public start(): void {
    if (this.startedAtMs !== null) {
      return;
    }

    this.startedAtMs = this.now();

    const properties: JSONObject = { setup: this.setup };

    if (this.from) {
      properties["from"] = this.from;
    }

    ProductEvents.send(ProductEventName.GuidedSetupStarted, properties);
  }

  // The setup moved on to this step. The same step twice in a row is once.
  public reachStep(step: string): void {
    if (this.isDone || step === this.step) {
      return;
    }

    this.step = step;
    this.stepNumber++;
    ProductEvents.send(ProductEventName.GuidedSetupStepReached, {
      ...this.getStepProperties(),
    });
  }

  // The setup reached its end. Nothing is sent for it after this.
  public finish(): void {
    if (this.isDone) {
      return;
    }

    this.isDone = true;

    const properties: JSONObject = { setup: this.setup };

    if (this.startedAtMs !== null) {
      properties["seconds_taken"] = Math.max(
        0,
        Math.round((this.now() - this.startedAtMs) / 1000),
      );
    }

    ProductEvents.send(ProductEventName.GuidedSetupFinished, properties);
  }

  // The setup was left before its end: at the step it was on.
  public leave(): void {
    if (this.isDone || this.startedAtMs === null) {
      return;
    }

    this.isDone = true;
    ProductEvents.send(ProductEventName.GuidedSetupLeft, {
      ...this.getStepProperties(),
    });
  }

  public isFinishedOrLeft(): boolean {
    return this.isDone;
  }

  private getStepProperties(): JSONObject {
    return {
      setup: this.setup,
      step: this.step || "",
      step_number: this.stepNumber,
    };
  }
}

/*
 * The setup's events for a page: started once on mount - with where it
 * was opened from, when the way in named itself - and left on unmount or
 * when the tab closes before finish().
 */
export const useGuidedSetupEvents: (
  setup: string,
  from?: GuidedSetupEntryPoint | null,
) => GuidedSetupEvents = (
  setup: string,
  from?: GuidedSetupEntryPoint | null,
): GuidedSetupEvents => {
  const eventsRef: React.MutableRefObject<GuidedSetupEvents | null> =
    useRef<GuidedSetupEvents | null>(null);

  if (!eventsRef.current) {
    eventsRef.current = new GuidedSetupEvents(setup, undefined, from);
  }

  const events: GuidedSetupEvents = eventsRef.current;

  useEffect(() => {
    events.start();

    const leaveOnClose: () => void = (): void => {
      events.leave();
    };

    window.addEventListener("pagehide", leaveOnClose);

    return () => {
      window.removeEventListener("pagehide", leaveOnClose);
      events.leave();
    };
  }, []);

  return events;
};
