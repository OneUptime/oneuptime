// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import {
  DateTimeFieldFinding,
  DateTimeFieldSite,
  DateTimeFieldSiteKind,
  RAW_DATE_TIME_INPUT_FILES,
  REPOSITORY_ROOT,
  SECONDS_OPT_IN_FILES,
  SHARED_INPUT_FILE,
  disallowedDateTimeFields,
  findDateTimeFieldSites,
  formatDateTimeFieldFindings,
  listDateTimeFieldScanFiles,
  scanDateTimeFields,
} from "../MinutePickers";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #7593: the date and time pickers people schedule on-call shifts with
 * showed and asked for seconds - Add User Override's Starts read
 * "13/11/2026 11:15:52", and a layer's Rotation starts at "11/11/2026
 * 08:00:17" with a seconds column in the browser's picker. The shared Input
 * drew every datetime-local value with its seconds.
 *
 * A date and time field people fill in now shows and keeps hours and
 * minutes, and this guard holds every field in the product to it: it reads
 * every browser module (each feature set's src, Common/UI, and ee/Dashboard
 * and ee/AdminDashboard when the checkout has ee/), and fails on an opt-in to
 * seconds with no reason listed, on a datetime-local input of its own that
 * does not say how it keeps to the minute, and on a value to the second
 * anywhere but the shared Input. The detector (Common/Tests/MinutePickers.ts)
 * is pinned on snippets first - every spelling it must catch, and what it
 * must leave alone - and only then run over the tree, with checks that the
 * walk really read it.
 */

function sitesIn(
  source: string,
  fileName: string = "Fixture.tsx",
): Array<string> {
  return findDateTimeFieldSites(fileName, source).map(
    (site: DateTimeFieldSite): string => {
      return `${site.kind} @${site.line}: ${site.text}`;
    },
  );
}

function kindsIn(
  source: string,
  fileName: string = "Fixture.tsx",
): Array<DateTimeFieldSiteKind> {
  return findDateTimeFieldSites(fileName, source).map(
    (site: DateTimeFieldSite): DateTimeFieldSiteKind => {
      return site.kind;
    },
  );
}

describe("the detector finds every way a field can show or ask for seconds", () => {
  test("the telemetry range's opt-in, as CustomTimeRangeModal writes it", () => {
    expect(
      sitesIn(
        [
          "<Input",
          "  type={InputType.DATETIME_LOCAL}",
          "  showSecondsForDateTime={true}",
          "/>",
        ].join("\n"),
      ),
    ).toEqual([
      `${DateTimeFieldSiteKind.SecondsOptIn} @3: showSecondsForDateTime={true}`,
    ]);
  });

  test.each([
    ["written bare", "<Input showSecondsForDateTime />"],
    [
      "from a condition",
      "<Input showSecondsForDateTime={props.type === StartAndEndDateType.DateTime} />",
    ],
    ["from a prop", "<Input showSecondsForDateTime={props.withSeconds} />"],
    [
      "in a props object",
      "const inputProps = { showSecondsForDateTime: true };",
    ],
    [
      "in a props object, quoted",
      'const inputProps = { "showSecondsForDateTime": true };',
    ],
    [
      "in a props object, by shorthand",
      "const showSecondsForDateTime = true; f({ showSecondsForDateTime });",
    ],
  ])("an opt-in %s", (_name: string, source: string) => {
    expect(kindsIn(source)).toEqual([DateTimeFieldSiteKind.SecondsOptIn]);
  });

  test("a browser datetime-local input of its own, self-closing or not", () => {
    expect(
      kindsIn(
        [
          '<input type="datetime-local" value={value} onChange={onChange} />;',
          "<input type={'datetime-local'} value={value}></input>;",
        ].join("\n"),
      ),
    ).toEqual([
      DateTimeFieldSiteKind.RawDateTimeInput,
      DateTimeFieldSiteKind.RawDateTimeInput,
    ]);
  });

  test("a browser datetime-local input that steps by seconds is an opt-in too", () => {
    expect(
      sitesIn('<input type="datetime-local" step="1" value={value} />'),
    ).toEqual([
      `${DateTimeFieldSiteKind.RawDateTimeInput} @1: <input type="datetime-local" step="1" value={value} />`,
      `${DateTimeFieldSiteKind.RawDateTimeInputStep} @1: step="1"`,
    ]);
  });

  test.each([
    ["the Date helper", "const v = OneUptimeDate.toDateTimeLocalString(date);"],
    [
      "in a field's value",
      "<input value={OneUptimeDate.toDateTimeLocalString(at)} />",
    ],
    ["through a cast", "(OneUptimeDate as any).toDateTimeLocalString(at);"],
  ])("a value to the second: %s", (_name: string, source: string) => {
    expect(kindsIn(source)).toEqual([DateTimeFieldSiteKind.SecondsValue]);
  });
});

