import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourceConnectionState } from "../ResourceConnection/ResourceConnectionState";

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

export const RESOURCE_STARTING_LABEL: string = translationKey("Starting");

/*
 * For an agent that reads its resource from an API (a Proxmox cluster, issue
 * #7439): the agent runs but the resource is not read - the read stopped, or
 * none has come yet. Words a RUM application's pill uses before its first
 * data, for the second.
 */
export const RESOURCE_CANNOT_READ_API_LABEL: string =
  translationKey("Can't read API");

export const RESOURCE_WAITING_FOR_DATA_LABEL: string =
  translationKey("Waiting for data");

/*
 * The connection pill: "Connected" while the agent reports, "Disconnected"
 * when it has stopped or never started, and any other state the agent's
 * record holds as it holds it, capitalized - in the reader's words when the
 * Dashboard has them. "Starting" while an agent OneUptime set up waits for
 * its first data (isStarting): a host's collector a minute after Add Host
 * read "Disconnected" beside a card saying the host is starting. "Can't read
 * API" and "Waiting for data" while an agent that reads its resource from an
 * API runs but cannot read it (connectionState, from
 * getResourceConnectionState with the agent's own clock): a Proxmox cluster
 * read Connected for as long as its blind agent ran.
 */
export const getResourceConnectionLabel: (input: {
  translator: Translator;
  isConnected: boolean;
  status: string | null | undefined;
  isStarting?: boolean | undefined;
  connectionState?: ResourceConnectionState | undefined;
}) => string = (input: {
  translator: Translator;
  isConnected: boolean;
  status: string | null | undefined;
  isStarting?: boolean | undefined;
  connectionState?: ResourceConnectionState | undefined;
}): string => {
  if (!input.isConnected) {
    if (input.connectionState === ResourceConnectionState.ReadingStopped) {
      return (
        input.translator.translateText(RESOURCE_CANNOT_READ_API_LABEL) ||
        RESOURCE_CANNOT_READ_API_LABEL
      );
    }
    if (input.connectionState === ResourceConnectionState.NotReadYet) {
      return (
        input.translator.translateText(RESOURCE_WAITING_FOR_DATA_LABEL) ||
        RESOURCE_WAITING_FOR_DATA_LABEL
      );
    }
  }

  if (input.isStarting && !input.isConnected) {
    return (
      input.translator.translateText(RESOURCE_STARTING_LABEL) ||
      RESOURCE_STARTING_LABEL
    );
  }

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
