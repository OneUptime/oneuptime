/*
 * What each number and pill on the OpenStack pages means, in plain words. Shown in the (i)
 * tooltip beside a pill, tile or chart. Each text describes what the page actually
 * computes, not what the title might suggest. Change the read, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export type OpenStackMetric =
  | "dataStatus"
  | "health"
  | "controlPlane"
  | "hypervisors"
  | "vcpusAllocated"
  | "memoryAllocated"
  | "storageUsed"
  | "regionHealth"
  | "apiState"
  | "apiCollectionTime"
  | "workerState"
  | "workerAdminState";

export const OPENSTACK_METRIC_DESCRIPTIONS: Record<OpenStackMetric, string> = {
  dataStatus: translationKey(
    "Whether this cloud's data is reaching OneUptime. Connected means its agent or probe has reported in the last 15 minutes. Disconnected means nothing has arrived since the time shown, so nothing on this page is current.",
  ),
  health: translationKey(
    "Worked out from what the agent last reported, by the same rules as Needs attention and the alert templates. Unhealthy: something is broken or about to be, such as an API not answering, an enabled service down or a pool past 95%. Degraded: something needs a look soon, such as a host past 90% of what Placement allows or a service disabled for over a week. Healthy: nothing needs attention. A service someone disabled on purpose never counts against it. Health Unknown: there is nothing current to judge, or this credential can't read enough to say.",
  ),
  controlPlane: translationKey(
    "Each service's API that answered the agent, out of every API in Keystone's catalog, and how many enabled workers are down. A worker someone disabled is planned work and is not counted as down.",
  ),
  hypervisors: translationKey(
    "Hypervisors whose nova-compute is up and enabled, out of all of them. Lost means Nova has lost its nova-compute: its instances may still be running, but Nova can't manage them, and its numbers are the last it had.",
  ),
  vcpusAllocated: translationKey(
    "vCPUs Nova and Placement have promised to instances, out of what they can promise on the hosts that can take them. This is what is promised, not how busy the hosts are. A lost or disabled host is in neither number. The bar turns amber when a host is past 90%, which is where the alert template fires.",
  ),
  memoryAllocated: translationKey(
    "Memory Nova and Placement have promised to instances, out of what they can promise on the hosts that can take them. This is what is promised, not what is in use. A lost or disabled host is in neither number. The bar turns amber when a host is past 90%, which is where the alert template fires.",
  ),
  storageUsed: translationKey(
    "How much of Cinder's storage pools is used, as the pools report it. The bar reads the fullest pool rather than the total, because one full pool stops new volumes on it: amber past 85% and red past 95%, which is where the alert templates fire.",
  ),
  regionHealth: translationKey(
    "By the same rules as the cloud's health pill, for this region's parts alone.",
  ),
  apiState: translationKey(
    "Whether this API answered the agent's calls when it last collected them, from openstack_<service>_up. Down also covers a collection that failed outright.",
  ),
  apiCollectionTime: translationKey(
    "How long the agent's last collection from this API took, from scrape_duration_seconds. A slow one is usually the API itself under load.",
  ),
  workerState: translationKey(
    "Whether this worker has reported to its service recently, in OpenStack's word: up or down. A worker someone disabled reads Disabled whatever it says, because that is planned work.",
  ),
  workerAdminState: translationKey(
    "What an operator set, in this service's own word. Nova and Cinder say enabled or disabled, Neutron says up or down.",
  ),
};
