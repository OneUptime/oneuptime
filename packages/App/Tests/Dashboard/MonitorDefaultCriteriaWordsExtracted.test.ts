import {
  ExtractedString,
  scanSourceRoots,
  SOURCE_ROOTS,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  createTranslator,
  TemplateValues,
  Translator,
} from "Common/Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * A new monitor's default criteria - each criteria's name and description,
 * and the title and description of every incident and alert it opens - are
 * written in the language of the person creating the monitor (#6542): each
 * sentence the builders look up is a key of the Dashboard's locale files.
 *
 * A sentence the extractor missed would never reach en.json, so no language
 * could word it, and every reader would get it in English. So this holds
 * the extractor to every sentence the builders look up, for every monitor
 * type - and to nothing else in the file: its filter values, keywords and
 * ids are not words to translate.
 */

const FILE: string = "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts";

const getRoot: () => SourceRoot = (): SourceRoot => {
  const root: SourceRoot | undefined = SOURCE_ROOTS.find(
    (candidate: SourceRoot): boolean => {
      return candidate.directory === FILE;
    },
  );

  if (!root) {
    throw new Error(`${FILE} is not a source root`);
  }

  return root;
};

const getExtracted: () => Array<string> = (): Array<string> => {
  return scanSourceRoots([getRoot()]).strings.map(
    (entry: ExtractedString): string => {
      return entry.text;
    },
  );
};

// Every sentence the builders look up, for every monitor type.
const getLookedUp: () => Set<string> = (): Set<string> => {
  const templates: Set<string> = new Set<string>();
  const english: Translator = createTranslator(undefined, "en");
  const recording: Translator = {
    ...english,
    translateTemplate: (template: string, values?: TemplateValues): string => {
      templates.add(template);
      return english.translateTemplate(template, values);
    },
  };

  for (const monitorType of Object.values(MonitorType) as Array<MonitorType>) {
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType,
      monitorName: "Acme Checkout",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      warningAlertSeverityId: ObjectID.generate(),
      translator: recording,
    });
  }

  return templates;
};

describe("a new monitor's default criteria words, in the locale files", () => {
  test("the builders' file is read for its marked sentences only", () => {
    expect(getRoot().kind).toBe("keys");
  });

  test("every sentence the builders look up, for every monitor type, is extracted", () => {
    const extracted: Set<string> = new Set<string>(getExtracted());
    const lookedUp: Set<string> = getLookedUp();

    // The builders do look sentences up: a translator handed in is used.
    expect(lookedUp.size).toBeGreaterThan(50);

    expect(
      [...lookedUp].filter((template: string): boolean => {
        return !extracted.has(template);
      }),
    ).toEqual([]);
  });

  test("nothing else in the file is extracted", () => {
    const lookedUp: Set<string> = getLookedUp();

    expect(
      getExtracted().filter((text: string): boolean => {
        return !lookedUp.has(text);
      }),
    ).toEqual([]);
  });
});
