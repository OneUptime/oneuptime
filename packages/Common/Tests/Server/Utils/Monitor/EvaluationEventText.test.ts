import EvaluationEventText, {
  EvaluationEventTextFields,
} from "../../../../Server/Utils/Monitor/EvaluationEventText";
import EvaluationSentenceMemo from "../../../../Server/Utils/Monitor/EvaluationSentenceMemo";
import MonitorDependencySuppression, {
  SuppressingParent,
} from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  isEvaluationSentence,
  translatableSentence,
  wordEvaluationSentence,
  wordStoredEvaluationText,
} from "../../../../Types/Monitor/EvaluationSentence";
import { createTranslator, Translator } from "../../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

// An evaluation event's title and message, stored for each reader (#6542).

const chinese: Translator = createTranslator((key: string) => {
  return (
    {
      "Incident created: {{title}}": "已创建事件：{{title}}",
      'Incident triggered from criteria "{{criteria}}".':
        "由条件“{{criteria}}”触发的事件。",
      "Unnamed criteria": "未命名条件",
      "parent monitors {{parents}}": "父监视器 {{parents}}",
      '"{{monitor}}" is {{status}}': "“{{monitor}}”为 {{status}}",
      "Skipped creating incidents because {{reason}}. This monitor's status still updates normally; open incidents still auto-resolve.":
        "由于{{reason}}，已跳过创建事件。此监视器的状态仍会正常更新；未解决的事件仍会自动解决。",
    } as Record<string, string>
  )[key];
}, "zh-CN");

function parents(count: number): Array<SuppressingParent> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return {
      monitorId: `parent-${index}`,
      monitorName: `Router ${index}`,
      statusName: index % 2 === 0 ? "Offline" : "Degraded",
    };
  });
}

describe("EvaluationEventText", () => {
  test("stores the title and message as their English and as sentences", () => {
    const fields: EvaluationEventTextFields = EvaluationEventText.from({
      title: translatableSentence("Incident created: {{title}}", {
        title: "Checkout down",
      }),
      message: translatableSentence(
        'Incident triggered from criteria "{{criteria}}".',
        { criteria: EvaluationEventText.criteriaName("Website is down") },
      ),
    });

    expect(fields.title).toBe("Incident created: Checkout down");
    expect(fields.message).toBe(
      'Incident triggered from criteria "Website is down".',
    );
    expect(isEvaluationSentence(fields.titleSentence)).toBe(true);
    expect(isEvaluationSentence(fields.messageSentence)).toBe(true);
    expect(
      wordStoredEvaluationText({
        english: fields.title,
        sentence: fields.titleSentence,
        translator: chinese,
      }),
    ).toBe("已创建事件：Checkout down");
    expect(
      wordStoredEvaluationText({
        english: fields.message!,
        sentence: fields.messageSentence,
        translator: chinese,
      }),
    ).toBe("由条件“Website is down”触发的事件。");
  });

  test("names a criteria without a name in the reader's words", () => {
    const sentence: EvaluationSentence = translatableSentence(
      'Incident triggered from criteria "{{criteria}}".',
      { criteria: EvaluationEventText.criteriaName(undefined) },
    );

    expect(englishOfEvaluationSentence(sentence)).toBe(
      'Incident triggered from criteria "Unnamed criteria".',
    );
    expect(wordEvaluationSentence(sentence, chinese)).toBe(
      "由条件“未命名条件”触发的事件。",
    );
    expect(EvaluationEventText.criteriaName("")).toEqual({
      term: "Unnamed criteria",
    });
  });

  test("a message given as text is stored as it is, with no sentence", () => {
    const fields: EvaluationEventTextFields = EvaluationEventText.from({
      title: translatableSentence("Incident creation failed"),
      message: "Skipped creating incidents because a resource is maintained.",
    });

    expect(fields.message).toBe(
      "Skipped creating incidents because a resource is maintained.",
    );
    expect(fields.messageSentence).toBeUndefined();
  });

  test("a message a checker wrote from a sentence is stored with it", () => {
    const message: string = EvaluationSentenceMemo.write(
      translatableSentence("Request timed out."),
    );

    expect(
      EvaluationEventText.from({
        title: translatableSentence("Incident creation failed"),
        message: message,
      }).messageSentence,
    ).toEqual({ template: "Request timed out." });
  });

  test("an event without a message has none", () => {
    const fields: EvaluationEventTextFields = EvaluationEventText.from({
      title: translatableSentence("Probe Agreement Check"),
    });

    expect(fields).toEqual({
      title: "Probe Agreement Check",
      titleSentence: { template: "Probe Agreement Check" },
    });
  });
});

describe("MonitorDependencySuppression.buildSuppressionReasonSentence", () => {
  test.each([1, 2, 3, 30, 31, 45])(
    "says in English what buildSuppressionReason says, for %i parents",
    (count: number) => {
      const suppressing: Array<SuppressingParent> = parents(count);
      const sentence: EvaluationSentence =
        MonitorDependencySuppression.buildSuppressionReasonSentence(
          suppressing,
        );

      expect(isEvaluationSentence(sentence)).toBe(true);
      expect(englishOfEvaluationSentence(sentence)).toBe(
        MonitorDependencySuppression.buildSuppressionReason(suppressing),
      );
    },
  );

  test("reads in the reader's language, the monitors and statuses as named", () => {
    const sentence: EvaluationSentence = translatableSentence(
      "Skipped creating incidents because {{reason}}. This monitor's status still updates normally; open incidents still auto-resolve.",
      {
        reason: MonitorDependencySuppression.buildSuppressionReasonSentence(
          parents(2),
        ),
      },
    );

    expect(
      wordStoredEvaluationText({
        english: englishOfEvaluationSentence(sentence),
        sentence: sentence,
        translator: chinese,
      }),
    ).toBe(
      "由于父监视器 “Router 0”为 Offline，“Router 1”为 Degraded，已跳过创建事件。此监视器的状态仍会正常更新；未解决的事件仍会自动解决。",
    );
  });
});
