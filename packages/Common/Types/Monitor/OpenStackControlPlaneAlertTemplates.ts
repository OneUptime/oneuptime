import { OpenStackDependency } from "../OpenStack/OpenStackControlPlane";

/*
 * The alert templates on what a cloud stands on, by dependency. Filled from real recordings
 * of each one breaking (Tests/Ops/openstack-e2e/control-plane-clusters.sh).
 */
export function getOpenStackControlPlaneTemplateIds(
  _dependency: OpenStackDependency,
): Array<string> {
  return [];
}
