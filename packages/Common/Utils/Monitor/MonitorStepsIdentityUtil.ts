import { CriteriaAlert } from "../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../Types/Monitor/CriteriaIncident";
import { JSONArray, JSONObject } from "../../Types/JSON";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import ObjectID from "../../Types/ObjectID";

/*
 * Who owns the ids inside a monitor's steps.
 *
 * Steps, criteria and the incident and alert templates of a criteria all carry
 * ids, and the rest of the product keys on them: a probe files its result
 * under the step's id (MonitorProbe.lastMonitoringLog) and the monitor page
 * reads it back by the same id; an incident remembers the criteria and the
 * template that raised it, and auto-resolve and dedupe find it again by those
 * two ids.
 *
 * The dashboard makes every id itself. An API client usually does not: the
 * Terraform provider deliberately sends none and leaves them to the server.
 * The server used to make only the criteria ids - while parsing, so a fresh
 * set on every write - and none for steps or templates. A monitor written
 * through the API therefore had a step whose results the monitor page threw
 * away ("No check has completed yet"), incidents that could never
 * auto-resolve, and criteria whose ids changed on every `terraform apply`,
 * which cut every incident open at the time loose from its criteria.
 *
 * So the server owns them on every write:
 *   - an id the caller sent is kept;
 *   - an item that came without one (or with one made up while parsing)
 *     takes over the id of the stored item it stands in for - the stored item
 *     of the same name, else the one at the same position - so ids survive an
 *     update that resends the configuration;
 *   - anything left gets a new id.
 * Ids stay unique within their list.
 */

export interface MonitorStepsIdentitySlot {
  id?: string | undefined;
  // What a caller that sends no ids still sends: a criteria's name, a template's title.
  name?: string | undefined;
  // False when the id is missing or was generated while parsing.
  isIdOwnedByCaller: boolean;
}

export interface MonitorStepsStoredIdentity {
  id?: string | undefined;
  name?: string | undefined;
}

export interface MonitorStepsJSONIdentityResult {
  monitorSteps: JSONObject;
  changed: boolean;
}

interface TemplateLike {
  id?: string | undefined;
  title?: string | undefined;
}

const normalizeName: (name: string | undefined) => string = (
  name: string | undefined,
): string => {
  return typeof name === "string" ? name.trim() : "";
};

export default class MonitorStepsIdentityUtil {
  /*
   * The final id of every incoming item, in order. See the header for the
   * rules; `stored` is the list the incoming one replaces (empty on create).
   */
  public static resolveIds(data: {
    incoming: Array<MonitorStepsIdentitySlot>;
    stored: Array<MonitorStepsStoredIdentity>;
  }): Array<string> {
    const result: Array<string | undefined> = data.incoming.map(() => {
      return undefined;
    });
    const usedIds: Set<string> = new Set<string>();

    // A caller's own id is kept - the first time it appears.
    data.incoming.forEach((slot: MonitorStepsIdentitySlot, index: number) => {
      if (slot.isIdOwnedByCaller && slot.id && !usedIds.has(slot.id)) {
        result[index] = slot.id;
        usedIds.add(slot.id);
      }
    });

    const isStoredAvailable: (index: number) => boolean = (
      index: number,
    ): boolean => {
      const storedId: string | undefined = data.stored[index]?.id;
      return Boolean(storedId) && !usedIds.has(storedId!);
    };

    const claimStored: (incomingIndex: number, storedIndex: number) => void = (
      incomingIndex: number,
      storedIndex: number,
    ): void => {
      const storedId: string = data.stored[storedIndex]!.id!;
      result[incomingIndex] = storedId;
      usedIds.add(storedId);
    };

    // Then by name, where the name picks out exactly one item on each side.
    const pendingByName: Map<string, Array<number>> = new Map<
      string,
      Array<number>
    >();

    data.incoming.forEach((slot: MonitorStepsIdentitySlot, index: number) => {
      const name: string = normalizeName(slot.name);
      if (result[index] !== undefined || !name) {
        return;
      }
      pendingByName.set(name, [...(pendingByName.get(name) || []), index]);
    });

    for (const [name, incomingIndexes] of pendingByName) {
      if (incomingIndexes.length !== 1) {
        continue;
      }

      const storedIndexes: Array<number> = [];
      data.stored.forEach(
        (stored: MonitorStepsStoredIdentity, storedIndex: number) => {
          if (normalizeName(stored.name) === name) {
            storedIndexes.push(storedIndex);
          }
        },
      );

      if (storedIndexes.length !== 1 || !isStoredAvailable(storedIndexes[0]!)) {
        continue;
      }

      claimStored(incomingIndexes[0]!, storedIndexes[0]!);
    }

    // Then by position.
    data.incoming.forEach((_slot: MonitorStepsIdentitySlot, index: number) => {
      if (result[index] === undefined && isStoredAvailable(index)) {
        claimStored(index, index);
      }
    });

    // Anything left keeps the id it was parsed with, or gets a new one.
    return data.incoming.map(
      (slot: MonitorStepsIdentitySlot, index: number): string => {
        if (result[index] !== undefined) {
          return result[index]!;
        }

        let id: string =
          slot.id && !usedIds.has(slot.id)
            ? slot.id
            : ObjectID.generate().toString();

        while (usedIds.has(id)) {
          id = ObjectID.generate().toString();
        }

        usedIds.add(id);
        return id;
      },
    );
  }

