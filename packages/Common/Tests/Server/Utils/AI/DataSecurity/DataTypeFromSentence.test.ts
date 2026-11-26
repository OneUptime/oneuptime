import AIService, {
  AI_DATA_SECURITY_DATA_TYPE_DESCRIBE_FEATURE,
  AILogRequest,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../../../Server/Services/AIService";
import { MAX_DATA_TYPE_EXAMPLE_SHAPES } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import { DESCRIBE_DATA_TYPE_SYSTEM_PROMPT } from "../../../../../Server/Utils/AI/DataSecurity/DataTypeDraftPrompt";
import DataTypeFromSentence, {
  DESCRIBE_DATA_TYPE_ATTEMPTS,
  DESCRIBE_EXAMPLES_NOT_SHAPES_MESSAGE,
  DESCRIBE_NO_ANSWER_MESSAGE,
  DESCRIBE_SENTENCE_MISSING_MESSAGE,
  DESCRIBE_SENTENCE_TOO_LONG_MESSAGE,
  DESCRIBE_UNUSABLE_MESSAGE,
  DescribedDataType,
  readDescribeSentence,
  readExampleShapes,
} from "../../../../../Server/Utils/AI/DataSecurity/DataTypeFromSentence";
import DataSecurityRunner from "../../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import logger from "../../../../../Server/Utils/Logger";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import { MAX_DESCRIBE_SENTENCE_LENGTH } from "../../../../../Types/DataSecurity/DataTypeDescribe";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { valueShape } from "../../../../../Utils/DataSecurity/UnplacedFields";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Describe It on the data type form (#10371): a sentence and the shapes of
 * a person's examples - never the examples - drafted by OneUptime AI into a
 * data type that fills the form, held to what a saved type is held to, and
 * saved by nothing here. The model, the project's AI switch and its own
 * data types are stand-ins; the reading, the prompt and the checks are the
 * product's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

// What a person types into the form, and the examples Test It runs.
const SENTENCE: string =
  "Our employee IDs look like EMP-123456, sometimes without the dash.";
const EXAMPLES: Array<string> = ["EMP-204518", "EMP-990011", "EMP331120"];

const EMPLOYEE_ID_DRAFT: JSONObject = {
  name: "Employee ID",
  description: "A company employee ID, such as EMP-999999.",
  category: DataCategory.ContactAndIdentity,
  sensitivity: DataSensitivity.Confidential,
  pattern: "\\bEMP-?\\d{6}\\b",
  ignoreCase: false,
  keywords: ["employee"],
  nameHints: ["employee id"],
  validator: "None",
};

let answers: Array<string>;
let aiEnabled: boolean;
let executeSpy: jest.SpyInstance;

function answer(
  draft: JSONObject | null,
  reason: string = "As described.",
): string {
  return JSON.stringify({ dataType: draft, reason });
}

function request(index: number = 0): AILogRequest {
  return executeSpy.mock.calls[index]![0] as AILogRequest;
}

function sentData(index: number = 0): JSONObject {
  return JSON.parse(
    request(index).messages[1]!.content as string,
  ) as JSONObject;
}

function describeIt(
  extra: { sentence?: unknown; exampleShapes?: unknown } = {},
): Promise<DescribedDataType> {
  return DataTypeFromSentence.draft({
    projectId: PROJECT_ID,
    userId: USER_ID,
    sentence: SENTENCE,
    exampleShapes: EXAMPLES.map(valueShape),
    ...extra,
  });
}

beforeEach(() => {
  answers = [answer(EMPLOYEE_ID_DRAFT)];
  aiEnabled = true;

  jest
    .spyOn(AIService, "assertProjectAIEnabled")
    .mockImplementation((async () => {
      if (!aiEnabled) {
        throw new BadDataException(
          "OneUptime AI is turned off for this project. Turn it on in Project Settings > AI.",
        );
      }
    }) as never);
  executeSpy = jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation((async () => {
      const content: string =
        answers.length > 1 ? answers.shift()! : answers[0]!;
      return { content };
    }) as never);
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockImplementation((async () => {
      return {
        setting: {},
        options: {},
        customTypes: new Map([["custom:1", { name: "Policy number" }]]),
      };
    }) as never);
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the browser sends", () => {
  test("examples come as their shapes, each read again as one, at most ten", () => {
    expect(readExampleShapes(undefined)).toEqual([]);
    expect(
      readExampleShapes(["AAA-999999", "AAA999999", "AAA-999999"]),
    ).toEqual(["AAA-999999", "AAA999999"]);
    expect(
      readExampleShapes(
        Array.from({ length: 30 }, (_value: unknown, index: number) => {
          return `AAA-${"9".repeat(index + 1)}`;
        }),
      ),
    ).toHaveLength(MAX_DATA_TYPE_EXAMPLE_SHAPES);
  });

  test("an example sent as itself refuses the request: a value never reaches the model", () => {
    for (const sent of [
      ["EMP-204518"],
      ["AAA-999999", "emp@acme.example"],
      "AAA-999999",
      [42],
    ]) {
      expect(() => {
        return readExampleShapes(sent);
      }).toThrow(DESCRIBE_EXAMPLES_NOT_SHAPES_MESSAGE);
    }
  });

  test("a sentence is needed, and held to its length", () => {
    expect(readDescribeSentence(`  ${SENTENCE}  `)).toBe(SENTENCE);
    expect(() => {
      return readDescribeSentence(" ");
    }).toThrow(DESCRIBE_SENTENCE_MISSING_MESSAGE);
    expect(() => {
      return readDescribeSentence(undefined);
    }).toThrow(DESCRIBE_SENTENCE_MISSING_MESSAGE);
    expect(() => {
      return readDescribeSentence("x".repeat(MAX_DESCRIBE_SENTENCE_LENGTH + 1));
    }).toThrow(DESCRIBE_SENTENCE_TOO_LONG_MESSAGE);
  });
});

describe("drafting from a sentence", () => {
  test("asks once, while the person waits, with the sentence and the shapes and no example", async () => {
    const described: DescribedDataType = await describeIt();

    expect(described.draft).toEqual(
      expect.objectContaining({
        name: "Employee ID",
        pattern: "\\bEMP-?\\d{6}\\b",
        category: DataCategory.ContactAndIdentity,
      }),
    );
    expect(described.reason).toBe("As described.");
    expect(executeSpy).toHaveBeenCalledTimes(1);

    const sent: AILogRequest = request();

    expect(sent.feature).toBe(AI_DATA_SECURITY_DATA_TYPE_DESCRIBE_FEATURE);
    expect(sent.userId).toBe(USER_ID);
    expect(sent.requestTimeoutInMs).toBe(
      INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
    );
    expect(sent.requestRetries).toBe(0);
    expect(sent.storeContentPreviews).toBe(false);
    expect(sent.recordContentInTelemetry).toBe(false);
    expect(
      (sent.messages[0]!.content as string).startsWith(
        DESCRIBE_DATA_TYPE_SYSTEM_PROMPT,
      ),
    ).toBe(true);

    expect(sentData()).toEqual(
      expect.objectContaining({
        description: expect.stringContaining("employee IDs look like"),
        exampleShapes: ["AAA-999999", "AAA999999"],
        knownDataTypes: expect.arrayContaining(["Policy number"]),
      }),
    );

    // The examples stay in the browser: none of them is in what was sent.
    const everything: string = JSON.stringify(sent.messages);

    for (const example of EXAMPLES) {
      expect(everything).not.toContain(example);
    }
  });

  test("with AI off for the project, asks nothing and says so", async () => {
    aiEnabled = false;

    await expect(describeIt()).rejects.toThrow("OneUptime AI is turned off");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test("a draft that is not one a scan could run is asked for once more, told why", async () => {
    answers = [
      // Finds plain words: not a data type.
      answer({ ...EMPLOYEE_ID_DRAFT, pattern: "\\w+" }),
      answer(EMPLOYEE_ID_DRAFT),
    ];

    const described: DescribedDataType = await describeIt();

    expect(described.draft.pattern).toBe("\\bEMP-?\\d{6}\\b");
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(sentData(1)["previousDraft"]).toEqual({
      pattern: "\\w+",
      problem: expect.any(String),
    });
  });

  test("after two drafts no scan could run, says to write it by hand", async () => {
    answers = [answer({ ...EMPLOYEE_ID_DRAFT, pattern: "(" })];

    await expect(describeIt()).rejects.toThrow(DESCRIBE_UNUSABLE_MESSAGE);
    expect(executeSpy).toHaveBeenCalledTimes(DESCRIBE_DATA_TYPE_ATTEMPTS);
  });

  test("when the sentence describes no data type, says why, and fills nothing", async () => {
    answers = [answer(null, "It describes a colour, not data.")];

    await expect(
      describeIt({ sentence: "Make the dashboard blue." }),
    ).rejects.toThrow(
      "OneUptime AI found no data type to draft in that description: It describes a colour, not data. Describe it differently, or write the pattern yourself.",
    );
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  test("an answer that is not one says to try again", async () => {
    answers = ["I think it is an employee ID."];

    await expect(describeIt()).rejects.toThrow(DESCRIBE_NO_ANSWER_MESSAGE);
  });

  test("a request with an example as itself asks nothing", async () => {
    await expect(describeIt({ exampleShapes: EXAMPLES })).rejects.toThrow(
      DESCRIBE_EXAMPLES_NOT_SHAPES_MESSAGE,
    );
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
