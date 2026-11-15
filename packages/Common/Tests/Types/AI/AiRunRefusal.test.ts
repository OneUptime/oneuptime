import { describe, expect, test } from "@jest/globals";
import {
  AI_RUN_REFUSAL_CODE_FIELD,
  AI_RUN_REFUSALS,
  AiRunRefusalCode,
  getAiRunRefusalMessage,
  getInvestigationRunningRefusal,
  getNoInvestigationRefusal,
  getNotAllowedRefusal,
  getRecordAiTokenLimitRefusal,
  getRecordNotFoundRefusal,
  isAiRunRefusalCode,
  readAiRunRefusalCode,
} from "../../../Types/AI/AiRunRefusal";
import ProjectAiDailyLimits from "../../../Types/AI/ProjectAiDailyLimits";
import {
  getRecordAiTokenLimitMessage,
  RECORD_AI_TOKEN_LIMIT_KINDS,
  RecordAiTokenLimitKind,
} from "../../../Types/AI/RecordAiTokenLimit";
import AiRunRefusalException from "../../../Types/Exception/AiRunRefusalException";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadDataExceptionWithDetails from "../../../Types/Exception/BadDataExceptionWithDetails";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../Utils/Project/ProjectBalance";

/*
 * WHY ONEUPTIME AI DID NOT START A RUN, AS A CODE AND A SENTENCE (#7359).
 *
 * Try again and Investigate now are refused with a code beside the English
 * sentence, and the Dashboard words the code. Each code has one sentence,
 * which is also the Dashboard's key: the sentences other messages share
 * are held to those messages here, so a reword of either side fails until
 * both say the same - and every language words it again.
 */

const CODES: ReadonlyArray<AiRunRefusalCode> = Object.values(AiRunRefusalCode);

