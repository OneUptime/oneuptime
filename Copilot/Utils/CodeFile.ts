export default class CodeFileUtil {
  public static async mergeResult(_data: {
    originalCode: string;
    copilotReturnedCode: string;
  }): Promise<string> {
    // Original Code is the main code, copilotReturnedCode is the code returned by copilot which could contain errors.
    return "";
  }
}
