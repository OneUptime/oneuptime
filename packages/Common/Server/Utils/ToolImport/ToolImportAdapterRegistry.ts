import BadDataException from "../../../Types/Exception/BadDataException";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";
import AtlassianStatuspageAdapter from "./Adapters/AtlassianStatuspage/AtlassianStatuspageAdapter";
import BetterStackAdapter from "./Adapters/BetterStack/BetterStackAdapter";
import GrafanaOnCallAdapter from "./Adapters/GrafanaOnCall/GrafanaOnCallAdapter";
import IncidentIoAdapter from "./Adapters/IncidentIo/IncidentIoAdapter";
import OpsGenieAdapter from "./Adapters/OpsGenie/OpsGenieAdapter";
import PagerDutyAdapter from "./Adapters/PagerDuty/PagerDutyAdapter";
import PingdomAdapter from "./Adapters/Pingdom/PingdomAdapter";
import SplunkOnCallAdapter from "./Adapters/SplunkOnCall/SplunkOnCallAdapter";
import StatusCakeAdapter from "./Adapters/StatusCake/StatusCakeAdapter";
import UptimeKumaAdapter from "./Adapters/UptimeKuma/UptimeKumaAdapter";
import UptimeRobotAdapter from "./Adapters/UptimeRobot/UptimeRobotAdapter";
import { ToolImportAdapter, ToolImportFileAdapter } from "./Types";

/*
 * One adapter per tool: an API adapter for a tool read with its key, a file
 * adapter for a tool read from a file the person uploads (Uptime Kuma).
 * Adapters keep no state between reads (every read carries its own key and
 * client, or its own file), so one instance serves every project. A new
 * tool's adapter is added to the right list below; the registry test fails
 * until every ToolImportSource has exactly one.
 */
export default class ToolImportAdapterRegistry {
  private static adapters: Array<ToolImportAdapter> = [
    new OpsGenieAdapter(),
    new PagerDutyAdapter(),
    new IncidentIoAdapter(),
    new SplunkOnCallAdapter(),
    new GrafanaOnCallAdapter(),
    new UptimeRobotAdapter(),
    new AtlassianStatuspageAdapter(),
    new BetterStackAdapter(),
    new PingdomAdapter(),
    new StatusCakeAdapter(),
  ];

  private static fileAdapters: Array<ToolImportFileAdapter> = [
    new UptimeKumaAdapter(),
  ];

  public static getAdapter(source: ToolImportSource): ToolImportAdapter {
    const adapter: ToolImportAdapter | undefined = this.adapters.find(
      (candidate: ToolImportAdapter): boolean => {
        return candidate.source === source;
      },
    );

    if (!adapter) {
      throw new BadDataException(`OneUptime cannot import from ${source} yet.`);
    }

    return adapter;
  }

  public static getFileAdapter(
    source: ToolImportSource,
  ): ToolImportFileAdapter {
    const adapter: ToolImportFileAdapter | undefined = this.fileAdapters.find(
      (candidate: ToolImportFileAdapter): boolean => {
        return candidate.source === source;
      },
    );

    if (!adapter) {
      throw new BadDataException(
        `OneUptime cannot read a file from ${source}.`,
      );
    }

    return adapter;
  }

  public static getRegisteredSources(): Array<ToolImportSource> {
    return this.adapters.map((adapter: ToolImportAdapter): ToolImportSource => {
      return adapter.source;
    });
  }

  public static getRegisteredFileSources(): Array<ToolImportSource> {
    return this.fileAdapters.map(
      (adapter: ToolImportFileAdapter): ToolImportSource => {
        return adapter.source;
      },
    );
  }
}
