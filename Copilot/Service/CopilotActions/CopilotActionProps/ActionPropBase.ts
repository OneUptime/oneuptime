import NotImplementedException from "Common/Types/Exception/NotImplementedException";

export default class CopilotActionPropBase{ 
    public static async isActionRequired(data: {
        copilotActionBase
    }): Promise<boolean> {
        throw new NotImplementedException();
    }
}