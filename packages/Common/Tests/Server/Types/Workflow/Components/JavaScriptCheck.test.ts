/*
 * Check With JavaScript: the script runs as Run Custom JavaScript runs one,
 * then the step goes on by Yes or No by what it returned, and says why.
 *
 * The decision itself (decideJavaScriptCheck) is pinned on its own, then the
 * step is run twice over: with the sandbox standing in, for every way a
 * script can end, and in the real sandbox, for the scripts the templates
 * use - which return { proceed, reason, ... } exactly as they did before
 * the If / Else after them went away.
 */

import JavaScriptCheck from "../../../../../Server/Types/Workflow/Components/JavaScriptCheck";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import VMUtil from "../../../../../Server/Utils/VM/VMAPI";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import {
  JavaScriptCheckDecision,
  MAX_JAVASCRIPT_CHECK_REASON_LENGTH,
  decideJavaScriptCheck,
} from "../../../../../Types/Workflow/Components/JavaScriptCheck";
import ReturnResult from "../../../../../Types/IsolatedVM/ReturnResult";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

interface LoggingOptions {
  options: RunOptions;
  lines: Array<string>;
}

function makeOptions(): LoggingOptions {
  const lines: Array<string> = [];

  return {
    lines: lines,
    options: {
      log: ((item: unknown): void => {
        lines.push(typeof item === "string" ? item : JSON.stringify(item));
      }) as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: ((exception: Exception): Exception => {
        return exception;
      }) as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    },
  };
}

function sandboxReturns(result: Partial<ReturnResult>): void {
  jest.spyOn(VMUtil, "runCodeInSandbox").mockResolvedValue({
    returnValue: undefined,
    logMessages: [],
    ...result,
  } as never);
}

describe("decideJavaScriptCheck", () => {
  test("true goes on by Yes", () => {
    expect(decideJavaScriptCheck(true)).toEqual({
      isYes: true,
      reason: "The script returned true.",
    });
  });

  test("an object whose proceed is true goes on by Yes, with its reason", () => {
    expect(
      decideJavaScriptCheck({ proceed: true, reason: "INC-12 is public." }),
    ).toEqual({ isYes: true, reason: "INC-12 is public." });
    expect(decideJavaScriptCheck({ proceed: true, title: "Down" })).toEqual({
      isYes: true,
      reason: "The script returned proceed: true.",
    });
  });

  test("an object whose proceed is not true goes on by No, with its reason", () => {
    expect(
      decideJavaScriptCheck({
        proceed: false,
        reason: "INC-12 is private, so no issue was filed.",
      }),
    ).toEqual({
      isYes: false,
      reason: "INC-12 is private, so no issue was filed.",
    });
    expect(decideJavaScriptCheck({ title: "Down" })).toEqual({
      isYes: false,
      reason: "The script did not return proceed: true.",
    });
  });

  test("only proceed: true counts, never a truthy stand-in", () => {
    for (const proceed of ["true", 1, "yes", {}, [true]]) {
      expect(decideJavaScriptCheck({ proceed: proceed as JSONValue }).isYes).toBe(
        false,
      );
    }
  });

  test.each([false, null, undefined, 0, 1, "", "true", "yes", [true], []])(
    "%p goes on by No",
    (returned: unknown) => {
      expect(decideJavaScriptCheck(returned as JSONValue).isYes).toBe(false);
    },
  );

  test("false says so, and anything else that it was neither", () => {
    expect(decideJavaScriptCheck(false).reason).toBe(
      "The script returned false.",
    );
    expect(decideJavaScriptCheck("yes").reason).toBe(
      "The script returned neither true nor proceed: true.",
    );
  });

  test("a reason that is not text is not used, and one that is long is cut", () => {
    expect(decideJavaScriptCheck({ proceed: false, reason: 42 }).reason).toBe(
      "The script did not return proceed: true.",
    );

    const long: JavaScriptCheckDecision = decideJavaScriptCheck({
      proceed: false,
      reason: "x".repeat(MAX_JAVASCRIPT_CHECK_REASON_LENGTH * 3),
    });

    expect(long.reason).toHaveLength(MAX_JAVASCRIPT_CHECK_REASON_LENGTH);
    expect(long.reason.endsWith("…")).toBe(true);
  });

  test("a reason of spaces is no reason", () => {
    expect(decideJavaScriptCheck({ proceed: true, reason: "   " }).reason).toBe(
      "The script returned proceed: true.",
    );
  });
});

describe("Check With JavaScript, its metadata", () => {
  test("is in the catalog under Conditions, with Yes, No and Error", () => {
    const metadata: ComponentMetadata | undefined = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.JavaScriptCheck;
      },
    );

    expect(metadata?.title).toBe("Check With JavaScript");
    expect(metadata?.category).toBe("Conditions");
    expect(
      metadata?.outPorts.map((port: Port) => {
        return port.id;
      }),
    ).toEqual(["yes", "no", "error"]);
    expect(
      metadata?.arguments.map((argument: { id: string }) => {
        return argument.id;
      }),
    ).toEqual(["code", "arguments"]);
  });
});

