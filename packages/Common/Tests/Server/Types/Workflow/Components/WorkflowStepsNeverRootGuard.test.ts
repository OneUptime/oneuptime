import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * GUARD: A WORKFLOW STEP NEVER ACTS AS ONEUPTIME ITSELF.
 *
 * Every step that reads or writes a project's records (Components/BaseModel)
 * acts with the props ComponentCode.getStepProps builds through
 * WorkflowPrincipal: a Project Admin of the workflow's project, on its plan.
 * So in those components:
 *
 *  - no service is handed root props. The one read left as OneUptime itself
 *    is the model-event trigger finding which of the project's workflows to
 *    start (a Workflow read, not the project's records);
 *  - every call to the step's own service passes the step's props, built by
 *    getStepProps - never props written out by hand;
 *  - getStepProps builds them with WorkflowPrincipal, and nothing else does.
 *
 * A new step, or a new call in an old one, that reaches for root fails here
 * by file name.
 */

const COMPONENTS_DIR: string = path.resolve(
  __dirname,
  "../../../../../Server/Types/Workflow/Components/BaseModel",
);
const COMPONENT_CODE_FILE: string = path.resolve(
  __dirname,
  "../../../../../Server/Types/Workflow/ComponentCode.ts",
);

// The root reads a component may make, by file, and why.
const ROOT_READS: Record<string, { count: number; reason: string }> = {
  "OnTriggerBaseModel.ts": {
    count: 1,
    reason:
      "initTrigger finds the project's enabled workflows with this trigger: a Workflow read, made before any step runs.",
  },
};

/*
 * The calls a step makes to its own service, a declaration from a template
 * (Create One Incident's Incident Template) among them.
 */
const SERVICE_CALL: RegExp =
  /this\.(?:modelService|service!?)\.(create|createFromTemplate|findBy|findOneBy|findOneById|updateBy|updateOneBy|updateOneById|deleteBy|deleteOneBy|deleteOneById|countBy)\(\s*\{/g;

// The props such a call may pass: the step's own, built for this run.
const STEP_PROPS: RegExp =
  /props:\s*(await this\.getStepProps\(options\)|props|\{\s*\.\.\.props\s*\})\s*[,}\n]/;

const COMPONENT_FILES: Array<string> = fs
  .readdirSync(COMPONENTS_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".ts");
  })
  .sort();

function read(file: string): string {
  return fs.readFileSync(path.join(COMPONENTS_DIR, file), "utf8");
}

// The argument object of the call starting at `start`: up to its closing brace.
function callArgument(source: string, start: number): string {
  const open: number = source.indexOf("{", start);
  let depth: number = 0;

  for (let index: number = open; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }

  return source.slice(open);
}

describe("GUARD: workflow steps never act as OneUptime itself", () => {
  test("the components are where they are expected", () => {
    expect(COMPONENT_FILES).toEqual(
      expect.arrayContaining([
        "CreateOneBaseModel.ts",
        "CreateManyBaseModel.ts",
        "UpdateOneBaseModel.ts",
        "UpdateManyBaseModel.ts",
        "DeleteOneBaseModel.ts",
        "DeleteManyBaseModel.ts",
        "FindOneBaseModel.ts",
        "FindManyBaseModel.ts",
        "OnTriggerBaseModel.ts",
      ]),
    );
  });

  test.each(COMPONENT_FILES)(
    "%s hands no service root props",
    (file: string) => {
      const rootProps: number = (read(file).match(/isRoot\s*:/g) || []).length;

      expect({ file, rootProps }).toEqual({
        file,
        rootProps: ROOT_READS[file]?.count || 0,
      });
    },
  );

  test("the one root read left is the trigger finding its workflows", () => {
    const source: string = read("OnTriggerBaseModel.ts");
    const rootAt: number = source.search(/isRoot\s*:/);
    const call: number = source.lastIndexOf("await ", rootAt);

    expect(source.slice(call, rootAt)).toContain("WorkflowService.findBy(");
    expect(source.slice(0, rootAt)).toContain("public async initTrigger(");
  });

  test.each(COMPONENT_FILES)(
    "%s passes the step's own props to every call of its service",
    (file: string) => {
      const source: string = read(file);
      const calls: Array<RegExpExecArray> = Array.from(
        source.matchAll(SERVICE_CALL),
      );
      const handBuilt: Array<string> = [];

      for (const call of calls) {
        const argument: string = callArgument(source, call.index!);

        if (!STEP_PROPS.test(argument)) {
          handBuilt.push(`${call[1]}: ${argument.slice(0, 120)}`);
        }
      }

      expect(handBuilt).toEqual([]);

      if (calls.length > 0) {
        expect(source).toContain("await this.getStepProps(options)");
      }
    },
  );

  test("Create One's declaration from a template is one of those calls", () => {
    const calls: Array<string> = Array.from(
      read("CreateOneBaseModel.ts").matchAll(SERVICE_CALL),
    ).map((call: RegExpExecArray): string => {
      return call[1]!;
    });

    expect(calls.sort()).toEqual(["create", "createFromTemplate"]);
  });

  test("getStepProps builds a step's props with WorkflowPrincipal, for the workflow that runs", () => {
    const source: string = fs.readFileSync(COMPONENT_CODE_FILE, "utf8");
    const method: string = source.slice(
      source.indexOf("protected async getStepProps("),
    );

    expect(method).toContain("WorkflowPrincipal.getProps({");
    expect(method).toContain("projectId: options.projectId");
    expect(method).toContain("workflowId: options.workflowId");
    expect(method.slice(0, method.indexOf("\n  }\n"))).not.toMatch(/isRoot/);
  });
});
