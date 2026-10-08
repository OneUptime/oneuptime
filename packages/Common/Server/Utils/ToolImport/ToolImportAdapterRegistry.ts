import BadDataException from "../../../Types/Exception/BadDataException";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";
import IncidentIoAdapter from "./Adapters/IncidentIo/IncidentIoAdapter";
import OpsGenieAdapter from "./Adapters/OpsGenie/OpsGenieAdapter";
import { ToolImportAdapter } from "./Types";

/*
 * One adapter per tool. Adapters keep no state between reads (every read
 * carries its own key and client), so one instance serves every project.
 * A new tool's adapter is added to the list below; the registry test fails
 * until every ToolImportSource has one.
 */
export default class ToolImportAdapterRegistry {
  private static adapters: Array<ToolImportAdapter> = [
    new OpsGenieAdapter(),
    new IncidentIoAdapter(),
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

  public static getRegisteredSources(): Array<ToolImportSource> {
    return this.adapters.map((adapter: ToolImportAdapter): ToolImportSource => {
      return adapter.source;
    });
  }
}
