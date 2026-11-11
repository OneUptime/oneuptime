import LocalStorage from "./LocalStorage";
import ProductEvents from "./ProductEvents";
import {
  ChecklistProgressChange,
  getChecklistProgressChange,
} from "../../Types/Analytics/ChecklistProgress";
import { ProductEventName } from "../../Types/Analytics/ProductEvent";
import Dictionary from "../../Types/Dictionary";
import { JSONValue } from "../../Types/JSON";

/*
 * The Welcome checklist's events (issue #6830): call noteProgress with the
 * steps' state each time the checklist has checked them, and it sends
 * home/checklist_step_completed for every step this browser saw go from not
 * done to done, and home/checklist_finished when the last one does
 * (getChecklistProgressChange says which). What was seen is kept in this
 * browser, per project.
 *
 * The checklist #6803 keeps on the server calls this the same way, with its
 * own step keys.
 */
export default class ChecklistEvents {
  public static getSeenKey(projectId: string): string {
    return `welcome-checklist-seen-${projectId}`;
  }

  public static noteProgress(data: {
    projectId: string;
    current: Dictionary<boolean>;
    stepKeys: ReadonlyArray<string>;
  }): ChecklistProgressChange | null {
    try {
      const key: string = ChecklistEvents.getSeenKey(data.projectId);

      const change: ChecklistProgressChange = getChecklistProgressChange({
        previouslySeen: ChecklistEvents.readSeen(LocalStorage.getItem(key)),
        current: data.current,
        stepKeys: data.stepKeys,
      });

      LocalStorage.setItem(key, change.seen);

      for (const step of change.completedSteps) {
        ProductEvents.send(ProductEventName.ChecklistStepCompleted, {
          step: step,
        });
      }

      if (change.isFinished) {
        ProductEvents.send(ProductEventName.ChecklistFinished, {
          step_count: data.stepKeys.length,
        });
      }

      return change;
    } catch {
      // What this browser saw could not be kept: nothing is sent.
      return null;
    }
  }

  private static readSeen(
    value: JSONValue | undefined,
  ): Dictionary<boolean> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const seen: Dictionary<boolean> = {};

    for (const [step, isDone] of Object.entries(value)) {
      if (typeof isDone === "boolean") {
        seen[step] = isDone;
      }
    }

    return seen;
  }
}
