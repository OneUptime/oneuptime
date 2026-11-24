import {
  ARCHIVED_REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL,
  NAME_TAKEN_REFUSALS,
  REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL,
  REQUIRED_UNIQUE_NAMES_RENAMED_TOGETHER_REFUSAL,
  getRequiredUniqueNameTakenRefusal,
  isNameTakenRefusal,
} from "../../../Types/Database/UniqueName";
import NameTakenException, {
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODE,
  REFUSAL_CODE_FIELD,
  TAKEN_BY_ID_FIELD,
} from "../../../Types/Exception/NameTakenException";
import {
  getLabelOfSentenceTerm,
  readRefusalValues,
  RefusalWithValues,
} from "../../../Types/Exception/RefusalWithValues";
import { getErrorDetails } from "../../../Types/Exception/BadDataExceptionWithDetails";
import {
  createTranslator,
  fillTemplate,
  translatableTerm,
} from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

// A no-break space, as a document pastes one.
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

/*
 * A NAME ANOTHER RECORD OF ITS KIND HAS, WHILE THE PROJECT REQUIRES UNIQUE
 * NAMES (#10761).
 *
 * One sentence refuses every kind the setting holds: the kind is written
 * into it as the middle of an English sentence writes it ("monitor", "API
 * key"), and read back out by the Dashboard as its label ("API Key") to be
 * said in the reader's word, under the form's Name field. The refusal names
 * the record that has the name - by its own name, and its id beside the
 * words - where the caller may read it. Here: the words, the reading back,
 * and the code and id the answer carries.
 */

describe("the refusal of a name another record of its kind has", () => {
  test("says what happened, why, and what to do next, with the kind and the name", () => {
    expect(
      getRequiredUniqueNameTakenRefusal({
        kindLabel: "Monitor",
        name: "API Health Check",
        isArchived: false,
      }),
    ).toBe(
      "Another monitor in this project is already called API Health Check, and the project requires unique names. Pick another name.",
    );
  });

  test("writes the kind as the middle of a sentence does: acronyms and names keep their capitals", () => {
    for (const [label, word] of [
      ["API Key", "API key"],
      ["Incident Template", "incident template"],
      ["AI Agent", "AI agent"],
      ["LLM Cost Budget", "LLM cost budget"],
      ["Monitor Group", "monitor group"],
      ["External MCP Server", "external MCP server"],
      ["Scheduled Maintenance Template", "scheduled maintenance template"],
    ] as const) {
      expect(
        getRequiredUniqueNameTakenRefusal({
          kindLabel: label,
          name: "X",
          isArchived: false,
        }),
      ).toBe(
        `Another ${word} in this project is already called X, and the project requires unique names. Pick another name.`,
      );
    }
  });

  test("writes the name as it reads: every run of white space one space, none around it", () => {
    expect(
      getRequiredUniqueNameTakenRefusal({
        kindLabel: "Monitor",
        name: `  API${NO_BREAK_SPACE}  Health\tCheck `,
        isArchived: false,
      }),
    ).toBe(
      "Another monitor in this project is already called API Health Check, and the project requires unique names. Pick another name.",
    );
  });

  test("an archived record's says it can be brought back", () => {
    expect(
      getRequiredUniqueNameTakenRefusal({
        kindLabel: "Monitor",
        name: "API Health Check",
        isArchived: true,
      }),
    ).toBe(
      "An archived monitor in this project is already called API Health Check, and the project requires unique names. Unarchive it, or pick another name.",
    );
  });

  test("one update that would give several records one name", () => {
    expect(REQUIRED_UNIQUE_NAMES_RENAMED_TOGETHER_REFUSAL).toBe(
      "One update cannot give several records of one kind the same name while the project requires unique names. Rename them one at a time.",
    );
  });

  test("each is a sentence: a capital first, a full stop last", () => {
    for (const sentence of [
      getRequiredUniqueNameTakenRefusal({
        kindLabel: "Monitor",
        name: "x",
        isArchived: false,
      }),
      getRequiredUniqueNameTakenRefusal({
        kindLabel: "Monitor",
        name: "x",
        isArchived: true,
      }),
      REQUIRED_UNIQUE_NAMES_RENAMED_TOGETHER_REFUSAL,
    ]) {
      expect(sentence.charAt(0)).toBe(sentence.charAt(0).toUpperCase());
      expect(sentence.endsWith(".")).toBe(true);
    }
  });

  test("is one of the name refusals a form says under its Name field", () => {
    expect(NAME_TAKEN_REFUSALS).toContain(REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL);
    expect(NAME_TAKEN_REFUSALS).toContain(
      ARCHIVED_REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL,
    );

    for (const message of [
      getRequiredUniqueNameTakenRefusal({
        kindLabel: "Monitor",
        name: "API Health Check",
        isArchived: false,
      }),
      getRequiredUniqueNameTakenRefusal({
        kindLabel: "Incident Template",
        name: "Outage",
        isArchived: true,
      }),
      REQUIRED_UNIQUE_NAMES_RENAMED_TOGETHER_REFUSAL,
    ]) {
      expect({ message, owned: isNameTakenRefusal(message) }).toEqual({
        message,
        owned: true,
      });
    }

    // Another kind's words, or a refusal of something else, are not.
    expect(
      isNameTakenRefusal(
        "Another monitor in this project is already called , and the project requires unique names. Pick another name.",
      ),
    ).toBe(false);
    expect(isNameTakenRefusal("Monitor with the same name already exists.")).toBe(
      false,
    );
  });
});