  /*
   * Gives every step, criteria and template of `monitorSteps` its id, in
   * place, keeping the ids of `storedMonitorSteps` (the value being replaced)
   * wherever the caller sent none. A missing default monitor status is taken
   * from the stored steps, else from `defaultMonitorStatusId`: the dashboard
   * never saves steps without one, and with none a monitor that matches no
   * criteria keeps whatever status it last had.
   */
  public static assignIds(data: {
    monitorSteps: MonitorSteps;
    storedMonitorSteps?: MonitorSteps | null | undefined;
    defaultMonitorStatusId?: ObjectID | null | undefined;
  }): MonitorSteps {
    const steps: Array<MonitorStep> =
      data.monitorSteps.data?.monitorStepsInstanceArray || [];
    const storedSteps: Array<MonitorStep> =
      data.storedMonitorSteps?.data?.monitorStepsInstanceArray || [];

    const stepIds: Array<string> = this.resolveIds({
      incoming: steps.map((step: MonitorStep): MonitorStepsIdentitySlot => {
        return {
          id: step.data?.id || undefined,
          isIdOwnedByCaller: Boolean(step.data?.id),
        };
      }),
      stored: storedSteps.map(
        (step: MonitorStep): MonitorStepsStoredIdentity => {
          return { id: step.data?.id || undefined };
        },
      ),
    });

    steps.forEach((step: MonitorStep, index: number) => {
      if (!step.data) {
        return;
      }

      step.data.id = stepIds[index]!;

      const storedStep: MonitorStep | undefined = storedSteps.find(
        (candidate: MonitorStep) => {
          return candidate.data?.id === step.data!.id;
        },
      );

      this.assignCriteriaIds({
        criteria: step.data.monitorCriteria?.data?.monitorCriteriaInstanceArray,
        storedCriteria:
          storedStep?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray,
      });
    });

    if (
      data.monitorSteps.data &&
      !data.monitorSteps.data.defaultMonitorStatusId
    ) {
      const fallback: ObjectID | null | undefined =
        data.storedMonitorSteps?.data?.defaultMonitorStatusId ||
        data.defaultMonitorStatusId;

      if (fallback) {
        data.monitorSteps.data.defaultMonitorStatusId = new ObjectID(
          fallback.toString(),
        );
      }
    }

    return data.monitorSteps;
  }

