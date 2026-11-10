import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

/*
 * The words a new monitor's out-of-the-box criteria are written with: each
 * criteria's name and description, and the title and description of every
 * incident and alert it opens. Once saved they are the project's own text,
 * which its people edit like anything they typed.
 *
 * Fixtures/MonitorDefaultCriteriaWords.en.json holds them for every monitor
 * type, for a monitor named "Acme Checkout", exactly as the builders wrote
 * them before they could be written in a reader's language (#6542). A caller
 * with no reader - the server, the API, a monitor made from a template - must
 * still get exactly those, byte for byte.
 */

const MONITOR_NAME: string = "Acme Checkout";

interface OpenedWords {
  title: string;
  description: string;
}

interface CriteriaWords {
  name: string;
  description: string;
  incidents: Array<OpenedWords>;
  alerts: Array<OpenedWords>;
}

type WordsByMonitorType = Record<string, Array<CriteriaWords>>;

const ENGLISH: WordsByMonitorType = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "Fixtures",
      "MonitorDefaultCriteriaWords.en.json",
    ),
    "utf8",
  ),
) as WordsByMonitorType;

const MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

const SEED_IDS: {
  defaultMonitorStatusId: ObjectID;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  warningAlertSeverityId: ObjectID;
} = {
  defaultMonitorStatusId: new ObjectID("10000000-0000-4000-8000-000000000001"),
  onlineMonitorStatusId: new ObjectID("10000000-0000-4000-8000-000000000001"),
  offlineMonitorStatusId: new ObjectID("10000000-0000-4000-8000-000000000002"),
  defaultIncidentSeverityId: new ObjectID(
    "10000000-0000-4000-8000-000000000003",
  ),
  defaultAlertSeverityId: new ObjectID("10000000-0000-4000-8000-000000000004"),
  warningAlertSeverityId: new ObjectID("10000000-0000-4000-8000-000000000005"),
};

const openedWords: (opened: CriteriaIncident | CriteriaAlert) => OpenedWords = (
  opened: CriteriaIncident | CriteriaAlert,
): OpenedWords => {
  return { title: opened.title, description: opened.description };
};

const wordsOfCriteria: (
  monitorCriteria: MonitorCriteria,
) => Array<CriteriaWords> = (
  monitorCriteria: MonitorCriteria,
): Array<CriteriaWords> => {
  return (monitorCriteria.data?.monitorCriteriaInstanceArray || []).map(
    (instance: MonitorCriteriaInstance): CriteriaWords => {
      return {
        name: instance.data!.name,
        description: instance.data!.description,
        incidents: (instance.data!.incidents || []).map(openedWords),
        alerts: (instance.data!.alerts || []).map(openedWords),
      };
    },
  );
};

const wordsOfSteps: (monitorSteps: MonitorSteps) => Array<CriteriaWords> = (
  monitorSteps: MonitorSteps,
): Array<CriteriaWords> => {
  return wordsOfCriteria(
    monitorSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria,
  );
};

const defaultSteps: (data: {
  monitorType: MonitorType;
  monitorName?: string | undefined;
}) => MonitorSteps = (data: {
  monitorType: MonitorType;
  monitorName?: string | undefined;
}): MonitorSteps => {
  return MonitorSteps.getDefaultMonitorSteps({
    ...SEED_IDS,
    monitorType: data.monitorType,
    monitorName: data.monitorName ?? MONITOR_NAME,
  });
};

// The fixture's words with the monitor's name swapped for another, as written.
const englishFor: (
  monitorType: MonitorType,
  monitorName: string,
) => Array<CriteriaWords> = (
  monitorType: MonitorType,
  monitorName: string,
): Array<CriteriaWords> => {
  const named: (text: string) => string = (text: string): string => {
    return text.split(MONITOR_NAME).join(monitorName);
  };
  const namedOpened: (opened: OpenedWords) => OpenedWords = (
    opened: OpenedWords,
  ): OpenedWords => {
    return {
      title: named(opened.title),
      description: named(opened.description),
    };
  };

  return (ENGLISH[monitorType] || []).map(
    (criteria: CriteriaWords): CriteriaWords => {
      return {
        name: named(criteria.name),
        description: named(criteria.description),
        incidents: criteria.incidents.map(namedOpened),
        alerts: criteria.alerts.map(namedOpened),
      };
    },
  );
};

describe("a new monitor's default criteria, written with no reader", () => {
  test("the fixture holds every monitor type, and nothing else", () => {
    expect(Object.keys(ENGLISH).sort()).toEqual([...MONITOR_TYPES].sort());
  });

  test.each(MONITOR_TYPES)(
    "%s: every name, description, title and description reads in English, exactly as before",
    (monitorType: MonitorType) => {
      expect(wordsOfSteps(defaultSteps({ monitorType }))).toEqual(
        ENGLISH[monitorType],
      );
    },
  );

  test.each(MONITOR_TYPES)(
    "%s: a step and the criteria on their own read the same as the steps",
    (monitorType: MonitorType) => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        ...SEED_IDS,
        monitorType,
        monitorName: MONITOR_NAME,
      });
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          ...SEED_IDS,
          monitorType,
          monitorName: MONITOR_NAME,
        });

      expect(wordsOfCriteria(step.data!.monitorCriteria)).toEqual(
        ENGLISH[monitorType],
      );
      expect(wordsOfCriteria(criteria)).toEqual(ENGLISH[monitorType]);
    },
  );

  /*
   * The name goes in as it is written: never read as a placeholder, a
   * replacement pattern ("$&") or a translation call ("$t("), and an empty
   * name - a new monitor not named yet - leaves the sentence around it.
   */
  test.each([
    "Shop $& {{monitorName}} $t(key) 100%",
    "{{days}} {{percent}} {{keyword}} {{disconnectedProbeNames}}",
    "  padded  ",
    "",
  ])("the monitor's name %j goes in as written", (monitorName: string) => {
    for (const monitorType of MONITOR_TYPES) {
      expect({
        monitorType,
        words: wordsOfSteps(defaultSteps({ monitorType, monitorName })),
      }).toEqual({ monitorType, words: englishFor(monitorType, monitorName) });
    }
  });

  test("no default writes remediation notes", () => {
    for (const monitorType of MONITOR_TYPES) {
      const instances: Array<MonitorCriteriaInstance> = defaultSteps({
        monitorType,
      }).data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!
        .monitorCriteriaInstanceArray;

      for (const instance of instances) {
        for (const opened of [
          ...(instance.data!.incidents || []),
          ...(instance.data!.alerts || []),
        ]) {
          expect(opened.remediationNotes).toBeUndefined();
        }
      }
    }
  });
});
