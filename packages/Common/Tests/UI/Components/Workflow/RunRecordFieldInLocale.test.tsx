/*
 * The Run Workflow panel's record field when the project has no records yet,
 * in Hindi (#6893). The sentence names the records - घटनाएं for incidents,
 * a feminine plural, मॉनिटर for monitors, a masculine one - and read
 * "अभी तक कोई घटनाएं नहीं है", a singular verb after a plural noun. It now
 * reads "अभी तक {{records}} नहीं हैं", the plural verb either noun takes.
 */

import RunRecordField, {
  RunRecordFieldCopy,
} from "../../../../UI/Components/Workflow/RunRecordField";
import { LoadRunRecordsFunction } from "../../../../UI/Components/Workflow/RunRecordSource";
import ObjectID from "../../../../Types/ObjectID";
import {
  RunRecordEvent,
  RunRecordOption,
  RunRecordTriggerInfo,
} from "../../../../Types/Workflow/RunRecord";
import englishLocale from "../../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import hindiLocale from "../../../../../App/FeatureSet/Dashboard/src/Locales/hi.json";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const NOW: Date = new Date("2026-10-13T12:00:00.000Z");

// The flat keys a sentence is looked up by (the file also holds nested ones).
const HINDI: Record<string, unknown> = hindiLocale as Record<string, unknown>;

function infoFor(
  singularName: string,
  pluralName: string,
): RunRecordTriggerInfo {
  return {
    argument: {
      id: "_id",
      name: `${singularName} ID`,
      description: "",
      required: true,
      type: "Text" as RunRecordTriggerInfo["argument"]["type"],
    },
    event: RunRecordEvent.Created,
    singularName: singularName,
    pluralName: pluralName,
    hasNumber: true,
    hasName: true,
  };
}

let hindi: i18n;

beforeAll(async () => {
  hindi = createInstance();

  await hindi.init({
    lng: "hi",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      hi: { translation: hindiLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function emptyStateFor(info: RunRecordTriggerInfo): Promise<string> {
  const load: LoadRunRecordsFunction = (): Promise<Array<RunRecordOption>> => {
    return Promise.resolve([]);
  };

  render(
    <I18nextProvider i18n={hindi}>
      <RunRecordField
        workflowId={WORKFLOW_ID}
        info={info}
        value=""
        onChange={(): void => {}}
        onRecordChange={(): void => {}}
        load={load}
        now={NOW}
      />
    </I18nextProvider>,
  );

  fireEvent.focus(screen.getByTestId("run-record-field-search"));
  await act(async () => {
    jest.advanceTimersByTime(0);
    await Promise.resolve();
  });

  return screen.getByTestId("run-record-field-empty").textContent || "";
}

describe("a project with no records yet, in Hindi", () => {
  test("the sentence is worded, with a plural verb and nothing that agrees with the records", () => {
    const sentence: unknown = HINDI[RunRecordFieldCopy.noneYet];

    expect(sentence).toBe("इस प्रोजेक्ट में अभी तक {{records}} नहीं हैं।");
  });

  test.each([
    ["Incident", "Incidents", "घटनाएं"],
    ["Monitor", "Monitors", "मॉनिटर"],
  ])(
    "names %s records as the plural they are",
    async (singularName: string, pluralName: string, records: string) => {
      expect(HINDI[pluralName.toLowerCase()]).toBe(records);

      const text: string = await emptyStateFor(
        infoFor(singularName, pluralName),
      );

      expect(text).toBe(`इस प्रोजेक्ट में अभी तक ${records} नहीं हैं।`);
      expect(text).not.toContain(`कोई ${records} नहीं है।`);
      expect(text).not.toContain("There are no");
    },
  );
});
