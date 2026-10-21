import {
  HOST_COLLECTOR_CONFIG_CREATED_NOTE,
  getHostCollectorConfigRestoredVersion,
} from "Common/Types/HostCollector/HostCollector";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { HostCollectorTranslatableText } from "./HostCollectorStatus";

/*
 * A Collector Config's Versions list: what each version says about the
 * change that made it, and which actions its row offers.
 *
 * The server stores the change in English ("Created", "Changed", "Put
 * version 3 back" - HostCollectorConfigService); the list shows it in the
 * viewer's language.
 *
 * React-free: App tests read it.
 */

export function describeHostCollectorConfigVersionChange(
  changeNote: string | null | undefined,
): HostCollectorTranslatableText {
  if (changeNote === HOST_COLLECTOR_CONFIG_CREATED_NOTE) {
    return { template: translationKey("Created"), values: {} };
  }

  const restoredVersion: number | null =
    getHostCollectorConfigRestoredVersion(changeNote);

  if (restoredVersion !== null) {
    return {
      template: translationKey("Put version {{number}} back"),
      values: { number: String(restoredVersion) },
    };
  }

  return { template: translationKey("Changed"), values: {} };
}

// The version the config is on now: the one its hosts are sent.
export function isCurrentHostCollectorConfigVersion(data: {
  versionNumber: number | null | undefined;
  currentVersionNumber: number | null | undefined;
}): boolean {
  return (
    typeof data.versionNumber === "number" &&
    data.versionNumber === data.currentVersionNumber
  );
}

/*
 * Whether a version can be put back: one whose YAML is not what the config
 * holds now. Putting back the current YAML would change nothing.
 */
export function canPutHostCollectorConfigVersionBack(data: {
  versionConfigHash: string | null | undefined;
  currentConfigHash: string | null | undefined;
}): boolean {
  return Boolean(
    data.versionConfigHash &&
      data.currentConfigHash &&
      data.versionConfigHash !== data.currentConfigHash,
  );
}
