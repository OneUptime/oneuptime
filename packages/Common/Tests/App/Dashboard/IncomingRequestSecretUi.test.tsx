/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * What the Dashboard says about a project's incoming request secrets (issue
 * #7526), away from their own settings page:
 *
 *   - an Incoming Request monitor's heartbeat URL says, while the project
 *     requires a secret, that its senders must send one, in which header,
 *     and links to where the secrets are - and says nothing otherwise;
 *   - the setup card's example request sends the header, with a placeholder
 *     for the secret: whoever reads a monitor may not read the secrets;
 *   - turning the requirement on asks first, turning it off does not;
 *   - every word of it reads in every Dashboard language.
 *
 * Whether the project requires a secret is stubbed (the hook reads it from
 * the project).
 */

let mockIsSecretRequired: boolean = false;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/UseIncomingRequestSecretRequirement",
  () => {
    return {
      __esModule: true,
      default: (): boolean => {
        return mockIsSecretRequired;
      },
    };
  },
);

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    HOST: "oneuptime.example.com",
  };
});

import IncomingRequestSecretNote from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/IncomingRequestSecretNote";
import IncomingRequestSecretsCopy, {
  INCOMING_REQUEST_SECRET_NOTE_TEST_ID,
  INCOMING_REQUEST_SECRET_PLACEHOLDER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/IncomingRequestSecretsCopy";
import { getRequireIncomingRequestSecretConfirmation } from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingRequestSecret/RequireIncomingRequestSecretCard";
import IncomingMonitorLink from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink";
import MonitorSetupCard, {
  getHeartbeatExampleCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorSetupCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import { INCOMING_REQUEST_SECRET_HEADER } from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "../../../Types/ObjectID";
import { MonitorOverviewSetupKind } from "../../../Utils/Monitor/MonitorOverviewFamily";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_KEY: string = "5ec2e7a1-9b3c-4d2e-8f10-7a6b5c4d3e2f";
const URL: string = `https://oneuptime.example.com/heartbeat/${MONITOR_KEY}`;

const editorMonitor: () => Monitor = (): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.incomingRequestSecretKey = new ObjectID(MONITOR_KEY);
  return monitor;
};

const renderInRouter: (element: ReactElement) => RenderResult = (
  element: ReactElement,
): RenderResult => {
  return render(<MemoryRouter>{element}</MemoryRouter>);
};

const SECRETS_PAGE: string = RouteUtil.populateRouteParams(
  RouteMap[PageMap.MONITORS_SETTINGS_INCOMING_REQUEST_SECRETS] as Route,
).toString();

beforeEach(() => {
  mockIsSecretRequired = false;
});

afterEach(() => {
  cleanup();
});

describe("getHeartbeatExampleCommand", () => {
  test("is the plain request while the project requires no secret", () => {
    expect(
      getHeartbeatExampleCommand({ url: URL, isSecretRequired: false }),
    ).toBe(`curl -X POST "${URL}"`);
  });

  test("sends the secret header, with a placeholder, while the project requires one", () => {
    const command: string = getHeartbeatExampleCommand({
      url: URL,
      isSecretRequired: true,
    });

    expect(command).toBe(
      [
        `curl -X POST "${URL}" \\`,
        `  -H "${INCOMING_REQUEST_SECRET_HEADER}: ${INCOMING_REQUEST_SECRET_PLACEHOLDER}"`,
      ].join("\n"),
    );
  });
});

describe("IncomingRequestSecretNote", () => {
  test("says nothing while the project requires no secret", () => {
    renderInRouter(<IncomingRequestSecretNote isRequired={false} />);

    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says senders must send the secret, in which header, and links to the secrets", () => {
    renderInRouter(<IncomingRequestSecretNote isRequired={true} />);

    const note: HTMLElement = screen.getByTestId(
      INCOMING_REQUEST_SECRET_NOTE_TEST_ID,
    );

    expect(note).toHaveTextContent(
      IncomingRequestSecretsCopy.monitorRequirementNote,
    );
    expect(note).toHaveTextContent(INCOMING_REQUEST_SECRET_HEADER);

    const link: HTMLElement = screen.getByRole("link", {
      name: IncomingRequestSecretsCopy.manageSecretsLink,
    });

    expect(link.getAttribute("href")).toBe(SECRETS_PAGE);
  });
});

describe("an Incoming Request monitor's heartbeat URL", () => {
  test("the setup card says nothing of a secret while none is required", () => {
    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={editorMonitor()}
      />,
    );

    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      INCOMING_REQUEST_SECRET_HEADER,
    );
  });

  test("the setup card's example sends the header, and the note says why, while one is required", () => {
    mockIsSecretRequired = true;

    renderInRouter(
      <MonitorSetupCard
        monitorId={MONITOR_ID}
        kind={MonitorOverviewSetupKind.HeartbeatUrl}
        monitor={editorMonitor()}
      />,
    );

    expect(
      screen.getByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      `${INCOMING_REQUEST_SECRET_HEADER}: ${INCOMING_REQUEST_SECRET_PLACEHOLDER}`,
    );
  });

  test("the Documentation page's URL card carries the note while one is required", () => {
    mockIsSecretRequired = true;

    renderInRouter(
      <IncomingMonitorLink secretKey={new ObjectID(MONITOR_KEY)} />,
    );

    expect(
      screen.getByTestId(INCOMING_REQUEST_SECRET_NOTE_TEST_ID),
    ).toBeInTheDocument();
  });
});

describe("turning the requirement on", () => {
  test("asks first, saying senders without a secret are refused from then on", () => {
    expect(getRequireIncomingRequestSecretConfirmation(true)).toEqual({
      title: IncomingRequestSecretsCopy.confirmTurnOnTitle,
      description: IncomingRequestSecretsCopy.confirmTurnOnDescription,
      submitButtonText: IncomingRequestSecretsCopy.confirmTurnOnButton,
    });
  });

  test("turning it off asks nothing", () => {
    expect(getRequireIncomingRequestSecretConfirmation(false)).toBeUndefined();
  });
});

describe("the words, in every Dashboard language", () => {
  const LOCALES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  const readLocale: (code: string) => Record<string, unknown> = (
    code: string,
  ): Record<string, unknown> => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
    ) as Record<string, unknown>;
  };

  const LANGUAGES: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });

  const words: Array<string> = Object.values(IncomingRequestSecretsCopy);

  test("are keys of the English locale", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const word of words) {
      expect({ word, key: english[word] }).toEqual({ word, key: word });
    }
  });

  test.each(LANGUAGES)("are in %s", (code: string) => {
    const locale: Record<string, unknown> = readLocale(code);

    for (const word of words) {
      expect({ word, present: typeof locale[word] === "string" }).toEqual({
        word,
        present: true,
      });
    }
  });

  test.each(["de", "es", "ja", "fa", "ar"])(
    "every sentence is translated in %s, the header name kept as it is",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);

      for (const word of words) {
        const translated: string = locale[word] as string;

        if (word.includes(".")) {
          expect({ word, translated: translated !== word }).toEqual({
            word,
            translated: true,
          });
        }

        if (word.includes(INCOMING_REQUEST_SECRET_HEADER)) {
          expect(translated).toContain(INCOMING_REQUEST_SECRET_HEADER);
        }
      }
    },
  );
});
