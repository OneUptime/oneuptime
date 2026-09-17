import DatabaseType from "../BaseDatabase/DatabaseType";
import ModelEventType from "./ModelEventType";

export default interface ListenToModelEventJSON {
  modelName: string;
  modelType: DatabaseType;
  eventType: ModelEventType;
  tenantId: string;
  modelId?: string | undefined;
}
