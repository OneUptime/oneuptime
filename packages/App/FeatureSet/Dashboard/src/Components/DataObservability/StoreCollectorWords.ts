import {
  DataObservabilityCollector,
  DataObservabilityStoreSummary,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Who reads a database's catalog, in one line: the Databases list's row
 * and the database's Overview say it alike - OneUptime, a probe in the
 * customer's network, or the Database Agent beside the database (#11148).
 */
export function getStoreCollectorLine(
  store: Pick<
    DataObservabilityStoreSummary,
    "collector" | "probeName" | "databaseServerName"
  >,
  translator: Translator,
): string {
  if (store.collector === DataObservabilityCollector.Probe) {
    return translator.translateTemplate("Collected by probe {{probe}}", {
      probe: store.probeName || "",
    });
  }

  if (store.collector === DataObservabilityCollector.DatabaseAgent) {
    return translator.translateTemplate(
      "Collected by the Database Agent of {{server}}",
      { server: store.databaseServerName || "" },
    );
  }

  return translator.translateText("Collected by OneUptime") || "";
}
