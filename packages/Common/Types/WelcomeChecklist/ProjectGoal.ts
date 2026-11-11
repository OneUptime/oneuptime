/*
 * WHAT A PROJECT CAME TO DO (issue #6803).
 *
 * Home asks a new project's owner once: "What do you want to do first?".
 * Several goals can be ticked, and the question can be skipped. The answer
 * is kept on the project (Project.goals) as an array of these values:
 *
 *   null  never answered (a project from before the question, or nobody
 *         who may answer it has been to Home yet);
 *   []    skipped: the person chose nothing;
 *   [...] the goals, in the order of PROJECT_GOALS.
 *
 * Read it with parseProjectGoals, never as it is stored. Later work reads
 * the same column: #6814 (products that fit the project) starts a project
 * from its goals, and the Welcome checklist builds its steps from them
 * (WelcomeChecklist.ts).
 *
 * A value is stored and sent to product analytics (home/goals_chosen):
 * never rename one, and never reuse one for another goal. A new goal is a
 * value here, its place in PROJECT_GOALS, its steps in STEPS_OF_GOAL
 * (WelcomeChecklist.ts) and its words in the Dashboard
 * (Components/Home/WelcomeChecklist/WelcomeChecklistCatalog.ts).
 *
 * Pure types: the server, the Dashboard and their tests read them.
 */
enum ProjectGoal {
  // "Know when my website or API is down".
  Uptime = "uptime",
  // "Page the right person when something breaks".
  OnCall = "on_call",
  // "Tell my customers with a status page".
  StatusPage = "status_page",
  // "See my logs, metrics and traces".
  Telemetry = "telemetry",
  // "Watch my servers, Kubernetes or cloud".
  Infrastructure = "infrastructure",
  // "I am moving from another tool" (#6809).
  Import = "import",
  // "Just looking around" (#6808 adds a sample project to look around in).
  Explore = "explore",
}

export default ProjectGoal;

// Every goal, in the order the question lists them and the column keeps them.
export const PROJECT_GOALS: ReadonlyArray<ProjectGoal> = [
  ProjectGoal.Uptime,
  ProjectGoal.OnCall,
  ProjectGoal.StatusPage,
  ProjectGoal.Telemetry,
  ProjectGoal.Infrastructure,
  ProjectGoal.Import,
  ProjectGoal.Explore,
];

export const isProjectGoal: (value: unknown) => value is ProjectGoal = (
  value: unknown,
): value is ProjectGoal => {
  return (
    typeof value === "string" &&
    (PROJECT_GOALS as ReadonlyArray<string>).includes(value)
  );
};

/*
 * The goals a stored or sent value holds: each known goal once, in the order
 * of PROJECT_GOALS, anything else left out. null when the value is not a
 * list at all - never answered. An empty list is an answer: skipped.
 */
export const parseProjectGoals: (
  value: unknown,
) => Array<ProjectGoal> | null = (
  value: unknown,
): Array<ProjectGoal> | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const chosen: Set<string> = new Set<string>();

  for (const item of value) {
    if (isProjectGoal(item)) {
      chosen.add(item);
    }
  }

  return PROJECT_GOALS.filter((goal: ProjectGoal): boolean => {
    return chosen.has(goal);
  });
};

/*
 * The goals as product analytics carries them (home/goals_chosen and the
 * checklist's events): their values, in order, joined by "." - a token
 * (a-z, 0-9, _ and .), so it survives toProductEventToken whole. "" when
 * there are none.
 */
export const GOALS_EVENT_SEPARATOR: string = ".";

export const toGoalsEventValue: (
  goals: ReadonlyArray<ProjectGoal> | null,
) => string = (goals: ReadonlyArray<ProjectGoal> | null): string => {
  return (parseProjectGoals(goals ? [...goals] : null) || []).join(
    GOALS_EVENT_SEPARATOR,
  );
};

// The longest toGoalsEventValue can be: every goal.
export const GOALS_EVENT_VALUE_MAX_LENGTH: number =
  PROJECT_GOALS.join(GOALS_EVENT_SEPARATOR).length;