describe("a kind's word, read back as its label", () => {
  test.each([
    ["monitor", "Monitor"],
    ["API key", "API Key"],
    ["on-call policy", "On-Call Policy"],
    ["AI agent", "AI Agent"],
    ["LLM cost budget", "LLM Cost Budget"],
    ["incident template", "Incident Template"],
    ["external MCP server", "External MCP Server"],
    ["  monitor   group ", "Monitor Group"],
    ["OneUptime probe", "OneUptime Probe"],
    ["", ""],
  ])("%j is %j", (word: string, label: string) => {
    expect(getLabelOfSentenceTerm(word)).toBe(label);
  });
});

describe("the refusal, read back by the Dashboard", () => {
  test("reads the kind as its label, said in the middle of the reader's sentence, and the name as written", () => {
    const message: string = getRequiredUniqueNameTakenRefusal({
      kindLabel: "API Key",
      name: "Terraform",
      isArchived: false,
    });

    expect(readRefusalValues(REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL, message)).toEqual(
      {
        kind: translatableTerm("API Key", { inSentence: true }),
        name: "Terraform",
      },
    );
  });

  test("reads a name that holds the sentence's own words whole", () => {
    const name: string =
      "Check, and the project requires unique names. Pick another name";
    const message: string = getRequiredUniqueNameTakenRefusal({
      kindLabel: "Monitor",
      name: name,
      isArchived: false,
    });

    expect(readRefusalValues(REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL, message)).toEqual(
      {
        kind: translatableTerm("Monitor", { inSentence: true }),
        name: name,
      },
    );
  });

  test("never reads one refusal as another's", () => {
    const refusals: Array<RefusalWithValues> = [
      REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL,
      ARCHIVED_REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL,
    ];

    for (const isArchived of [false, true]) {
      const message: string = getRequiredUniqueNameTakenRefusal({
        kindLabel: "Monitor",
        name: "Primary",
        isArchived: isArchived,
      });

      for (const refusal of NAME_TAKEN_REFUSALS) {
        const isOwn: boolean = refusal === refusals[isArchived ? 1 : 0];

        expect({
          template: refusal.template,
          read: readRefusalValues(refusal, message) !== null,
        }).toEqual({ template: refusal.template, read: isOwn });
      }
    }
  });

  test("said again in English, it is the server's sentence word for word", () => {
    for (const isArchived of [false, true]) {
      const message: string = getRequiredUniqueNameTakenRefusal({
        kindLabel: "Incident Template",
        name: "Outage",
        isArchived: isArchived,
      });
      const refusal: RefusalWithValues = isArchived
        ? ARCHIVED_REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL
        : REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL;

      expect(
        fillTemplate(refusal.template, readRefusalValues(refusal, message)!),
      ).toBe(message);
      expect(
        createTranslator(undefined, "en").translateTemplate(
          refusal.template,
          readRefusalValues(refusal, message)!,
        ),
      ).toBe(message);
    }
  });

  test("said in another language, the kind is the reader's word for it", () => {
    const message: string = getRequiredUniqueNameTakenRefusal({
      kindLabel: "Monitor",
      name: "API Health Check",
      isArchived: false,
    });

    const german: Record<string, string> = {
      [REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL.template]:
        "In diesem Projekt heißt bereits ein anderes Objekt vom Typ {{kind}} {{name}}, und das Projekt verlangt eindeutige Namen. Wähle einen anderen Namen.",
      Monitor: "Überwachung",
    };

    const said: string = createTranslator((text: string) => {
      return german[text];
    }, "de").translateTemplate(
      REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL.template,
      readRefusalValues(REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL, message)!,
    );

    expect(said).toContain("Überwachung");
    expect(said).toContain("API Health Check");
    expect(said).not.toContain("monitor");
  });
});

describe("the answer a refused write carries beside the words", () => {
  test("a record in service's code, and the id of a record the caller may read", () => {
    const error: NameTakenException = new NameTakenException("Taken.", {
      isArchived: false,
      id: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
    });

    expect(getErrorDetails(error)).toEqual({
      [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE,
      [TAKEN_BY_ID_FIELD]: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
    });
    expect(TAKEN_BY_ID_FIELD).toBe("takenById");
  });

  test("an archived record's code; no id for a record the caller may not read", () => {
    const error: NameTakenException = new NameTakenException("Taken.", {
      isArchived: true,
    });

    expect(getErrorDetails(error)).toEqual({
      [REFUSAL_CODE_FIELD]: NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    });
    expect(error.isTakenByArchived).toBe(true);
  });

  test("a refusal from before keeps its answer as it was: the code alone", () => {
    expect(getErrorDetails(new NameTakenException("Taken."))).toEqual({
      [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE,
    });
  });
});
