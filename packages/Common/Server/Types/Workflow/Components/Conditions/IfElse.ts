import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components, {
  CONDITION_ARGUMENT_IDS,
} from "../../../../../Types/Workflow/Components/Condition";
import { evaluateCondition } from "../../../../../Types/Workflow/Components/ConditionEvaluation";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export default class IfElse extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = Components.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.IfElse;
      },
    );

    if (!Component) {
      throw new BadDataException("If / Else component not found.");
    }

    this.setMetadata(Component);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const yesPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "yes";
      },
    );

    if (!yesPort) {
      throw options.onError(new BadDataException("Yes port not found"));
    }

    const noPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "no";
      },
    );

    if (!noPort) {
      throw options.onError(new BadDataException("No port not found"));
    }

    /*
     * The comparison is made here, in TypeScript, the way the old generated
     * code made it - see ConditionEvaluation. Nothing is written into code
     * and run, so no setting, nor any value a reference brings in, can run
     * as a script. A comparison the step does not know fails the run rather
     * than quietly taking a branch.
     */
    let isMet: boolean = false;

    try {
      isMet = evaluateCondition({
        valueToCheck: args[CONDITION_ARGUMENT_IDS.valueToCheck],
        operator: args[CONDITION_ARGUMENT_IDS.comparison],
        compareWith: args[CONDITION_ARGUMENT_IDS.compareWith],
        valueToCheckType: args[CONDITION_ARGUMENT_IDS.valueToCheckType],
        compareWithType: args[CONDITION_ARGUMENT_IDS.compareWithType],
      });
    } catch (err: unknown) {
      options.log("Could not check the condition.");
      options.log(err instanceof Error ? err.message : JSON.stringify(err));
      throw options.onError(
        err instanceof BadDataException
          ? err
          : new BadDataException(
              err instanceof Error
                ? err.message
                : "Could not check the condition.",
            ),
      );
    }

    return {
      returnValues: {},
      executePort: isMet ? yesPort : noPort,
    };
  }
}
