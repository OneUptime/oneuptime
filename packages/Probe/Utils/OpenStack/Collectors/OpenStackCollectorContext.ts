import OpenStackCollectorMemory from "../OpenStackCollectorMemory";
import { OpenStackKeystoneSession } from "../OpenStackKeystone";
import OpenStackServiceRun from "../OpenStackServiceRun";
import { OpenStackCollectionOptions } from "Common/Types/OpenStack/OpenStackProbeCollection";

/*
 * What every service's collector is handed. It writes what it reads into its own
 * inventory as each read finishes, rather than returning it at the end, so a service
 * that runs out of time keeps whatever it finished.
 */

export interface OpenStackProjectRef {
  id: string;
  name: string | null;
}

export interface OpenStackCollectorContext<TInventory> {
  run: OpenStackServiceRun;
  inventory: TInventory;
  options: OpenStackCollectionOptions;
  memory: OpenStackCollectorMemory;
  // Per credential: what this collector keeps between collections goes under it.
  memoryKey: string;
  /*
   * Whether this cloud was past the summary size when it was last read: what only series per
   * instance would use is not worth asking for.
   */
  isSummaryMode: boolean;
  session: OpenStackKeystoneSession;
  /*
   * The projects to read limits for, read once per collection whichever service asks
   * first. Null when the credential may not list them.
   */
  getProjects: () => Promise<Array<OpenStackProjectRef> | null>;
}
