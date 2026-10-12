import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components, {
  SWITCH_ARGUMENT_IDS,
  SWITCH_DEFAULT_PORT_ID,
} from "../../../../../Types/Workflow/Components/Switch";
import {
  SwitchCase,
  SwitchCasesReading,
  SwitchEvaluation,
  describeSwitchCaseCheck,
  describeSwitchEvaluation,
  evaluateSwitch,
  findSwitchCaseWithUnknownComparison,
  getSwitchCasePort,
  getUnknownSwitchComparisonMessage,
  parseSwitchCases,
  readSwitchCases,
} from "../../../../../Types/Workflow/Components/SwitchCases";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

/*
 * Switch / Case: compares the value to check with each case in turn, from the
 * top, and takes the output of the first case that matches - or Default when
 * none does. A case matches exactly when If / Else would say Yes to it
 * (SwitchCases runs If / Else's own comparison), and nothing is written into
 * code or run as a script.
 *
 * The cases are compared with their values resolved, but named - the output
 * a run takes, the sentence saying why, the lines of the run's log - as they
 * are configured (options.configuredArguments), which is what the canvas
 * shows. A case compared with a secret variable is then named after the
 * variable, never after its value.
 */
export default class Switch extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = Components.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.Switch;
      },
    );

    if (!Component) {
      throw new BadDataException("Switch / Case component not found.");
    }

    this.setMetadata(Component);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const defaultPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === SWITCH_DEFAULT_PORT_ID;
      },
    );

    if (!defaultPort) {
      throw options.onError(new BadDataException("Default port not found"));
    }

    const reading: SwitchCasesReading = parseSwitchCases(
      args[SWITCH_ARGUMENT_IDS.cases],
    );

    if (!reading.isReadable) {
      options.log("Could not read the cases.");
      throw options.onError(
        new BadDataException(
          "The cases of this Switch / Case could not be read: they are not a list. Open the step and save its cases again.",
        ),
      );
    }

    const namingCases: Array<SwitchCase> = this.getNamingCases({
      resolvedCases: reading.cases,
      configuredArguments: options.configuredArguments,
    });

    /*
     * Every case's comparison is checked before any case is compared, so a
     * broken case stops every run, not only the ones whose value reaches it.
     * The message quotes the comparison as configured.
     */
    const unknown: { index: number; switchCase: SwitchCase } | null =
      findSwitchCaseWithUnknownComparison(reading.cases);

    if (unknown) {
      const message: string = getUnknownSwitchComparisonMessage({
        index: unknown.index,
        switchCase: namingCases[unknown.index] || unknown.switchCase,
      });

      options.log("Could not check the cases.");
      options.log(message);
      throw options.onError(new BadDataException(message));
    }

    let evaluation: SwitchEvaluation;

    try {
      evaluation = evaluateSwitch({
        valueToCheck: args[SWITCH_ARGUMENT_IDS.valueToCheck],
        cases: reading.cases,
      });
    } catch (err: unknown) {
      options.log("Could not check the cases.");
      throw options.onError(
        err instanceof BadDataException
          ? err
          : new BadDataException(
              err instanceof Error ? err.message : "Could not check the cases.",
            ),
      );
    }

    for (const check of evaluation.checks) {
      options.log(
        describeSwitchCaseCheck({
          check: check,
          configuredCases: namingCases,
        }),
      );
    }

    const reason: string = describeSwitchEvaluation({
      evaluation: evaluation,
      configuredCases: namingCases,
    });

    options.log(reason);

    if (!evaluation.matched) {
      return {
        returnValues: {},
        executePort: defaultPort,
        executePortReason: reason,
      };
    }

    const index: number = evaluation.matched.index;

    return {
      returnValues: {},
      executePort: getSwitchCasePort(
        namingCases[index] || evaluation.matched.switchCase,
        index,
      ),
      executePortReason: reason,
    };
  }

  /*
   * The cases to name things after: as configured when the runner says how
   * they are configured, case by case. A case it does not say anything about
   * is named by its number alone ("Case 2"), never by its resolved value. A
   * caller that hands over no configuration at all - a test - gets the
   * resolved cases.
   */
  private getNamingCases(data: {
    resolvedCases: Array<SwitchCase>;
    configuredArguments: JSONObject | undefined;
  }): Array<SwitchCase> {
    if (!data.configuredArguments) {
      return data.resolvedCases;
    }

    const configured: Array<SwitchCase> = readSwitchCases(
      data.configuredArguments[SWITCH_ARGUMENT_IDS.cases],
    );

    return data.resolvedCases.map(
      (resolved: SwitchCase, index: number): SwitchCase => {
        const match: SwitchCase | undefined = configured[index];

        if (match && match.id === resolved.id) {
          return match;
        }

        return {
          id: resolved.id,
          comparison: "",
          value: "",
          compareAs: "",
        };
      },
    );
  }
}
