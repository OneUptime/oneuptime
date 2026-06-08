import ComponentCode, { RunOptions, RunReturnType } from "../ComponentCode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import WaitComponents from "../../../../Types/Workflow/Components/Wait";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/**
 * Maximum duration a single Wait component may suspend for. Bounds how far in
 * the future a delayed resume job can be parked.
 */
export const MAX_WAIT_IN_MS: number = 30 * 24 * 60 * 60 * 1000; // 30 days

export default class Wait extends ComponentCode {
  public constructor() {
    super();

    const WaitComponent: ComponentMetadata | undefined = WaitComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.Wait;
      },
    );

    if (!WaitComponent) {
      throw new BadDataException("Component not found.");
    }

    this.setMetadata(WaitComponent);
  }

  /**
   * Coerce a workflow argument (which may arrive as a string from the form, a
   * number, or null) into a non-negative integer. Invalid / negative values
   * are treated as 0.
   */
  private toNonNegativeNumber(value: unknown): number {
    const parsed: number =
      typeof value === "number" ? value : parseFloat(value as string);

    if (isNaN(parsed) || !isFinite(parsed) || parsed < 0) {
      return 0;
    }

    return parsed;
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const outPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "out";
      },
    );

    if (!outPort) {
      throw options.onError(new BadDataException("Out port not found"));
    }

    const days: number = this.toNonNegativeNumber(args["days"]);
    const hours: number = this.toNonNegativeNumber(args["hours"]);
    const minutes: number = this.toNonNegativeNumber(args["minutes"]);
    const seconds: number = this.toNonNegativeNumber(args["seconds"]);

    let waitForMs: number =
      days * 24 * 60 * 60 * 1000 +
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000 +
      seconds * 1000;

    waitForMs = Math.round(waitForMs);

    if (waitForMs > MAX_WAIT_IN_MS) {
      options.log(
        `Requested wait of ${waitForMs}ms exceeds the maximum of ${MAX_WAIT_IN_MS}ms. Clamping to the maximum.`,
      );
      waitForMs = MAX_WAIT_IN_MS;
    }

    if (waitForMs <= 0) {
      // Nothing to wait for — behave as a pass-through.
      options.log(
        "Wait duration is zero. Continuing to the next step immediately.",
      );

      return Promise.resolve({
        returnValues: {},
        executePort: outPort,
      });
    }

    options.log(
      `Workflow will wait for ${waitForMs}ms and then continue to the next step.`,
    );

    return Promise.resolve({
      returnValues: {},
      executePort: outPort,
      suspendForMs: waitForMs,
    });
  }
}
