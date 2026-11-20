import GuidedSetupRunStore, { GuidedSetupRunSync } from "./GuidedSetupProgress";
import { useEffect, useState } from "react";

/*
 * Where a guided setup's run stands with the server (#7253), as it changes:
 * the panel says it is saved to the person's account, on its way, or kept
 * in this browser until OneUptime can be reached.
 */
const useGuidedSetupRunSync: (
  store: GuidedSetupRunStore,
) => GuidedSetupRunSync = (store: GuidedSetupRunStore): GuidedSetupRunSync => {
  const [sync, setSync] = useState<GuidedSetupRunSync>(store.getSync());

  useEffect(() => {
    setSync(store.getSync());

    return store.subscribe(setSync);
  }, [store]);

  return sync;
};

export default useGuidedSetupRunSync;
