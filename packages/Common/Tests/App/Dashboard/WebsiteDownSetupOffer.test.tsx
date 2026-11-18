import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { ReactElement } from "react";
import { initReactI18next } from "react-i18next";

/*
 * THE GUIDED SETUP, OFFERED ON CREATE MONITOR (#7054).
 *
 * Someone who picks Website or API on Create Monitor most often wants to
 * know when it is down, and the guided setup does that whole job - the
 * monitor, who is told and a test page - on one page. So under the type
 * picked, one quiet line offers it: only for those two types, only on a
 * plain Create Monitor (not a template's, an action item's, a device's or a
 * chart's monitor), and only to whoever may create a monitor.
 */

let mayCreateMonitor: boolean = true;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi",
  () => {
    return {
      __esModule: true,
      default: {},
      mayCreateMonitor: (): boolean => {
        return mayCreateMonitor;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to: { toString: () => string };
        children: React.ReactNode;
        dataTestId?: string;
      }) => {
        return (
          <a href={props.to.toString()} data-testid={props.dataTestId}>
            {props.children}
          </a>
        );
      },
    };
  },
);

import WebsiteDownSetupOffer, {
  WEBSITE_DOWN_SETUP_OFFER_TEST_ID,
  isWebsiteDownSetupOfferedFor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetupOffer";
import { WEBSITE_DOWN_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import getMonitorTypeFormField from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorTypeFormField";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import type Field from "../../../UI/Components/Forms/Types/Field";
import type FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "65f00000-0000-4000-8000-000000007054";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const draw: (props: {
  monitorType: MonitorType | undefined;
  isOffered?: boolean;
}) => void = (props: {
  monitorType: MonitorType | undefined;
  isOffered?: boolean;
}): void => {
  render(
    <WebsiteDownSetupOffer
      monitorType={props.monitorType}
      isOffered={props.isOffered ?? true}
    />,
  );
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
      fa: { translation: readLocale("fa") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  mayCreateMonitor = true;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("Create Monitor offers the guided setup (#7054)", () => {
  test.each([[MonitorType.Website], [MonitorType.API]])(
    "%s picked: one line, and the way to the setup, saying where it was opened from",
    (monitorType: MonitorType) => {
      draw({ monitorType });

      expect(
        screen.getByTestId(WEBSITE_DOWN_SETUP_OFFER_TEST_ID),
      ).toHaveTextContent(WEBSITE_DOWN_COPY.createMonitorOffer);

      const link: HTMLElement = screen.getByTestId(
        "website-down-setup-offer-link",
      );

      expect(link).toHaveTextContent("Guided setup");
      expect(link).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/monitors/setup?from=create_monitor`,
      );
    },
  );

  test.each(
    Object.values(MonitorType).filter((monitorType: MonitorType): boolean => {
      return (
        monitorType !== MonitorType.Website && monitorType !== MonitorType.API
      );
    }),
  )("%s picked: nothing, the setup does not make one", (type: MonitorType) => {
    draw({ monitorType: type });

    expect(screen.queryByTestId(WEBSITE_DOWN_SETUP_OFFER_TEST_ID)).toBeNull();
  });

  test("no type picked yet: nothing", () => {
    draw({ monitorType: undefined });

    expect(screen.queryByTestId(WEBSITE_DOWN_SETUP_OFFER_TEST_ID)).toBeNull();
  });

  test("Create Monitor doing another job - a template's, an action item's, a device's, a chart's monitor: nothing", () => {
    draw({ monitorType: MonitorType.Website, isOffered: false });

    expect(screen.queryByTestId(WEBSITE_DOWN_SETUP_OFFER_TEST_ID)).toBeNull();
  });

  test("someone who may not create a monitor is not offered a setup that makes one", () => {
    mayCreateMonitor = false;
    draw({ monitorType: MonitorType.Website });

    expect(screen.queryByTestId(WEBSITE_DOWN_SETUP_OFFER_TEST_ID)).toBeNull();
  });

  test("only Website and API", () => {
    expect(isWebsiteDownSetupOfferedFor(MonitorType.Website)).toBe(true);
    expect(isWebsiteDownSetupOfferedFor(MonitorType.API)).toBe(true);
    expect(isWebsiteDownSetupOfferedFor(MonitorType.Ping)).toBe(false);
    expect(isWebsiteDownSetupOfferedFor(null)).toBe(false);
    expect(isWebsiteDownSetupOfferedFor(undefined)).toBe(false);
  });

  test.each(["de", "fa"])(
    "in %s, the line and its link are the reader's",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });
      draw({ monitorType: MonitorType.Website });

      const table: Record<string, string> = readLocale(language);

      expect(
        screen.getByTestId(WEBSITE_DOWN_SETUP_OFFER_TEST_ID),
      ).toHaveTextContent(table[WEBSITE_DOWN_COPY.createMonitorOffer]!);
      expect(
        screen.getByTestId("website-down-setup-offer-link"),
      ).toHaveTextContent(table["Guided setup"]!);
    },
  );
});

/*
 * The Monitor Type field draws it under the picker, from the type picked,
 * on the form that asks for it (Create Monitor); a form that does not - a
 * monitor template's - draws nothing there.
 */
describe("the Monitor Type field's footer", () => {
  test("drawn from the type picked, on a form that asks for one", () => {
    const seen: Array<MonitorType | undefined> = [];
    const field: Field<Monitor> = getMonitorTypeFormField<Monitor>({
      stepId: "monitor-info",
      getFooterElement: (
        monitorType: MonitorType | undefined,
      ): ReactElement => {
        seen.push(monitorType);
        return <span>footer</span>;
      },
    });

    expect(field.getFooterElement).toBeDefined();
    field.getFooterElement!({
      monitorType: MonitorType.API,
    } as FormValues<Monitor>);
    field.getFooterElement!({} as FormValues<Monitor>);

    expect(seen).toEqual([MonitorType.API, undefined]);
  });

  test("a form that asks for none has none", () => {
    expect(
      getMonitorTypeFormField<Monitor>({ stepId: "monitor-info" })
        .getFooterElement,
    ).toBeUndefined();
    expect(getMonitorTypeFormField<Monitor>().getFooterElement).toBeUndefined();
  });
});
