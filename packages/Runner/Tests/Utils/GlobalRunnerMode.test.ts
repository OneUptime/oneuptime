import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";

/*
 * ---------------------------------------------------------------------------
 * What a global Runner is, and therefore what it refuses - learnt from the
 * server only, never from the Runner's own environment, so an operator
 * cannot make a project's Runner take every project's steps, and a global
 * Runner never forgets what it is on a server that stops saying.
 * ---------------------------------------------------------------------------
 */

afterEach(() => {
  GlobalRunnerMode.reset();
});

describe("GlobalRunnerMode", () => {
  test("is off until the server says the Runner is global", () => {
    expect(GlobalRunnerMode.isActive()).toBe(false);

    GlobalRunnerMode.setFromServer(true);

    expect(GlobalRunnerMode.isActive()).toBe(true);
  });

  test("an answer that does not say keeps the last one", () => {
    GlobalRunnerMode.setFromServer(true);
    GlobalRunnerMode.setFromServer(undefined);

    expect(GlobalRunnerMode.isActive()).toBe(true);
  });

  test("the server saying no turns it off", () => {
    GlobalRunnerMode.setFromServer(true);
    GlobalRunnerMode.setFromServer(false);

    expect(GlobalRunnerMode.isActive()).toBe(false);
  });

  test("asks for JavaScript steps only", () => {
    expect(GlobalRunnerMode.getAllowedStepTypes()).toEqual(["JavaScript"]);
  });

  test("refuses nothing on a project's own Runner", () => {
    for (const stepType of ["Bash", "SSH", "Kubernetes", "Kubectl"]) {
      expect(GlobalRunnerMode.getJobRefusal({ stepType })).toBeNull();
    }

    expect(
      GlobalRunnerMode.getJobRefusal({
        stepType: "Bash",
        origin: "AiRemediation",
        credential: { password: "x" },
      }),
    ).toBeNull();
  });

  describe("on a global Runner", () => {
    beforeEach(() => {
      GlobalRunnerMode.setFromServer(true);
    });

    test("runs a runbook's own JavaScript step", () => {
      expect(
        GlobalRunnerMode.getJobRefusal({
          stepType: "JavaScript",
          origin: "Runbook",
        }),
      ).toBeNull();
    });

    test("a job with no origin is a runbook's own (the historical default)", () => {
      expect(
        GlobalRunnerMode.getJobRefusal({ stepType: "JavaScript" }),
      ).toBeNull();
    });

    test.each(["Bash", "SSH", "Kubernetes", "Kubectl", "ResourceCommand", ""])(
      "refuses a %s job, naming what it runs instead",
      (stepType: string) => {
        const refusal: string | null = GlobalRunnerMode.getJobRefusal({
          stepType,
        });

        expect(refusal).toContain("This is a global Runner");
        expect(refusal).toContain("JavaScript steps for every project");
        expect(refusal).toContain(`never ${stepType || "unknown"} steps`);
        expect(refusal).toContain("Runbooks > Runners");
      },
    );

    test("refuses an AI-composed command, whatever its type", () => {
      for (const origin of ["AiRemediation", "AiInvestigation"]) {
        expect(
          GlobalRunnerMode.getJobRefusal({ stepType: "JavaScript", origin }),
        ).toBe(
          "This is a global Runner: it runs a runbook's own steps only, never commands composed by OneUptime AI.",
        );
      }
    });

    test("refuses a job carrying a credential", () => {
      expect(
        GlobalRunnerMode.getJobRefusal({
          stepType: "JavaScript",
          credential: { token: "t" },
        }),
      ).toContain("never handed a credential");
    });
  });
});

describe("RunnerCapabilities on a global Runner", () => {
  afterEach(() => {
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
  });

  test("takes the code fixes it was granted, and AI commands stay off whatever was granted", () => {
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: true,
    });
    GlobalRunnerMode.setFromServer(true);

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });
  });

  test("takes no code fixes it was not granted", () => {
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
    GlobalRunnerMode.setFromServer(true);

    expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(false);
  });

  test("a paused global Runner takes no runbook steps", () => {
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
    GlobalRunnerMode.setFromServer(true);

    expect(RunnerCapabilities.resolve().canRunRunbooks).toBe(false);
  });

  test("negative control: a project's own Runner keeps what it was granted", () => {
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: true,
    });
    GlobalRunnerMode.setFromServer(false);

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: true,
    });
  });
});
