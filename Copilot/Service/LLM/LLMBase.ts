import NotImplementedException from "Common/Types/Exception/NotImplementedException";

export default class LlmBase {
  public static async getResponse(_data: { input: string }): Promise<string> {
    throw new NotImplementedException();
  }
}
