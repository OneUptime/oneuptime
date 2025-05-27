import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import DatabaseBaseModel from "@oneuptime/common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "@oneuptime/common/Models/DatabaseModels/Index";

export default class MCP {
  public static addToolsToServer(data: { server: McpServer }): void {
    // loop over all models in Models and add them to the server
    for (const model of Models) {
      this.addModelCreateItemAPIToServer({
        server: data.server,
        model: model,
      });

      this.addModelGetItemAPIToServer({
        server: data.server,
        model: model,
      });

      this.addModelListAPIToServer({
        server: data.server,
        model: model,
      });

      this.addModelUpdateItemAPIToServer({
        server: data.server,
        model: model,
      });

      this.addModelDeleteItemAPIToServer({
        server: data.server,
        model: model,
      });
    }
  }

  public static addModelListAPIToServer(_data: {
    server: McpServer;
    model: new () => DatabaseBaseModel;
  }): void {}

  public static addModelGetItemAPIToServer(_data: {
    server: McpServer;
    model: new () => DatabaseBaseModel;
  }): void {}

  public static addModelDeleteItemAPIToServer(_data: {
    server: McpServer;
    model: new () => DatabaseBaseModel;
  }): void {}

  public static addModelUpdateItemAPIToServer(_data: {
    server: McpServer;
    model: new () => DatabaseBaseModel;
  }): void {}

  public static addModelCreateItemAPIToServer(_data: {
    server: McpServer;
    model: new () => DatabaseBaseModel;
  }): void {}
}
