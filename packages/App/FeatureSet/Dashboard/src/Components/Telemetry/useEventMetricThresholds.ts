import { useEffect, useMemo, useState } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { MetricInvestigationQueries } from "../Metrics/Investigation/MetricInvestigationQueries";
import MetricInvestigationQueryUtil from "../Metrics/Investigation/MetricInvestigationQueries";
import { MetricInvestigationThreshold } from "../Metrics/Investigation/MetricInvestigationThresholds";
import {
  EventRuleMonitor,
  getEventMetricThresholds,
} from "../../Utils/EventMetricThresholds";

/*
 * The rule that opened an incident or alert, for its metric charts to draw
 * (issue #6250; see EventMetricThresholds): the criteria the event names,
 * read off its monitor's steps.
 *
 * Read once per event: the event's criteria and monitor, then the monitor's
 * steps. Best effort - a reader who may not read the monitor, a monitor
 * since deleted, or a read that fails, leaves the charts without the line,
 * never with an error.
 */

// The most monitors read for one event's rule.
export const EVENT_RULE_MONITOR_LIMIT: number = 5;

interface EventRule {
  createdCriteriaId: string;
  monitors: Array<EventRuleMonitor>;
}

interface ReadResult {
  requestKey: string;
  rule: EventRule | null;
}

const NO_THRESHOLDS: Array<MetricInvestigationThreshold> = [];

const readMonitor: (monitorId: ObjectID) => Promise<EventRuleMonitor | null> =
  async (monitorId: ObjectID): Promise<EventRuleMonitor | null> => {
    try {
      const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
        modelType: Monitor,
        id: monitorId,
        select: {
          _id: true,
          monitorType: true,
          monitorSteps: true,
        },
      });

      return monitor
        ? {
            monitorType: monitor.monitorType,
            monitorSteps: monitor.monitorSteps,
          }
        : null;
    } catch {
      return null;
    }
  };

// The event's criteria, and the ids of the monitors it is on.
const readEvent: (input: {
  eventNoun: "incident" | "alert";
  eventId: ObjectID;
}) => Promise<{ createdCriteriaId: string; monitorIds: Array<ObjectID> }> =
  async (input: {
    eventNoun: "incident" | "alert";
    eventId: ObjectID;
  }): Promise<{ createdCriteriaId: string; monitorIds: Array<ObjectID> }> => {
    if (input.eventNoun === "alert") {
      const alert: Alert | null = await ModelAPI.getItem<Alert>({
        modelType: Alert,
        id: input.eventId,
        select: {
          _id: true,
          createdCriteriaId: true,
          monitorId: true,
        },
      });

      return {
        createdCriteriaId: alert?.createdCriteriaId || "",
        monitorIds: alert?.monitorId ? [alert.monitorId] : [],
      };
    }

    const incident: Incident | null = await ModelAPI.getItem<Incident>({
      modelType: Incident,
      id: input.eventId,
      select: {
        _id: true,
        createdCriteriaId: true,
        monitors: {
          _id: true,
        },
      },
    });

    return {
      createdCriteriaId: incident?.createdCriteriaId || "",
      monitorIds: (incident?.monitors || [])
        .map((monitor: Monitor): ObjectID | undefined => {
          return monitor.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    };
  };

export default function useEventMetricThresholds(input: {
  eventNoun: "incident" | "alert";
  // The incident or alert whose rule is drawn; none, no line.
  eventId: string | undefined;
  // The metrics the event's card starts from: its snapshot's.
  snapshotQueries: MetricInvestigationQueries;
}): Array<MetricInvestigationThreshold> {
  const [result, setResult] = useState<ReadResult | null>(null);

  const eventId: string = (input.eventId || "").trim();
  const requestKey: string = `${input.eventNoun}:${eventId}`;

  useEffect(() => {
    if (!eventId) {
      return;
    }

    let isCancelled: boolean = false;

    const read: () => Promise<void> = async (): Promise<void> => {
      let rule: EventRule | null = null;

      try {
        const event: { createdCriteriaId: string; monitorIds: Array<ObjectID> } =
          await readEvent({
            eventNoun: input.eventNoun,
            eventId: new ObjectID(eventId),
          });

        if (event.createdCriteriaId && event.monitorIds.length > 0) {
          const monitors: Array<EventRuleMonitor | null> = await Promise.all(
            event.monitorIds
              .slice(0, EVENT_RULE_MONITOR_LIMIT)
              .map((monitorId: ObjectID) => {
                return readMonitor(monitorId);
              }),
          );

          rule = {
            createdCriteriaId: event.createdCriteriaId,
            monitors: monitors.filter(
              (monitor: EventRuleMonitor | null): monitor is EventRuleMonitor => {
                return monitor !== null;
              },
            ),
          };
        }
      } catch {
        // No line rather than an error: the charts stand on their own.
        rule = null;
      }

      if (!isCancelled) {
        setResult({ requestKey, rule });
      }
    };

    void read();

    return () => {
      isCancelled = true;
    };
  }, [requestKey]);

  const rule: EventRule | null =
    result && result.requestKey === requestKey ? result.rule : null;

  // Kept by value: the page reads an equal snapshot again on every refresh.
  const snapshotKey: string = MetricInvestigationQueryUtil.getKey(
    input.snapshotQueries,
  );

  return useMemo((): Array<MetricInvestigationThreshold> => {
    if (!rule) {
      return NO_THRESHOLDS;
    }

    const thresholds: Array<MetricInvestigationThreshold> =
      getEventMetricThresholds({
        createdCriteriaId: rule.createdCriteriaId,
        monitors: rule.monitors,
        snapshotQueries: input.snapshotQueries,
      });

    return thresholds.length > 0 ? thresholds : NO_THRESHOLDS;
  }, [rule, snapshotKey]);
}
