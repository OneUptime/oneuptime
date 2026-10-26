import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS IN A RESOURCE HERO'S PILLS, in the reader's language.
 *
 * Beside a resource's name its hero says whether OneUptime hears from the
 * resource's agent ("Connected", "Disconnected") and, for a Kubernetes
 * cluster, a Docker Swarm, a vCenter and a Proxmox cluster, how the
 * resource is doing ("Healthy", "Degraded", "Unhealthy"). Nine heroes wrote
 * those words in English for every reader - a German host's hero read
 * "Disconnected" beside "Zuletzt gesehen", a Persian cluster's "Connected"
 * and "Healthy" - while a storage array's hero, and every service's,
 * database's and queue's, said them in the reader's language (#5298's UI
 * review). Every hero now takes its pills' words from here.
 *
 * Plain functions of a Translator, free of React, so a test can hand them
 * any language.
 */

export const RESOURCE_CONNECTED_LABEL: string = translationKey("Connected");

export const RESOURCE_DISCONNECTED_LABEL: string =
  translationKey("Disconnected");

/*
 * The connection pill: "Connected" while the agent reports, "Disconnected"
 * when it has stopped or never started, and any other state the agent's
 * record holds as it holds it, capitalized - in the reader's words when the
 * Dashboard has them.
 */
export const getResourceConnectionLabel: (input: {
  translator: Translator;
  isConnected: boolean;
  status: string | null | undefined;
}) => string = (input: {
  translator: Translator;
  isConnected: boolean;
  status: string | null | undefined;
}): string => {
  if (input.isConnected) {
    return (
      input.translator.translateText(RESOURCE_CONNECTED_LABEL) ||
      RESOURCE_CONNECTED_LABEL
    );
  }

  const status: string = (input.status || "").trim();

  if (!status || status.toLowerCase() === "disconnected") {
    return (
      input.translator.translateText(RESOURCE_DISCONNECTED_LABEL) ||
      RESOURCE_DISCONNECTED_LABEL
    );
  }

  const reported: string = status.charAt(0).toUpperCase() + status.slice(1);

  return input.translator.translateText(reported) || reported;
};

/*
 * What a cluster's, a swarm's, a vCenter's and a Proxmox cluster's health
 * is worked out to from its last inventory.
 */
export type ResourceHealth = "Healthy" | "Degraded" | "Unhealthy";

const RESOURCE_HEALTH_LABELS: Record<ResourceHealth, string> = {
  Healthy: translationKey("Healthy"),
  Degraded: translationKey("Degraded"),
  Unhealthy: translationKey("Unhealthy"),
};

/*
 * While the agent is not connected the inventory the health was worked out
 * from is stale: "Healthy" beside "Disconnected" would contradict it, so
 * the pill says the health is unknown - in the words a Ceph cluster's and a
 * storage array's hero use, not a bare "Unknown" that reads as the
 * resource's state.
 */
export const RESOURCE_HEALTH_UNKNOWN_LABEL: string =
  translationKey("Health Unknown");

export const getResourceHealthLabel: (input: {
  translator: Translator;
  health: ResourceHealth;
  isConnected: boolean;
}) => string = (input: {
  translator: Translator;
  health: ResourceHealth;
  isConnected: boolean;
}): string => {
  const label: string = input.isConnected
    ? RESOURCE_HEALTH_LABELS[input.health] || RESOURCE_HEALTH_LABELS.Unhealthy
    : RESOURCE_HEALTH_UNKNOWN_LABEL;

  return input.translator.translateText(label) || label;
};