describe("Check With JavaScript, run with the sandbox standing in", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Yes, with what the script returned as its Value", async () => {
    sandboxReturns({ returnValue: { proceed: true, title: "Down" } });

    const result: RunReturnType = await new JavaScriptCheck().run(
      { code: "return 1", arguments: {} },
      makeOptions().options,
    );

    expect(result.executePort?.id).toBe("yes");
    expect(result.returnValues).toEqual({
      returnValue: { proceed: true, title: "Down" },
      reason: "The script returned proceed: true.",
    });
    expect(result.executePortReason).toBe("The script returned proceed: true.");
  });

  test("No, with the script's reason as the step's reason", async () => {
    sandboxReturns({
      returnValue: { proceed: false, reason: "Not production." },
    });

    const { options, lines } = makeOptions();
    const result: RunReturnType = await new JavaScriptCheck().run(
      { code: "return 1" },
      options,
    );

    expect(result.executePort?.id).toBe("no");
    expect(result.returnValues["reason"]).toBe("Not production.");
    expect(result.executePortReason).toBe("Not production.");
    expect(lines).toContain("No: Not production.");
  });

  test("a script that returns nothing goes on by No, and its Value is empty", async () => {
    sandboxReturns({ returnValue: undefined });

    const result: RunReturnType = await new JavaScriptCheck().run(
      { code: "" },
      makeOptions().options,
    );

    expect(result.executePort?.id).toBe("no");
    expect(result.returnValues["returnValue"]).toBeNull();
  });

  test("a script that throws goes on by Error, with why", async () => {
    sandboxReturns({ scriptError: new Error("args.title is undefined") });

    const result: RunReturnType = await new JavaScriptCheck().run(
      { code: "return args.title.x" },
      makeOptions().options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues).toEqual({ error: "args.title is undefined" });
    expect(result.executePortReason).toBe("args.title is undefined");
  });

  test("a sandbox that fails outright goes on by Error too", async () => {
    jest
      .spyOn(VMUtil, "runCodeInSandbox")
      .mockRejectedValue(new Error("isolate died") as never);

    const result: RunReturnType = await new JavaScriptCheck().run(
      { code: "return true" },
      makeOptions().options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe("isolate died");
  });

  test("Arguments given as JSON text reach the script as an object", async () => {
    const spy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(VMUtil, "runCodeInSandbox")
      .mockResolvedValue({ returnValue: true, logMessages: [] } as never);

    await new JavaScriptCheck().run(
      { code: "return true", arguments: '{"environment": "production"}' },
      makeOptions().options,
    );

    expect(
      (spy.mock.calls[0]![0] as { options: { args: unknown } }).options.args,
    ).toEqual({ environment: "production" });
  });

  test("Arguments that are not JSON go on by Error, before the script runs", async () => {
    const spy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      VMUtil,
      "runCodeInSandbox",
    );

    const result: RunReturnType = await new JavaScriptCheck().run(
      { code: "return true", arguments: "{not json" },
      makeOptions().options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(spy).not.toHaveBeenCalled();
  });

  test("what the script logs is in the run's log", async () => {
    sandboxReturns({ returnValue: true, logMessages: ["checked 3 values"] });

    const { options, lines } = makeOptions();

    await new JavaScriptCheck().run({ code: "return true" }, options);

    expect(lines).toContain("checked 3 values");
  });
});

describe("Check With JavaScript, run in the real sandbox", () => {
  test.each([
    ["return true;", "yes"],
    ["return false;", "no"],
    ["return { proceed: args.environment === 'production' };", "yes"],
    ["return { proceed: args.environment === 'staging', reason: 'not staging' };", "no"],
    ["return 'true';", "no"],
    ["throw new Error('broken');", "error"],
  ])("%s goes on by %s", async (code: string, port: string) => {
    const result: RunReturnType = await new JavaScriptCheck().run(
      { code: code, arguments: { environment: "production" } },
      makeOptions().options,
    );

    expect(result.executePort?.id).toBe(port);
  });

  test("a template's skip reads as the step's reason", async () => {
    const code: string = [
      "const skip = (reason) => ({ proceed: false, reason: reason });",
      "if (args.incident.isPrivate) return skip(args.incident.number + ' is private, so no issue was filed.');",
      "return { proceed: true, summary: args.incident.title };",
    ].join("\n");

    const skipped: RunReturnType = await new JavaScriptCheck().run(
      {
        code: code,
        arguments: {
          incident: { isPrivate: true, number: "INC-12", title: "Down" },
        },
      },
      makeOptions().options,
    );

    expect(skipped.executePort?.id).toBe("no");
    expect(skipped.executePortReason).toBe(
      "INC-12 is private, so no issue was filed.",
    );

    const filed: RunReturnType = await new JavaScriptCheck().run(
      {
        code: code,
        arguments: {
          incident: { isPrivate: false, number: "INC-12", title: "Down" },
        },
      },
      makeOptions().options,
    );

    expect(filed.executePort?.id).toBe("yes");
    expect(filed.returnValues["returnValue"]).toEqual({
      proceed: true,
      summary: "Down",
    });
  });
});
