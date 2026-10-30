import { WorkflowScriptTimeoutInMS } from "../../../../Server/EnvironmentConfig";
import VMUtil from "../../../Utils/VM/VMAPI";
import ComponentCode, { RunOptions, RunReturnType } from "../ComponentCode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ReturnResult from "../../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import JavaScriptCheckComponents, {
  JAVASCRIPT_CHECK_PORT_IDS,
  JavaScriptCheckDecision,
  decideJavaScriptCheck,
} from "../../../../Types/Workflow/Components/JavaScriptCheck";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * Check With JavaScript (Types/Workflow/Components/JavaScriptCheck): runs the
 * script as Run Custom JavaScript does - the same sandbox, the same
 * Arguments, the same time limit - then goes on by Yes or No by what it
 * returned, and says why in the run's Steps.
 */
export default class JavaScriptCheck extends ComponentCode {
  public constructor() {
    super();

    const component: ComponentMetadata | undefined =
      JavaScriptCheckComponents.find((i: ComponentMetadata) => {
        return i.id === ComponentID.JavaScriptCheck;
      });

    if (!component) {
      throw new BadDataException("Check With JavaScript component not found.");
    }

    this.setMetadata(component);
  }

  private getPort(id: string, options: RunOptions): Port {
    const port: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === id;
      },
    );

    if (!port) {
      throw options.onError(new BadDataException(`${id} port not found`));
    }

    return port;
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const yesPort: Port = this.getPort(JAVASCRIPT_CHECK_PORT_IDS.yes, options);
    const noPort: Port = this.getPort(JAVASCRIPT_CHECK_PORT_IDS.no, options);
    const errorPort: Port = this.getPort(
      JAVASCRIPT_CHECK_PORT_IDS.error,
      options,
    );

    try {
      let scriptArgs: JSONObject | string =
        (args["arguments"] as JSONObject | string) || {};

      if (typeof scriptArgs === "string") {
        scriptArgs = JSON.parse(scriptArgs);
      }

      const returnResult: ReturnResult = await VMUtil.runCodeInSandbox({
        code: (args["code"] as string) || "",
        options: {
          args: scriptArgs as JSONObject,
          timeout: WorkflowScriptTimeoutInMS,
          // As Run Custom JavaScript: see JavaScript.ts (issue #3424).
          allowPrivateNetworkRequests: true,
        },
      });

      for (const message of returnResult.logMessages) {
        options.log(message);
      }

      if (returnResult.scriptError) {
        throw returnResult.scriptError;
      }

      const returned: JSONValue = returnResult.returnValue;
      const decision: JavaScriptCheckDecision = decideJavaScriptCheck(returned);

      options.log(`${decision.isYes ? "Yes" : "No"}: ${decision.reason}`);

      return {
        returnValues: {
          returnValue: returned === undefined ? null : returned,
          reason: decision.reason,
        },
        executePort: decision.isYes ? yesPort : noPort,
        executePortReason: decision.reason,
      };
    } catch (err: unknown) {
      const errorMessage: string =
        err instanceof Error && err.message
          ? err.message
          : typeof err === "string" && err
            ? err
            : "JavaScript execution failed.";

      options.log("Error running script");
      options.log(errorMessage);

      return {
        returnValues: { error: errorMessage },
        executePort: errorPort,
        executePortReason: errorMessage,
      };
    }
  }
}
