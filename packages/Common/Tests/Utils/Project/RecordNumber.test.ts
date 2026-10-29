import {
  NUMBER_WITH_PREFIX_SUFFIX,
  RecordNumberColumns,
  formatRecordNumber,
  getNumberedRecordName,
  getRecordNumber,
  getRecordNumberColumns,
} from "../../../Utils/Project/RecordNumber";
import NumberPrefixUtil from "../../../Utils/Project/NumberPrefix";
import { formatRunRecordNumber } from "../../../Types/Workflow/RunRecord";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { describe, expect, test } from "@jest/globals";

/*
 * RecordNumber is the one rule for the number a record is known by: which
 * columns number a model's records, how a number is shown, and how it is
 * put before a record's name. The page heading, the trail and the browser
 * tab (ModelPage), the dialogs that name a record (getRecordDisplayName),
 * Cmd+K's results and Ask AI's page context all read it, so an incident is
 * "INC-18 Manually declared" in every one of them.
 */

const NUMBERED: Array<[string, BaseModel, RecordNumberColumns]> = [
  [
    "Incident",
    new Incident(),
    {
      numberColumn: "incidentNumber",
      numberWithPrefixColumn: "incidentNumberWithPrefix",
    },
  ],
  [
    "Alert",
    new Alert(),
    {
      numberColumn: "alertNumber",
      numberWithPrefixColumn: "alertNumberWithPrefix",
    },
  ],
  [
    "ScheduledMaintenance",
    new ScheduledMaintenance(),
    {
      numberColumn: "scheduledMaintenanceNumber",
      numberWithPrefixColumn: "scheduledMaintenanceNumberWithPrefix",
    },
  ],
  [
    "IncidentEpisode",
    new IncidentEpisode(),
    {
      numberColumn: "episodeNumber",
      numberWithPrefixColumn: "episodeNumberWithPrefix",
    },
  ],
  [
    "AlertEpisode",
    new AlertEpisode(),
    {
      numberColumn: "episodeNumber",
      numberWithPrefixColumn: "episodeNumberWithPrefix",
    },
  ],
  [
    "SecurityCase",
    new SecurityCase(),
    {
      numberColumn: "caseNumber",
      numberWithPrefixColumn: "caseNumberWithPrefix",
    },
  ],
];

describe("getRecordNumberColumns - which columns number a model's records", () => {
  test.each(NUMBERED)(
    "%s numbers its records",
    (_name: string, model: BaseModel, columns: RecordNumberColumns) => {
      expect(getRecordNumberColumns(model)).toEqual(columns);
    },
  );

  test("the number with its prefix sits beside the number, named after it", () => {
    for (const [, model] of NUMBERED) {
      const columns: RecordNumberColumns = getRecordNumberColumns(model)!;
      expect(columns.numberWithPrefixColumn).toBe(
        `${columns.numberColumn}${NUMBER_WITH_PREFIX_SUFFIX}`,
      );
    }
  });

  test("a model that does not number its records has none", () => {
    expect(getRecordNumberColumns(new Monitor())).toBeNull();
    expect(getRecordNumberColumns(new StatusPage())).toBeNull();
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "Incident"],
    ["a number", 18],
    ["a plain object", { incidentNumber: 18 }],
    ["an array", [new Incident()]],
  ])(
    "%s is no model, and numbers nothing",
    (_name: string, value: unknown) => {
      expect(getRecordNumberColumns(value)).toBeNull();
    },
  );

  test("any record of a model gets its model's columns, read once per model", () => {
    const first: RecordNumberColumns | null = getRecordNumberColumns(
      new Incident(),
    );
    const second: RecordNumberColumns | null = getRecordNumberColumns(
      new Incident(),
    );

    expect(second).toBe(first);
  });

  test("the answer is shared, so nobody may change it", () => {
    const columns: RecordNumberColumns = getRecordNumberColumns(
      new Alert(),
    )!;

    expect(Object.isFrozen(columns)).toBe(true);
    expect(() => {
      (columns as { numberColumn: string }).numberColumn = "title";
    }).toThrow();
    expect(getRecordNumberColumns(new Alert())!.numberColumn).toBe(
      "alertNumber",
    );
  });
});