describe("the detector leaves alone what keeps to the minute", () => {
  test.each([
    ["an opt-in turned off", "<Input showSecondsForDateTime={false} />"],
    [
      "an opt-in turned off in a props object",
      "const p = { showSecondsForDateTime: false };",
    ],
    [
      "the shared Input's own prop, read",
      "const step = props.showSecondsForDateTime ? '1' : undefined;",
    ],
    [
      "the prop's declaration",
      "interface P { showSecondsForDateTime?: boolean | undefined; }",
    ],
    [
      "a comment that names it",
      "// showSecondsForDateTime={true} shows a seconds column",
    ],
    [
      "a block comment",
      '/* <input type="datetime-local" step="1" /> and OneUptimeDate.toDateTimeLocalString(x) */',
    ],
    ["a string", 'const why = "showSecondsForDateTime={true}";'],
    ["the minute value", "OneUptimeDate.toDateTimeLocalMinuteString(date);"],
    [
      "the shared Input, which shows minutes",
      "<Input type={InputType.DATETIME_LOCAL} value={at} />",
    ],
    ["a date input", '<input type="date" value={day} />'],
    ["a time input", '<input type="time" step="60" value={clock} />'],
    ["a text input with a step", '<input type="text" step="1" />'],
    [
      "a component of its own named like it",
      '<DateInput type="datetime-local" />',
    ],
    [
      "the type a field asks for, as FormField returns it",
      'case FormFieldSchemaType.DateTime: return "datetime-local";',
    ],
    [
      "an input type named in a map",
      'const masked = { "datetime-local": true };',
    ],
  ])("%s", (_name: string, source: string) => {
    expect(sitesIn(source)).toEqual([]);
  });
});

describe("the allowed files", () => {
  test("an opt-in or a stepping input needs a reason; a raw input needs to say how it keeps to the minute", () => {
    const optIn: DateTimeFieldFinding = {
      file: Object.keys(SECONDS_OPT_IN_FILES)[0]!,
      line: 1,
      kind: DateTimeFieldSiteKind.SecondsOptIn,
      text: "showSecondsForDateTime={true}",
    };
    const raw: DateTimeFieldFinding = {
      file: Object.keys(RAW_DATE_TIME_INPUT_FILES)[0]!,
      line: 2,
      kind: DateTimeFieldSiteKind.RawDateTimeInput,
      text: '<input type="datetime-local" />',
    };
    const value: DateTimeFieldFinding = {
      file: SHARED_INPUT_FILE,
      line: 3,
      kind: DateTimeFieldSiteKind.SecondsValue,
      text: "OneUptimeDate.toDateTimeLocalString(date)",
    };
    const unlistedOptIn: DateTimeFieldFinding = {
      ...optIn,
      file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerDateTimeFieldElement.tsx",
    };
    // A raw input's file says how it keeps to the minute, not why it steps by seconds.
    const steppingRawInput: DateTimeFieldFinding = {
      ...raw,
      kind: DateTimeFieldSiteKind.RawDateTimeInputStep,
      text: 'step="1"',
    };
    const unlistedRaw: DateTimeFieldFinding = {
      ...raw,
      file: "packages/App/FeatureSet/StatusPage/src/Pages/Example.tsx",
    };
    const valueElsewhere: DateTimeFieldFinding = {
      ...value,
      file: "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil.ts",
    };

    expect(
      disallowedDateTimeFields([
        optIn,
        raw,
        value,
        unlistedOptIn,
        steppingRawInput,
        unlistedRaw,
        valueElsewhere,
      ]),
    ).toEqual([unlistedOptIn, steppingRawInput, unlistedRaw, valueElsewhere]);
  });

  test("each opt-in to seconds says why, and is a time range read against telemetry", () => {
    expect(Object.keys(SECONDS_OPT_IN_FILES).sort()).toEqual([
      "packages/Common/UI/Components/Date/CustomTimeRangeModal.tsx",
      "packages/Common/UI/Components/Date/StartAndEndDate.tsx",
    ]);

    for (const [file, why] of Object.entries(SECONDS_OPT_IN_FILES)) {
      expect({
        file,
        saysWhy: why.length > 60,
        telemetry: why.includes("telemetry"),
      }).toEqual({ file, saysWhy: true, telemetry: true });
    }
  });

  test("each raw input says how it keeps to the minute, and its file still does it that way", () => {
    for (const [file, entry] of Object.entries(RAW_DATE_TIME_INPUT_FILES)) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({
        file,
        saysHow: entry.how.length > 40,
        stillDoesIt: source.includes(entry.keepsToTheMinuteWith),
      }).toEqual({ file, saysHow: true, stillDoesIt: true });
    }
  });

  test("a finding is reported with its file, its line and what to do", () => {
    const message: string = formatDateTimeFieldFindings([
      {
        file: "packages/Common/UI/Components/Example.tsx",
        line: 12,
        kind: DateTimeFieldSiteKind.SecondsOptIn,
        text: "showSecondsForDateTime={true}",
      },
    ]);

    expect(message).toContain(
      "packages/Common/UI/Components/Example.tsx:12  [showSecondsForDateTime]  showSecondsForDateTime={true}",
    );
    expect(message).toContain("#7593");
    expect(message).toContain("SECONDS_OPT_IN_FILES");
    expect(message).toContain("RAW_DATE_TIME_INPUT_FILES");
    expect(message).toContain("toDateTimeLocalMinuteString");
    expect(formatDateTimeFieldFindings([])).toBe("");
  });
});

