import MonitorType from "../../../Types/Monitor/MonitorType";
import { JSONObject } from "../../../Types/JSON";
import MonitorTemplateUtil from "./MonitorTemplateUtil";
import SeriesContextEnricher from "./SeriesContextEnricher";

// The title and description an incident or alert a monitor opens is given.
export interface MonitorRecordTextResult {
  title: string;
  description: string;
}

/*
 * THE WORDS OF AN INCIDENT OR ALERT A MONITOR OPENS: its criteria's title and
 * description templates rendered against a storage map, then made to say
 * which series they are about.
 *
 * - The title renders against the title map (buildTitleStorageMap): one
 *   bounded line.
 * - The description is Markdown: what the monitored system sent goes into it
 *   as text (processMarkdownTemplateString).
 * - SeriesContextEnricher names the series a grouped monitor fired for, when
 *   the rendered words do not already; it changes nothing on a monitor that
 *   is not grouped.
 *
 * MonitorIncident and MonitorAlert render every incident and alert here, so
 * the same breach reads the same whether its criteria opens an incident or an
 * alert. "When this goes down" (WhoIsToldService) renders here too, with the
 * storage map a monitor has before any check (buildStorageMapBeforeCheck), so
 * the project's rules are matched on the words an incident or alert would
 * get rather than on its template as written.
 */
export default class MonitorRecordText {
  public static render(data: {
    titleTemplate: string | undefined;
    descriptionTemplate: string | undefined;
    monitorType: MonitorType;
    storageMap: JSONObject;
    seriesLabels?: JSONObject | undefined;
    /*
     * What else is known about the series, for the words only: a device's
     * name and model beside its install (#9925). Never its identity.
     */
    seriesContext?: JSONObject | undefined;
    /*
     * The metrics the step that opens it reads, where known: what narrows
     * a managed device's first commands to the reading its monitor reads
     * (SeriesDebugHints, #10209).
     */
    metricNames?: ReadonlyArray<string> | undefined;
  }): MonitorRecordTextResult {
    // A title is one bounded line; see buildTitleStorageMap.
    const titleStorageMap: JSONObject =
      MonitorTemplateUtil.buildTitleStorageMap({
        monitorType: data.monitorType,
        storageMap: data.storageMap,
      });

    return {
      title: SeriesContextEnricher.enrichTitle({
        title: MonitorTemplateUtil.processTemplateString({
          value: data.titleTemplate,
          storageMap: titleStorageMap,
        }),
        seriesLabels: data.seriesLabels,
        seriesContext: data.seriesContext,
      }),
      description: SeriesContextEnricher.enrichDescription({
        description: MonitorTemplateUtil.processMarkdownTemplateString({
          value: data.descriptionTemplate,
          storageMap: data.storageMap,
        }),
        seriesLabels: data.seriesLabels,
        monitorType: data.monitorType,
        seriesContext: data.seriesContext,
        metricNames: data.metricNames,
      }),
    };
  }
}
