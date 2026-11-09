import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  DiscoveryImportAlerting,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import ObjectID from "Common/Types/ObjectID";

/*
 * The monitor template an import is sent with (issue #5775): one rule for a
 * scan's import and the Discovered Devices list's, so the two can never
 * disagree about which template a device is monitored with - or make the
 * recommended pack twice. The project and the recommended pack's
 * find-or-create are mocked: both read the browser's session.
 */
const getCurrentProjectIdMock: jest.Mock = jest.fn();
const findOrCreateMock: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../FeatureSet/Dashboard/src/Components/NetworkDevice/RecommendedMonitorTemplate",
  () => {
    return {
      __esModule: true,
      findOrCreateRecommendedTemplate: (...args: Array<unknown>) => {
        return findOrCreateMock(...args);
      },
    };
  },
);

import { resolveImportMonitorTemplateId } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportTemplateId";
import {
  DiscoveryImportTemplateChoice,
  RECOMMENDED_TEMPLATE_CHOICE_VALUE,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportOutcome";

const PROJECT_ID: string = "3f1b6b0e-0000-4000-8000-0000000000aa";
const TEMPLATE_ID: string = "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d";
const MADE_ID: string = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";

const SEED_IDS: never = {
  onlineStatusId: "online",
  offlineStatusId: "offline",
} as never;

function settings(
  overrides: Partial<DiscoveryImportSettings> = {},
): DiscoveryImportSettings {
  return {
    pollingIntervalInMinutes: 5,
    applyVendorTemplates: true,
    alerting: DiscoveryImportAlerting.MonitorTemplate,
    ...overrides,
  };
}

function choice(
  overrides: Partial<DiscoveryImportTemplateChoice> = {},
): DiscoveryImportTemplateChoice {
  return {
    name: "Recommended",
    ...overrides,
  } as DiscoveryImportTemplateChoice;
}

beforeEach(() => {
  getCurrentProjectIdMock.mockReset();
  findOrCreateMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  findOrCreateMock.mockResolvedValue(new ObjectID(MADE_ID));
});

describe("the monitor template an import is sent with", () => {
  test("none when the import asks for no monitors, whatever was picked", async () => {
    for (const pickedTemplate of [
      choice({ id: TEMPLATE_ID }),
      choice(),
      null,
    ]) {
      expect(
        await resolveImportMonitorTemplateId({
          settings: settings({
            alerting: DiscoveryImportAlerting.None,
            monitorTemplateId: RECOMMENDED_TEMPLATE_CHOICE_VALUE,
          }),
          pickedTemplate: pickedTemplate,
          seedIds: SEED_IDS,
        }),
      ).toBeUndefined();
    }

    expect(findOrCreateMock).not.toHaveBeenCalled();
  });

  test("an import that asks for monitors and has no template picked is refused, saying what to do", async () => {
    await expect(
      resolveImportMonitorTemplateId({
        settings: settings(),
        pickedTemplate: null,
        seedIds: SEED_IDS,
      }),
    ).rejects.toThrow(
      "Pick the monitor template each device is monitored with.",
    );
  });

  test("the template picked, as it is", async () => {
    expect(
      await resolveImportMonitorTemplateId({
        settings: settings({ monitorTemplateId: TEMPLATE_ID }),
        pickedTemplate: choice({ id: TEMPLATE_ID }),
        seedIds: SEED_IDS,
      }),
    ).toBe(TEMPLATE_ID);
    expect(findOrCreateMock).not.toHaveBeenCalled();
  });

  test("the recommended pack the project does not have yet is made now, for this project", async () => {
    expect(
      await resolveImportMonitorTemplateId({
        settings: settings({
          monitorTemplateId: RECOMMENDED_TEMPLATE_CHOICE_VALUE,
        }),
        pickedTemplate: choice(),
        seedIds: SEED_IDS,
      }),
    ).toBe(MADE_ID);

    expect(findOrCreateMock).toHaveBeenCalledTimes(1);
    const [request] = findOrCreateMock.mock.calls[0] as [
      { projectId: ObjectID; seedIds: unknown },
    ];
    expect(request.projectId.toString()).toBe(PROJECT_ID);
    expect(request.seedIds).toBe(SEED_IDS);
  });

  test("the recommended pack cannot be made without a project or the statuses it seeds", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    await expect(
      resolveImportMonitorTemplateId({
        settings: settings({
          monitorTemplateId: RECOMMENDED_TEMPLATE_CHOICE_VALUE,
        }),
        pickedTemplate: choice(),
        seedIds: SEED_IDS,
      }),
    ).rejects.toThrow(
      "The recommended template could not be created for this project. Pick another template.",
    );

    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));

    await expect(
      resolveImportMonitorTemplateId({
        settings: settings({
          monitorTemplateId: RECOMMENDED_TEMPLATE_CHOICE_VALUE,
        }),
        pickedTemplate: choice(),
        seedIds: null,
      }),
    ).rejects.toThrow(
      "The recommended template could not be created for this project. Pick another template.",
    );
    expect(findOrCreateMock).not.toHaveBeenCalled();
  });

  test("a picked choice with no id that is not the recommended pack sends no template", async () => {
    expect(
      await resolveImportMonitorTemplateId({
        settings: settings({ monitorTemplateId: TEMPLATE_ID }),
        pickedTemplate: choice(),
        seedIds: SEED_IDS,
      }),
    ).toBeUndefined();
    expect(findOrCreateMock).not.toHaveBeenCalled();
  });
});
