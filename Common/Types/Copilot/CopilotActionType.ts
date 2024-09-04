enum CopilotActionType {
  IMPROVE_COMMENTS = "Improve Comments",
  ADD_COMMENTS = "Add Comments",

  IMRPOVE_README = "Improve Readme",
  ADD_README = "Add Readme",

  FIX_GRAMMAR_AND_SPELLING = "Fix Grammar and Spelling",
  IMPROVE_VARIABLE_NAMES = "Improve Variable Names",
  REFACTOR_CODE = "Refactor Code",

  WRITE_UNIT_TESTS = "Write Unit Tests",
  IMPROVE_UNIT_TESTS = "Improve Unit Tests",

  IMPROVE_LOGS = "Improve Logs",
  ADD_LOGS = "Add Logs",

  IMPROVE_SPANS = "Improve Spans",
  ADD_SPANS = "Add Spans",

  IMPROVE_METRICS = "Improve Metrics",
  ADD_METRICS = "Add Metrics",

  FIX_EXCEPTIONS = "Fix Exceptions",
  FIX_PERFORMANCE_ISSUES = "Fix Performance Issues",
  FIX_BUGS = "Fix Bugs",

  // SETUP_ACTIONS
  SETUP_OPEN_TELEMETRY = "Setup OpenTelemetry",

  // Setup Unit Test Framework
  SETUP_UNIT_TEST_FRAMEWORK = "Setup Unit Test Framework",
}

export interface CopilotActionTypeData {
  type: CopilotActionType;
  description: string;
  defaultPriority: number;
  dependsOn: Array<CopilotActionType>;
}

export class CopilotActionTypeUtil {
  public static getAllCopilotActionTypes(): Array<CopilotActionTypeData> {
    return [
      // Fix broken code.
      {
        type: CopilotActionType.FIX_EXCEPTIONS,
        description: "Fix exceptions in your codebase",
        defaultPriority: 1,
        dependsOn: [CopilotActionType.SETUP_OPEN_TELEMETRY],
      },
      {
        type: CopilotActionType.FIX_PERFORMANCE_ISSUES,
        description: "Fix performance issues in your codebase",
        defaultPriority: 1,
        dependsOn: [CopilotActionType.SETUP_OPEN_TELEMETRY],
      },
      {
        type: CopilotActionType.FIX_BUGS,
        description: "Fix simple bugs and small issues in your codebase",
        defaultPriority: 1,
        dependsOn: [],
      },

      // Improve debugging.

      // add logs, metircs and spans.

      {
        type: CopilotActionType.ADD_LOGS,
        description: "Add OpenTelemetry logs in your codebase",
        defaultPriority: 2,
        dependsOn: [CopilotActionType.SETUP_OPEN_TELEMETRY],
      },
      {
        type: CopilotActionType.ADD_SPANS,
        description: "Add OpenTelemetry spans in your codebase",
        defaultPriority: 2,
        dependsOn: [CopilotActionType.SETUP_OPEN_TELEMETRY],
      },
      {
        type: CopilotActionType.ADD_METRICS,
        description: "Add OpenTelemetry metrics in your codebase",
        defaultPriority: 2,
        dependsOn: [CopilotActionType.SETUP_OPEN_TELEMETRY],
      },
      {
        type: CopilotActionType.IMPROVE_LOGS,
        description:
          "Improve OpenTelemetry logs in your codebase where required to make debugging easier.",
        defaultPriority: 2,
        dependsOn: [CopilotActionType.SETUP_OPEN_TELEMETRY],
      },
      {
        type: CopilotActionType.IMPROVE_SPANS,
        description:
          "Improve OpenTelemetry spans in your codebase where required to make debugging easier.",
        defaultPriority: 2,
        dependsOn: [CopilotActionType.SETUP_OPEN_TELEMETRY],
      },
      {
        type: CopilotActionType.IMPROVE_METRICS,
        description:
          "Improve OpenTelemetry metrics in your codebase where required to make debugging easier.",
        defaultPriority: 2,
        dependsOn: [CopilotActionType.SETUP_OPEN_TELEMETRY],
      },

      // Improve code and test quality.
      {
        type: CopilotActionType.REFACTOR_CODE,
        description: "Refactor code and make it into smaller units",
        defaultPriority: 3,
        dependsOn: [],
      },
      {
        type: CopilotActionType.WRITE_UNIT_TESTS,
        description: "Add unit tests",
        defaultPriority: 3,
        dependsOn: [CopilotActionType.SETUP_UNIT_TEST_FRAMEWORK],
      },
      {
        type: CopilotActionType.IMPROVE_UNIT_TESTS,
        description: "Improve unit tests",
        defaultPriority: 3,
        dependsOn: [CopilotActionType.SETUP_UNIT_TEST_FRAMEWORK],
      },

      // add comments.
      {
        type: CopilotActionType.IMPROVE_COMMENTS,
        description: "Improve comments in your codebase",
        defaultPriority: 4,
        dependsOn: [],
      },
      {
        type: CopilotActionType.ADD_COMMENTS,
        description: "Add comments in your codebase",
        defaultPriority: 4,
        dependsOn: [],
      },

      // Add or improve README file.
      {
        type: CopilotActionType.ADD_README,
        description: "Add a README file",
        defaultPriority: 4,
        dependsOn: [],
      },
      {
        type: CopilotActionType.IMRPOVE_README,
        description: "Improve the README file",
        defaultPriority: 4,
        dependsOn: [],
      },

      // Fix grammar and spelling mistakes
      {
        type: CopilotActionType.FIX_GRAMMAR_AND_SPELLING,
        description: "Fix grammar and spelling mistakes",
        defaultPriority: 5,
        dependsOn: [],
      },
      {
        type: CopilotActionType.IMPROVE_VARIABLE_NAMES,
        description: "Improve variable names and make it understandable",
        defaultPriority: 5,
        dependsOn: [],
      },
    ];
  }

  public static getSetupActionTypes(): Array<CopilotActionTypeData> {
    return [
      {
        type: CopilotActionType.SETUP_OPEN_TELEMETRY,
        description: "Setup OpenTelemetry in your codebase",
        defaultPriority: 1,
        dependsOn: [],
      },
      {
        type: CopilotActionType.SETUP_UNIT_TEST_FRAMEWORK,
        description: "Setup Unit Test Framework in your codebase",
        defaultPriority: 1,
        dependsOn: [],
      },
    ];
  }

  public static getCopilotActionType(
    type: CopilotActionType,
  ): CopilotActionTypeData {
    return this.getAllCopilotActionTypes().find(
      (copilotActionTypeData: CopilotActionTypeData) => {
        return copilotActionTypeData.type === type;
      },
    ) as CopilotActionTypeData;
  }

  // get actions by priority.
  public static getActionsByPriority(
    priority: number,
  ): Array<CopilotActionTypeData> {
    return this.getAllCopilotActionTypes().filter(
      (copilotActionTypeData: CopilotActionTypeData) => {
        return copilotActionTypeData.defaultPriority === priority;
      },
    );
  }
}

export default CopilotActionType;
