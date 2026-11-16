import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import { truncateToBytes } from "../OutputTruncation";

/*
 * What a JavaScript step reports, read from what its isolate returned: the
 * lines it logged, then "Return: <value>" when it returned one, cut to the
 * Runner's output limit; and the script's error, when it threw or ran out of
 * time. The one reading of a step's result, whether the step ran in the
 * Runner's own process (a project's Runner) or in a sandbox process of its
 * own (a global Runner, JavaScriptSandbox/SandboxWorker), so both report
 * alike.
 */
export interface JavaScriptStepOutcome {
  success: boolean;
  output: string;
  errorMessage?: string | undefined;
}

export function getJavaScriptStepOutcome(
  result: ReturnResult,
  maxOutputBytes: number,
): JavaScriptStepOutcome {
  const lines: Array<string> = [...(result.logMessages || [])];

  if (result.returnValue !== undefined) {
    lines.push(
      `Return: ${
        typeof result.returnValue === "string"
          ? result.returnValue
          : JSON.stringify(result.returnValue, null, 2)
      }`,
    );
  }

  const output: string = truncateToBytes(lines.join("\n"), maxOutputBytes);

  if (result.scriptError) {
    return {
      success: false,
      output,
      errorMessage: result.scriptError.message,
    };
  }

  return { success: true, output };
}
