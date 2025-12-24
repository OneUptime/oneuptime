import AIAgentIngestAPI from "./API/AIAgentIngest";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";

const AIAgentIngestFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    const APP_NAME: string = "ai-agent-ingest";

    // Mount the AI Agent ingest API routes
    app.use([`/${APP_NAME}`, "/"], AIAgentIngestAPI);
  },
};

export default AIAgentIngestFeatureSet;