describe("formatRecordNumber - the number as it is shown", () => {
  test("as stored, with the prefix it was numbered with", () => {
    expect(
      formatRecordNumber({ number: 18, numberWithPrefix: "INC-18" }),
    ).toBe("INC-18");
    // A prefix the project chose: kept exactly.
    expect(
      formatRecordNumber({ number: 7, numberWithPrefix: "OPS/ALT:7" }),
    ).toBe("OPS/ALT:7");
  });

  test("a record keeps its prefix after the project changes it", () => {
    // Numbered when the prefix was INC-; the project's prefix is SEV- now.
    expect(
      formatRecordNumber({ number: 18, numberWithPrefix: "INC-18" }),
    ).toBe("INC-18");
  });

  test("surrounding spaces are not part of it", () => {
    expect(
      formatRecordNumber({ number: 18, numberWithPrefix: "  INC-18 " }),
    ).toBe("INC-18");
  });

  test("a record numbered before numbers kept their prefix reads #18", () => {
    expect(formatRecordNumber({ number: 18, numberWithPrefix: null })).toBe(
      "#18",
    );
    expect(
      formatRecordNumber({ number: 18, numberWithPrefix: undefined }),
    ).toBe("#18");
    expect(formatRecordNumber({ number: 18, numberWithPrefix: "  " })).toBe(
      "#18",
    );
    // The project's default prefix, as the server writes it.
    expect(formatRecordNumber({ number: 18, numberWithPrefix: null })).toBe(
      NumberPrefixUtil.formatNumber(null, 18),
    );
  });

  test.each([
    ["no number", null, null],
    ["nothing", undefined, undefined],
    ["a number that is not one", Number.NaN, undefined],
    ["text where the number goes", "18", null],
    ["something else", { value: 18 }, null],
  ])(
    "%s is no number",
    (_name: string, number: unknown, numberWithPrefix: unknown) => {
      expect(formatRecordNumber({ number, numberWithPrefix })).toBeUndefined();
    },
  );

  test("Run Workflow's records are numbered by the same rule", () => {
    const cases: Array<{ number: unknown; numberWithPrefix: unknown }> = [
      { number: 8, numberWithPrefix: "INC-8" },
      { number: 8, numberWithPrefix: " " },
      { number: 8, numberWithPrefix: null },
      { number: null, numberWithPrefix: null },
      { number: Number.NaN, numberWithPrefix: undefined },
    ];

    for (const data of cases) {
      expect(formatRunRecordNumber(data)).toBe(formatRecordNumber(data));
    }
  });
});

describe("getRecordNumber - one record's number, read from its model's columns", () => {
  const incidentColumns: RecordNumberColumns = getRecordNumberColumns(
    new Incident(),
  )!;

  test("from a record read from the API", () => {
    const incident: Incident = new Incident();
    incident.incidentNumber = 18;
    incident.incidentNumberWithPrefix = "INC-18";

    expect(getRecordNumber(incident, incidentColumns)).toBe("INC-18");
  });

  test("from a row as JSON", () => {
    expect(
      getRecordNumber(
        { incidentNumber: 18, incidentNumberWithPrefix: "INC-18" },
        incidentColumns,
      ),
    ).toBe("INC-18");
    expect(getRecordNumber({ incidentNumber: 18 }, incidentColumns)).toBe(
      "#18",
    );
  });

  test("an episode's number is read from the episode's own columns", () => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.episodeNumber = 3;
    episode.episodeNumberWithPrefix = "IE-3";

    expect(
      getRecordNumber(episode, getRecordNumberColumns(new IncidentEpisode())),
    ).toBe("IE-3");
  });

  test("nothing when the record does not carry its number", () => {
    const incident: Incident = new Incident();
    incident.title = "Manually declared";

    expect(getRecordNumber(incident, incidentColumns)).toBeUndefined();
  });

  test("nothing for a model without numbers, or no record", () => {
    expect(getRecordNumber({ incidentNumber: 18 }, null)).toBeUndefined();
    expect(getRecordNumber({ incidentNumber: 18 }, undefined)).toBeUndefined();
    expect(getRecordNumber(null, incidentColumns)).toBeUndefined();
    expect(getRecordNumber("INC-18", incidentColumns)).toBeUndefined();
  });
});

describe("getNumberedRecordName - the number, then the name, in one line", () => {
  test("INC-18 Manually declared", () => {
    expect(
      getNumberedRecordName({ number: "INC-18", name: "Manually declared" }),
    ).toBe("INC-18 Manually declared");
  });

  test("two records of one name read differently", () => {
    expect(
      getNumberedRecordName({ number: "INC-17", name: "Manually declared" }),
    ).not.toBe(
      getNumberedRecordName({ number: "INC-18", name: "Manually declared" }),
    );
  });

  test("the name alone without a number, as before", () => {
    expect(
      getNumberedRecordName({ number: undefined, name: "Manually declared" }),
    ).toBe("Manually declared");
    expect(
      getNumberedRecordName({ number: "  ", name: "Manually declared" }),
    ).toBe("Manually declared");
  });

  test("the number alone without a name", () => {
    expect(getNumberedRecordName({ number: "INC-18", name: null })).toBe(
      "INC-18",
    );
    expect(getNumberedRecordName({ number: "INC-18", name: " " })).toBe(
      "INC-18",
    );
  });

  test("nothing from nothing", () => {
    expect(getNumberedRecordName({ number: null, name: undefined })).toBe("");
  });

  test("the name is kept as written, its edges trimmed", () => {
    expect(
      getNumberedRecordName({
        number: "#7",
        name: "  Payments: 5xx > 5% (EU) ",
      }),
    ).toBe("#7 Payments: 5xx > 5% (EU)");
  });
});
