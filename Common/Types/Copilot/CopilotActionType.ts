enum CopilotActionType {
  IMPROVE_COMMENTS = "Improve Comments",
  IMRPOVE_README = "Improve Readme",
  FIX_GRAMMAR_AND_SPELLING = "Fix Grammar and Spelling",
  IMPROVE_VARIABLE_NAMES = "Improve Variable Names",
  REFACTOR_CODE = "Refactor Code",
  WRITE_UNIT_TESTS = "Write Unit Tests",
  IMPROVE_LOGS = "Improve Logs",
  IMPROVE_SPANS = "Improve Spans",
  IMPROVE_METRICS = "Improve Metrics",
  FIX_EXCEPTIONS = "Fix Exceptions",
  FIX_PERFORMANCE_ISSUES = "Fix Performance Issues",
  FIX_BUGS = "Fix Bugs",
}

export interface CopilotActionTypeData {
  type: CopilotActionType;
  description: string;
  defaultPriority: number;
}

export class CopilotActionTypeUtil {
  public static getAllCopilotActionTypes(): Array<CopilotActionTypeData> {
    return [
      // Fix broken code.
      {
        type: CopilotActionType.FIX_EXCEPTIONS,
        description: "Fix exceptions in your codebase",
        defaultPriority: 1,
      },
      {
        type: CopilotActionType.FIX_PERFORMANCE_ISSUES,
        description: "Fix performance issues in your codebase",
        defaultPriority: 1,
      },
      {
        type: CopilotActionType.FIX_BUGS,
        description: "Fix simple bugs and small issues in your codebase",
        defaultPriority: 1,
      },

      // Improve debugging.
      {
        type: CopilotActionType.IMPROVE_LOGS,
        description:
          "Add and Improve OpenTelemetry logs to your codebase where required to make debugging easier.",
        defaultPriority: 2,
      },
      {
        type: CopilotActionType.IMPROVE_SPANS,
        description:
          "Add and Improve OpenTelemetry spans to your codebase where required to make debugging easier.",
        defaultPriority: 2,
      },
      {
        type: CopilotActionType.IMPROVE_METRICS,
        description:
          "Add and Improve OpenTelemetry metrics to your codebase where required to make debugging easier.",
        defaultPriority: 2,
      },

      // Improve code and test quality.
      {
        type: CopilotActionType.REFACTOR_CODE,
        description: "Refactor code and make it into smaller units",
        defaultPriority: 3,
      },
      {
        type: CopilotActionType.WRITE_UNIT_TESTS,
        description: "Write unit tests",
        defaultPriority: 3,
      },

      // add comments.
      {
        type: CopilotActionType.IMPROVE_COMMENTS,
        description: "Add or improve comments in your codebase",
        defaultPriority: 4,
      },
      {
        type: CopilotActionType.IMRPOVE_README,
        description: "Add or improve the README file",
        defaultPriority: 4,
      },

      // Fix grammar and spelling mistakes
      {
        type: CopilotActionType.FIX_GRAMMAR_AND_SPELLING,
        description: "Fix grammar and spelling mistakes",
        defaultPriority: 5,
      },
      {
        type: CopilotActionType.IMPROVE_VARIABLE_NAMES,
        description: "Improve variable names and make it understandable",
        defaultPriority: 5,
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
