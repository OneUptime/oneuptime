import MonitorWhoIsToldCard, {
  WhoIsToldCardVariant,
  WhoIsToldPlace,
} from "./MonitorWhoIsToldCard";
import { WhoIsToldDraftInput } from "./WhoIsToldApi";
import { JSONObject } from "Common/Types/JSON";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "WHEN THIS GOES DOWN" FOR A MONITOR NOT CREATED YET (#7055), under Create
 * Monitor's criteria: who the monitor the form holds would tell, worked out
 * by the server's resolver - the same rules, on-call rules, privacy and
 * owners as a saved monitor's - as the criteria change. Its breaks link to
 * what fixes them in a new tab, so the form is never left; the chain stays
 * folded until asked for.
 */

export interface ComponentProps {
  monitorType: MonitorType | undefined;
  name: string | undefined;
  description?: string | undefined;
  // As the form holds them: MonitorSteps, or the JSON it was seeded with.
  monitorSteps: MonitorSteps | JSONObject | undefined;
  // As the labels picker holds them: ids, or labels with an _id.
  labels?: Array<unknown> | undefined;
}

// A label the picker holds, by id: a string, an ObjectID or a label.
export function getDraftLabelIds(
  labels: Array<unknown> | undefined,
): Array<ObjectID> {
  const ids: Array<ObjectID> = [];

  for (const label of labels || []) {
    let id: string = "";

    if (typeof label === "string") {
      id = label;
    } else if (label instanceof ObjectID) {
      id = label.toString();
    } else if (label && typeof label === "object") {
      const value: unknown =
        (label as { _id?: unknown })._id ?? (label as { id?: unknown }).id;
      id = value ? String(value) : "";
    }

    if (id && ObjectID.isValidUUID(id)) {
      ids.push(new ObjectID(id));
    }
  }

  return ids;
}

/*
 * The draft the form holds, or null while there is nothing to work out: no
 * type yet, a Manual monitor (it has no criteria), or steps that can't be
 * read.
 */
export function getMonitorDraft(
  props: ComponentProps,
): WhoIsToldDraftInput | null {
  if (!props.monitorType || props.monitorType === MonitorType.Manual) {
    return null;
  }

  if (!props.monitorSteps) {
    return null;
  }

  let monitorSteps: MonitorSteps;

  try {
    monitorSteps =
      props.monitorSteps instanceof MonitorSteps
        ? props.monitorSteps
        : MonitorSteps.fromJSON(props.monitorSteps as JSONObject);
  } catch {
    return null;
  }

  return {
    name: props.name || "",
    description: props.description || "",
    monitorType: props.monitorType,
    monitorSteps: monitorSteps,
    labelIds: getDraftLabelIds(props.labels),
  };
}

const MonitorDraftWhoIsTold: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const draft: WhoIsToldDraftInput | null = getMonitorDraft({
    monitorType: props.monitorType,
    name: props.name,
    description: props.description,
    monitorSteps: props.monitorSteps,
    labels: props.labels,
  });

  if (!draft) {
    return <></>;
  }

  return (
    <div className="mt-6" data-testid="monitor-draft-who-is-told">
      <MonitorWhoIsToldCard
        draft={draft}
        place={WhoIsToldPlace.CreateMonitor}
        variant={WhoIsToldCardVariant.Section}
      />
    </div>
  );
};

export default MonitorDraftWhoIsTold;