  /*
   * The same, for monitor steps as they are stored: fills in the ids (and the
   * default monitor status) that are missing and changes nothing else. Used
   * to repair rows written before the server owned the ids, where a parse and
   * re-serialize would also rewrite every field the parser normalizes.
   */
  public static assignIdsInJSON(data: {
    monitorSteps: JSONObject;
    defaultMonitorStatusId?: string | null | undefined;
  }): MonitorStepsJSONIdentityResult {
    const monitorSteps: JSONObject = JSON.parse(
      JSON.stringify(data.monitorSteps),
    ) as JSONObject;
    let changed: boolean = false;

    const fillId: (target: JSONObject) => void = (target: JSONObject): void => {
      if (!target["id"]) {
        target["id"] = ObjectID.generate().toString();
        changed = true;
      }
    };

    const value: JSONObject | undefined = this.asObject(monitorSteps["value"]);

    if (!value) {
      return { monitorSteps, changed };
    }

    for (const stepEnvelope of this.asArray(
      value["monitorStepsInstanceArray"],
    )) {
      const step: JSONObject | undefined = this.asObject(
        this.asObject(stepEnvelope)?.["value"],
      );

      if (!step) {
        continue;
      }

      fillId(step);

      const criteriaValue: JSONObject | undefined = this.asObject(
        this.asObject(step["monitorCriteria"])?.["value"],
      );

      for (const criteriaEnvelope of this.asArray(
        criteriaValue?.["monitorCriteriaInstanceArray"],
      )) {
        const criteria: JSONObject | undefined = this.asObject(
          this.asObject(criteriaEnvelope)?.["value"],
        );

        if (!criteria) {
          continue;
        }

        fillId(criteria);

        for (const key of ["incidents", "alerts"]) {
          for (const template of this.asArray(criteria[key])) {
            const templateObject: JSONObject | undefined =
              this.asObject(template);

            if (templateObject) {
              fillId(templateObject);
            }
          }
        }
      }
    }

    if (!value["defaultMonitorStatusId"] && data.defaultMonitorStatusId) {
      value["defaultMonitorStatusId"] = data.defaultMonitorStatusId;
      changed = true;
    }

    return { monitorSteps, changed };
  }

  private static assignCriteriaIds(data: {
    criteria: Array<MonitorCriteriaInstance> | undefined;
    storedCriteria: Array<MonitorCriteriaInstance> | undefined;
  }): void {
    const criteria: Array<MonitorCriteriaInstance> = data.criteria || [];
    const storedCriteria: Array<MonitorCriteriaInstance> =
      data.storedCriteria || [];

    const criteriaIds: Array<string> = this.resolveIds({
      incoming: criteria.map(
        (item: MonitorCriteriaInstance): MonitorStepsIdentitySlot => {
          return {
            id: item.data?.id || undefined,
            name: item.data?.name,
            isIdOwnedByCaller:
              Boolean(item.data?.id) &&
              !MonitorCriteriaInstance.isIdGeneratedOnParse(item),
          };
        },
      ),
      stored: storedCriteria.map(
        (item: MonitorCriteriaInstance): MonitorStepsStoredIdentity => {
          return { id: item.data?.id || undefined, name: item.data?.name };
        },
      ),
    });

    criteria.forEach((item: MonitorCriteriaInstance, index: number) => {
      if (!item.data) {
        return;
      }

      item.data.id = criteriaIds[index]!;

      const stored: MonitorCriteriaInstance | undefined = storedCriteria.find(
        (candidate: MonitorCriteriaInstance) => {
          return candidate.data?.id === item.data!.id;
        },
      );

      this.assignTemplateIds<CriteriaIncident>({
        templates: item.data.incidents,
        storedTemplates: stored?.data?.incidents,
      });

      this.assignTemplateIds<CriteriaAlert>({
        templates: item.data.alerts,
        storedTemplates: stored?.data?.alerts,
      });
    });
  }

  private static assignTemplateIds<T extends TemplateLike>(data: {
    templates: Array<T> | undefined;
    storedTemplates: Array<T> | undefined;
  }): void {
    const templates: Array<T> = (data.templates || []).filter((item: T) => {
      return Boolean(item) && typeof item === "object";
    });
    const storedTemplates: Array<T> = (data.storedTemplates || []).filter(
      (item: T) => {
        return Boolean(item) && typeof item === "object";
      },
    );

    const templateIds: Array<string> = this.resolveIds({
      incoming: templates.map((item: T): MonitorStepsIdentitySlot => {
        return {
          id: item.id || undefined,
          name: item.title,
          isIdOwnedByCaller: Boolean(item.id),
        };
      }),
      stored: storedTemplates.map((item: T): MonitorStepsStoredIdentity => {
        return { id: item.id || undefined, name: item.title };
      }),
    });

    templates.forEach((item: T, index: number) => {
      item.id = templateIds[index]!;
    });
  }

  private static asObject(value: unknown): JSONObject | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : undefined;
  }

  private static asArray(value: unknown): JSONArray {
    return Array.isArray(value) ? (value as JSONArray) : [];
  }
}
