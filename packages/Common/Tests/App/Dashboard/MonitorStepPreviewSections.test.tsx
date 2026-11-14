import "@testing-library/jest-dom";
import { withProductText } from "../../../UI/Utils/ProductText";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A MONITOR TYPE'S LIVE PREVIEW IS A SECTION OF THE CRITERIA STEP.
 *
 * Create Monitor's criteria step draws its cards as the sections of the
 * card or dialog it is in (CardFormSections): a rule above each and a
 * section's title - 16px, semibold. Three types drew a preview inside
 * their configuration section with a rule and a heading of their own
 * (HorizontalRule and FieldLabelElement isHeading): 18px, lighter, and 32px
 * from each rule. Once the step's cards became sections at every width,
 * "What this monitor reads now", "Preview" and "Security Events Preview"
 * read as a step above the sections round them.
 *
 * Each preview is now a section of its own: a Card in CardFormSections, so
 * it has the rule, the spacing and the title every other section has.
 */

// The form's fields are not what this suite is about: only the preview is drawn.
jest.mock("../../../UI/Components/Forms/BasicForm", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

import ProfileMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProfileMonitor/ProfileMonitorStepForm";
import LlmMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LlmMonitor/LlmMonitorStepForm";
import SecurityEventsMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm";
import SecurityEventAttributeUtil from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeUtil";
import { PROFILE_MONITOR_PREVIEW_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProfileMonitor/ProfileMonitorCopy";
import {
  CARD_FORM_SECTION_FRAME_CLASS_NAME,
  CARD_SECTION_TITLE_CLASS_NAME,
} from "../../../UI/Components/Card/Card";
import { MonitorStepProfileMonitorUtil } from "../../../Types/Monitor/MonitorStepProfileMonitor";
import { MonitorStepLlmMonitorUtil } from "../../../Types/Monitor/MonitorStepLlmMonitor";
import { MonitorStepSecurityEventsMonitorUtil } from "../../../Types/Monitor/MonitorStepSecurityEventsMonitor";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const MONITOR_FORMS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor",
);

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({} as never);
  // The previews read on: their reads never answer here.
  jest.spyOn(API, "post").mockImplementation((): never => {
    return new Promise(() => {}) as never;
  });
  jest.spyOn(AnalyticsModelAPI, "count").mockResolvedValue(3 as never);
  jest
    .spyOn(SecurityEventAttributeUtil, "getAttributeKeys")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

interface PreviewCase {
  type: string;
  title: string;
  sectionTestId: string;
  draw: () => React.ReactElement;
}

const CASES: Array<PreviewCase> = [
  {
    type: "Profiles",
    title: PROFILE_MONITOR_PREVIEW_TITLE,
    sectionTestId: "profile-monitor-preview-section",
    draw: (): React.ReactElement => {
      return (
        <ProfileMonitorStepForm
          monitorStepProfileMonitor={{
            ...MonitorStepProfileMonitorUtil.getDefault(),
            functionName: "parseOrder",
          }}
          onMonitorStepProfileMonitorChanged={() => {}}
          telemetryServices={[]}
        />
      );
    },
  },
  {
    type: "AI / LLM",
    title: "Preview",
    sectionTestId: "llm-monitor-preview-section",
    draw: (): React.ReactElement => {
      return (
        <LlmMonitorStepForm
          monitorStepLlmMonitor={MonitorStepLlmMonitorUtil.getDefault()}
          onMonitorStepLlmMonitorChanged={() => {}}
          telemetryServices={[]}
        />
      );
    },
  },
  {
    type: "Security Events",
    title: "Security Events Preview",
    sectionTestId: "security-events-monitor-preview-section",
    draw: (): React.ReactElement => {
      return (
        <SecurityEventsMonitorStepForm
          monitorStepSecurityEventsMonitor={MonitorStepSecurityEventsMonitorUtil.getDefault()}
          onMonitorStepSecurityEventsMonitorChanged={() => {}}
          telemetryServices={[]}
        />
      );
    },
  },
];

async function drawn(previewCase: PreviewCase): Promise<HTMLElement> {
  await act(async (): Promise<void> => {
    render(<MemoryRouter>{previewCase.draw()}</MemoryRouter>);
  });

  return screen.getByTestId(previewCase.sectionTestId);
}

describe.each(CASES)(
  "the $type monitor's preview",
  (previewCase: PreviewCase) => {
    test("is a section of the step of its own, 24px under the fields above it", async () => {
      const section: HTMLElement = await drawn(previewCase);

      // The gap above its rule, as CardFormSections' space-y-6 leaves above every section's.
      expect(section).toHaveClass("mt-6");

      const cards: Array<HTMLElement> = within(section).getAllByTestId("card");

      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveAttribute("data-card-surface", "form-section");
      // A rule above it, no frame round it.
      expect((cards[0]!.firstElementChild as HTMLElement).className).toBe(
        CARD_FORM_SECTION_FRAME_CLASS_NAME,
      );
    });

    test("its title is a section's, as the sections round it are titled", async () => {
      const section: HTMLElement = await drawn(previewCase);

      const title: HTMLElement = within(section).getByTestId(
        "card-details-heading",
      );

      expect(title).toHaveTextContent(previewCase.title);
      // Its words are the product's own, readable in a recording of the setup pages (#6834).
      expect(title.className).toBe(
        withProductText(CARD_SECTION_TITLE_CLASS_NAME),
      );
    });

    test("draws no rule or heading of its own: no larger, lighter heading over a 32px rule", async () => {
      await drawn(previewCase);

      // HorizontalRule's line, and FieldLabelElement's label drawn as a heading.
      expect(
        document.querySelector(".border-b.border-gray-200.mb-8.mt-8"),
      ).toBeNull();
      expect(document.querySelector("label.text-lg")).toBeNull();
    });
  },
);

describe("what each preview holds stays inside its section", () => {
  test("the profiles preview reads in its section", async () => {
    const section: HTMLElement = await drawn(CASES[0]!);

    expect(
      within(section).getByTestId("profile-monitor-preview-loading"),
    ).toBeInTheDocument();
  });

  test("the AI answers' preview reads in its section", async () => {
    const section: HTMLElement = await drawn(CASES[1]!);

    expect(within(section).getByTestId("llm-monitor-preview")).toBeVisible();
  });

  test("the security events' count reads in its section", async () => {
    const section: HTMLElement = await drawn(CASES[2]!);

    expect(await within(section).findByText("3")).toBeInTheDocument();
  });
});

// Every .tsx file under a directory.
function listTsxFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTsxFiles(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

describe("a monitor type's form inside the criteria step", () => {
  /*
   * The step's sections are its headings. A type's form drawn in one of
   * them that rules itself off under a heading of its own outranks the
   * section it is in: a part of it that needs a title is a section of its
   * own (CardFormSections and a Card), as the three previews above are.
   */
  test("never rules itself off under a heading of its own", () => {
    const offenders: Array<string> = [];

    for (const file of listTsxFiles(MONITOR_FORMS_DIRECTORY)) {
      const source: string = fs.readFileSync(file, "utf8");
      const relative: string = path.relative(MONITOR_FORMS_DIRECTORY, file);

      if (source.includes("<HorizontalRule")) {
        offenders.push(`${relative}: HorizontalRule`);
      }

      if (source.includes("isHeading={true}")) {
        offenders.push(`${relative}: a field label drawn as a heading`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the scan reads the monitor forms: the three previews' forms are among them", () => {
    const relativeFiles: Array<string> = listTsxFiles(
      MONITOR_FORMS_DIRECTORY,
    ).map((file: string): string => {
      return path.relative(MONITOR_FORMS_DIRECTORY, file);
    });

    expect(relativeFiles).toEqual(
      expect.arrayContaining([
        path.join("ProfileMonitor", "ProfileMonitorStepForm.tsx"),
        path.join("LlmMonitor", "LlmMonitorStepForm.tsx"),
        path.join("SecurityEventsMonitor", "SecurityEventsMonitorStepForm.tsx"),
        "MonitorStep.tsx",
      ]),
    );
  });
});
