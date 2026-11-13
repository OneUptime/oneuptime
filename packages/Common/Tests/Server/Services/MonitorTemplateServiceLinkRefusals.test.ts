import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import BadDataException from "../../../Types/Exception/BadDataException";
import { readRefusalValues } from "../../../Types/Exception/RefusalWithValues";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { isTranslatableTerm, TemplateValues } from "../../../Types/Translator";
import {
  MONITOR_IN_ANOTHER_PROJECT_REFUSAL,
  MONITOR_NOT_FOUND_REFUSAL,
  MONITOR_NOT_LINKED_REFUSAL,
  MONITOR_TYPE_MISMATCH_REFUSAL,
} from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * WHY A MONITOR CANNOT BE LINKED TO A TEMPLATE, SYNCED FROM IT OR UNLINKED,
 * AS THE SERVER SAYS IT (#7678).
 *
 * The refusals were English fragments ("Monitor not found", "Monitor and
 * template belong to different projects") and a sentence with the two types
 * built into it, so the template's page said them in English in every
 * language. Each is a sentence of the Dashboard's locales now, and the type
 * mismatch carries its two types as values the Dashboard reads back
 * (RefusalWithValues): the error the server throws is the key, or the key
 * filled with its values.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_TEMPLATE_ID: ObjectID = new ObjectID(
  "23232323-2323-4232-8232-232323232323",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function buildTemplate(): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate(TEMPLATE_ID);
  template.projectId = PROJECT_ID;
  template.monitorType = MonitorType.API;
  template.monitorSteps = new MonitorSteps();

  return template;
}

function buildMonitor(data: {
  projectId?: ObjectID | undefined;
  monitorType?: MonitorType | undefined;
  monitorTemplateId?: ObjectID | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = data.projectId || PROJECT_ID;
  monitor.monitorType = data.monitorType || MonitorType.API;

  if (data.monitorTemplateId) {
    monitor.monitorTemplateId = data.monitorTemplateId;
  }

  return monitor;
}

/*
 * The template and the monitor as the server reads them; nothing is
 * written - a refusal comes before any write.
 */
function mockReads(monitor: Monitor | null): {
  update: ReturnType<typeof jest.spyOn>;
} {
  jest
    .spyOn(MonitorTemplateService, "findOneById")
    .mockResolvedValue(buildTemplate());
  jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);

  return {
    update: jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(1),
  };
}

// The error `run` is refused with.
async function refusalOf(run: () => Promise<void>): Promise<Error> {
  let refusal: unknown = null;

  try {
    await run();
  } catch (error) {
    refusal = error;
  }

  expect(refusal).toBeInstanceOf(BadDataException);

  return refusal as Error;
}

const link: () => Promise<void> = (): Promise<void> => {
  return MonitorTemplateService.linkMonitor({
    monitorTemplateId: TEMPLATE_ID,
    monitorId: MONITOR_ID,
    props: { isRoot: true },
  });
};

const sync: () => Promise<void> = (): Promise<void> => {
  return MonitorTemplateService.syncToMonitor({
    monitorTemplateId: TEMPLATE_ID,
    monitorId: MONITOR_ID,
    fields: ["monitorSteps"],
    props: { isRoot: true },
  });
};

const unlink: () => Promise<void> = (): Promise<void> => {
  return MonitorTemplateService.unlinkMonitor({
    monitorTemplateId: TEMPLATE_ID,
    monitorId: MONITOR_ID,
    props: { isRoot: true },
  });
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateService's link, sync and unlink refusals", () => {
  it.each([
    {
      action: "link",
      run: link,
      monitor: null,
      refusal: MONITOR_NOT_FOUND_REFUSAL,
    },
    {
      action: "link",
      run: link,
      monitor: buildMonitor({ projectId: OTHER_PROJECT_ID }),
      refusal: MONITOR_IN_ANOTHER_PROJECT_REFUSAL,
    },
    {
      action: "sync",
      run: sync,
      monitor: null,
      refusal: MONITOR_NOT_FOUND_REFUSAL,
    },
    {
      action: "sync",
      run: sync,
      monitor: buildMonitor({ monitorTemplateId: OTHER_TEMPLATE_ID }),
      refusal: MONITOR_NOT_LINKED_REFUSAL,
    },
    {
      action: "sync",
      run: sync,
      monitor: buildMonitor({
        projectId: OTHER_PROJECT_ID,
        monitorTemplateId: TEMPLATE_ID,
      }),
      refusal: MONITOR_IN_ANOTHER_PROJECT_REFUSAL,
    },
    {
      action: "unlink",
      run: unlink,
      monitor: null,
      refusal: MONITOR_NOT_FOUND_REFUSAL,
    },
    {
      action: "unlink",
      run: unlink,
      monitor: buildMonitor({ monitorTemplateId: OTHER_TEMPLATE_ID }),
      refusal: MONITOR_NOT_LINKED_REFUSAL,
    },
  ])(
    "$action refuses with its sentence, a key of the Dashboard's locales: $refusal",
    async (data: {
      action: string;
      run: () => Promise<void>;
      monitor: Monitor | null;
      refusal: string;
    }) => {
      const mocks: { update: ReturnType<typeof jest.spyOn> } = mockReads(
        data.monitor,
      );

      const refusal: Error = await refusalOf(data.run);

      expect(refusal.message).toBe(data.refusal);
      expect(readDashboardLocale("en")[refusal.message]).toBe(data.refusal);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("link refuses a monitor of another type with the type mismatch, its two types as values the Dashboard reads back", async () => {
    const mocks: { update: ReturnType<typeof jest.spyOn> } = mockReads(
      buildMonitor({ monitorType: MonitorType.IncomingRequest }),
    );

    const refusal: Error = await refusalOf(link);

    expect(refusal.message).toBe(
      "This monitor's type is Incoming Request, and this template's type is API. Only monitors of the template's type can be linked to it.",
    );
    expect(mocks.update).not.toHaveBeenCalled();

    const values: TemplateValues | null = readRefusalValues(
      MONITOR_TYPE_MISMATCH_REFUSAL,
      refusal.message,
    );

    // Both types are words of the product's own, said in the reader's language.
    expect(values).toEqual({
      monitorType: {
        translatableTerm: MonitorType.IncomingRequest,
        inSentence: false,
      },
      templateType: { translatableTerm: MonitorType.API, inSentence: false },
    });
    expect(isTranslatableTerm(values!["monitorType"])).toBe(true);
    expect(
      readDashboardLocale("en")[MONITOR_TYPE_MISMATCH_REFUSAL.template],
    ).toBe(MONITOR_TYPE_MISMATCH_REFUSAL.template);
  });

  it("links a monitor of the template's type, in its project", async () => {
    const mocks: { update: ReturnType<typeof jest.spyOn> } = mockReads(
      buildMonitor({}),
    );

    await link();

    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("each refusal is worded in every language the Dashboard speaks", () => {
    const refusals: Array<string> = [
      MONITOR_NOT_FOUND_REFUSAL,
      MONITOR_IN_ANOTHER_PROJECT_REFUSAL,
      MONITOR_NOT_LINKED_REFUSAL,
      MONITOR_TYPE_MISMATCH_REFUSAL.template,
    ];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        unworded: refusals.filter((refusal: string): boolean => {
          return !words[refusal] || words[refusal] === refusal;
        }),
      }).toEqual({ language, unworded: [] });
    }
  });
});