describe("the browser code of the whole product", () => {
  const files: Array<string> = listDateTimeFieldScanFiles(REPOSITORY_ROOT);
  const findings: Array<DateTimeFieldFinding> = scanDateTimeFields(
    REPOSITORY_ROOT,
    files,
  );

  function relative(file: string): string {
    return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
  }

  function findingsIn(file: string): Array<DateTimeFieldFinding> {
    return findings.filter((finding: DateTimeFieldFinding): boolean => {
      return finding.file === file;
    });
  }

  test("is really read: every app's source and the shared UI", () => {
    const read: Set<string> = new Set<string>(files.map(relative));

    expect(files.length).toBeGreaterThan(1000);

    for (const expected of [
      SHARED_INPUT_FILE,
      "packages/Common/UI/Components/Forms/Fields/FormField.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerDateTimeFieldElement.tsx",
      "packages/App/FeatureSet/Accounts/src/App.tsx",
      "packages/App/FeatureSet/AdminDashboard/src/App.tsx",
      "packages/App/FeatureSet/StatusPage/src/App.tsx",
      "packages/App/FeatureSet/PublicDashboard/src/App.tsx",
      ...Object.keys(SECONDS_OPT_IN_FILES),
      ...Object.keys(RAW_DATE_TIME_INPUT_FILES),
    ]) {
      expect({ file: expected, read: read.has(expected) }).toEqual({
        file: expected,
        read: true,
      });
    }

    if (fs.existsSync(path.join(REPOSITORY_ROOT, "ee"))) {
      expect(
        read.has("ee/Dashboard/AuditLogExport/AuditLogExportFormModal.tsx"),
      ).toBe(true);
    }
  });

  test("finds what it must: the shared Input's value to the second, each opt-in, each raw input", () => {
    expect(
      findingsIn(SHARED_INPUT_FILE).map((finding: DateTimeFieldFinding) => {
        return finding.kind;
      }),
    ).toEqual([DateTimeFieldSiteKind.SecondsValue]);

    for (const file of Object.keys(SECONDS_OPT_IN_FILES)) {
      expect({
        file,
        optIns: findingsIn(file).filter((finding: DateTimeFieldFinding) => {
          return finding.kind === DateTimeFieldSiteKind.SecondsOptIn;
        }).length,
      }).toEqual({ file, optIns: 2 });
    }

    for (const file of Object.keys(RAW_DATE_TIME_INPUT_FILES)) {
      expect({
        file,
        raw:
          findingsIn(file).filter((finding: DateTimeFieldFinding) => {
            return finding.kind === DateTimeFieldSiteKind.RawDateTimeInput;
          }).length > 0,
      }).toEqual({ file, raw: true });
    }
  });

  test("the on-call, override and form fields the customer scheduled with do not opt in to seconds", () => {
    for (const file of [
      "packages/Common/UI/Components/Forms/Fields/FormField.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerDateTimeFieldElement.tsx",
      "packages/Common/UI/Components/Filters/DateFilter.tsx",
      "packages/Common/UI/Components/Workflow/ColumnEditor/ColumnValueInput.tsx",
      "packages/Common/UI/Components/Workflow/ValuePicker/ValueSingleField.tsx",
    ]) {
      expect({ file, findings: findingsIn(file) }).toEqual({
        file,
        findings: [],
      });
    }
  });

  test("nothing else shows or asks for seconds", () => {
    expect(
      formatDateTimeFieldFindings(disallowedDateTimeFields(findings)),
    ).toBe("");
  });

  test("every listed file is still one that needs its entry", () => {
    for (const file of Object.keys(SECONDS_OPT_IN_FILES)) {
      expect({
        file,
        stillOptsIn: findingsIn(file).some(
          (finding: DateTimeFieldFinding): boolean => {
            return finding.kind === DateTimeFieldSiteKind.SecondsOptIn;
          },
        ),
      }).toEqual({ file, stillOptsIn: true });
    }

    for (const file of Object.keys(RAW_DATE_TIME_INPUT_FILES)) {
      expect({
        file,
        stillHasOne: findingsIn(file).some(
          (finding: DateTimeFieldFinding): boolean => {
            return finding.kind === DateTimeFieldSiteKind.RawDateTimeInput;
          },
        ),
      }).toEqual({ file, stillHasOne: true });
    }
  });
});