describe("each refusal code and its sentence", () => {
  test("every code has a sentence of its own, and no two codes share one", () => {
    expect(Object.keys(AI_RUN_REFUSALS).sort()).toEqual([...CODES].sort());

    const sentences: Array<string> = CODES.map(
      (code: AiRunRefusalCode): string => {
        return AI_RUN_REFUSALS[code];
      },
    );

    expect(new Set(sentences).size).toBe(sentences.length);
  });

  test.each(CODES)(
    "%s: a whole sentence, with no value to fill in and no AI provider",
    (code: AiRunRefusalCode) => {
      const sentence: string = getAiRunRefusalMessage(code);

      expect(sentence).toBe(AI_RUN_REFUSALS[code]);
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence).not.toMatch(/\{\{|\$\{/);
      // The setting is LLM Providers (#6738).
      expect(sentence).not.toMatch(/\bAI providers?\b/i);
    },
  );

  test("codes are snake_case words, as the server sends them", () => {
    for (const code of CODES) {
      expect(code).toMatch(/^[a-z]+(?:_[a-z]+)+$/);
    }
  });
});

describe("the sentences other messages share are those messages, word for word", () => {
  test("AI credits used up: PROJECT_AI_CREDITS_USED_UP_MESSAGE", () => {
    expect(AI_RUN_REFUSALS[AiRunRefusalCode.AiCreditsUsedUp]).toBe(
      PROJECT_AI_CREDITS_USED_UP_MESSAGE,
    );
  });

  test("the project's daily AI limit: what stopped it, then who can change the limits and where", () => {
    expect(AI_RUN_REFUSALS[AiRunRefusalCode.ProjectDailyLimitReached]).toBe(
      `The project reached its daily AI limit. OneUptime AI starts again at midnight UTC. ${ProjectAiDailyLimits.getWhoCanChangeSentence()}`,
    );
  });

  test.each(
    RECORD_AI_TOKEN_LIMIT_KINDS.flatMap((kind: RecordAiTokenLimitKind) => {
      return [
        { kind, limitInTokens: 0 },
        { kind, limitInTokens: -3 },
        { kind, limitInTokens: 500 },
        { kind, limitInTokens: null },
      ];
    }),
  )(
    "$kind, limit $limitInTokens: the record's own token limit says what the AI card says",
    (data: { kind: RecordAiTokenLimitKind; limitInTokens: number | null }) => {
      const code: AiRunRefusalCode = getRecordAiTokenLimitRefusal(data.kind, {
        limitInTokens: data.limitInTokens,
      });

      expect(AI_RUN_REFUSALS[code]).toBe(
        getRecordAiTokenLimitMessage(data.kind, {
          limitInTokens: data.limitInTokens,
        }),
      );
      expect(code.startsWith(data.kind)).toBe(true);
      expect(code.endsWith("_paused")).toBe(
        data.limitInTokens !== null && data.limitInTokens <= 0,
      );
    },
  );

  test("a token limit that could not be read back is taken as used up, as the card takes it", () => {
    expect(getRecordAiTokenLimitRefusal("incident")).toBe(
      AiRunRefusalCode.IncidentTokenLimitUsedUp,
    );
    expect(getRecordAiTokenLimitRefusal("alert", null)).toBe(
      AiRunRefusalCode.AlertTokenLimitUsedUp,
    );
    expect(AI_RUN_REFUSALS[AiRunRefusalCode.AlertTokenLimitUsedUp]).toBe(
      getRecordAiTokenLimitMessage("alert"),
    );
  });
});

describe("each record and each button has its own sentence", () => {
  test("incident and alert, never one sentence with the noun filled in", () => {
    expect(getRecordNotFoundRefusal("incident")).toBe(
      AiRunRefusalCode.IncidentNotFound,
    );
    expect(getRecordNotFoundRefusal("alert")).toBe(
      AiRunRefusalCode.AlertNotFound,
    );
    expect(getNoInvestigationRefusal("incident")).toBe(
      AiRunRefusalCode.IncidentHasNoInvestigation,
    );
    expect(getNoInvestigationRefusal("alert")).toBe(
      AiRunRefusalCode.AlertHasNoInvestigation,
    );
    expect(getInvestigationRunningRefusal("incident")).toBe(
      AiRunRefusalCode.IncidentInvestigationRunning,
    );
    expect(getInvestigationRunningRefusal("alert")).toBe(
      AiRunRefusalCode.AlertInvestigationRunning,
    );
    expect(AI_RUN_REFUSALS[AiRunRefusalCode.IncidentInvestigationRunning]).toBe(
      "This incident's investigation is queued or running already.",
    );
    expect(AI_RUN_REFUSALS[AiRunRefusalCode.AlertNotFound]).toBe(
      "Alert not found (or you do not have access to it).",
    );
  });

  test("who may not change the record is told which button they pressed", () => {
    expect(AI_RUN_REFUSALS[getNotAllowedRefusal("incident", "try_again")]).toBe(
      "You do not have permission to change this incident, so you cannot start its investigation again.",
    );
    expect(
      AI_RUN_REFUSALS[getNotAllowedRefusal("alert", "investigate_now")],
    ).toBe(
      "You do not have permission to change this alert, so you cannot start its investigation.",
    );
    expect(getNotAllowedRefusal("alert", "try_again")).toBe(
      AiRunRefusalCode.AlertTryAgainNotAllowed,
    );
    expect(getNotAllowedRefusal("incident", "investigate_now")).toBe(
      AiRunRefusalCode.IncidentInvestigateNowNotAllowed,
    );
  });
});

describe("readAiRunRefusalCode: the code of a refused request's answer", () => {
  test("reads a known code beside the message", () => {
    expect(
      readAiRunRefusalCode({
        message: AI_RUN_REFUSALS[AiRunRefusalCode.AiOff],
        [AI_RUN_REFUSAL_CODE_FIELD]: "ai_off",
      }),
    ).toBe(AiRunRefusalCode.AiOff);
    expect(AI_RUN_REFUSAL_CODE_FIELD).toBe("refusalCode");
  });

  test("an answer without one, or with a code this version does not know, has none: its message is said", () => {
    expect(readAiRunRefusalCode({ message: "Plain bad data." })).toBeNull();
    expect(readAiRunRefusalCode({ refusalCode: "moon_is_full" })).toBeNull();
    expect(readAiRunRefusalCode({ refusalCode: 7 })).toBeNull();
    expect(readAiRunRefusalCode({ refusalCode: null })).toBeNull();
    expect(readAiRunRefusalCode(null)).toBeNull();
    expect(readAiRunRefusalCode(undefined)).toBeNull();
    expect(readAiRunRefusalCode([] as never)).toBeNull();
  });

  test("isAiRunRefusalCode knows every code and nothing else", () => {
    for (const code of CODES) {
      expect(isAiRunRefusalCode(code)).toBe(true);
    }
    expect(isAiRunRefusalCode("AiOff")).toBe(false);
    expect(isAiRunRefusalCode(undefined)).toBe(false);
  });
});

describe("AiRunRefusalException", () => {
  test("is bad data (400) whose message is the sentence and whose details carry the code", () => {
    const error: AiRunRefusalException = new AiRunRefusalException(
      AiRunRefusalCode.NoProviderToInvestigate,
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error).toBeInstanceOf(BadDataExceptionWithDetails);
    expect(error.code).toBe(ExceptionCode.BadDataException);
    expect(error.message).toBe(
      "This project has no LLM provider to investigate with. Add one in Project Settings > AI > LLM Providers, then try again.",
    );
    expect(error.details).toEqual({
      refusalCode: "no_provider_to_investigate",
    });
    expect(error.refusalCode).toBe(AiRunRefusalCode.NoProviderToInvestigate);
  });
});
