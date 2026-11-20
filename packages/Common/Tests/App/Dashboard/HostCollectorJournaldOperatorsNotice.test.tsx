import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A COLLECTOR CONFIG WITHOUT THE JOURNALD OPERATORS SAYS WHAT THAT COSTS,
 * AND OFFERS TO ADD THEM, ON ITS PAGE (#10127).
 *
 * Above its config.yaml, a Collector Config whose journald receiver has no
 * operators says failed systemd units on its hosts can't say why, with Add
 * OneUptime's operators: the config as it will be, the person's own lines
 * all kept, saved as a new version only on Save. Operators of the
 * project's own, a receiver the page cannot add to, or a reader who may
 * not change the config: Show OneUptime's operators, to copy. A config
 * that files each line under its unit says nothing.
 */

const updateByIdMock: MockFunction = getJestMockFunction();
const toastSuccessMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Toast", () => {
  return {
    __esModule: true,
    default: {
      success: (...args: Array<unknown>): unknown => {
        return toastSuccessMock(...args);
      },
      error: (): void => {
        // A failure is drawn in the dialog.
      },
    },
  };
});

jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: { value?: string; dataTestId?: string }): ReactElement => {
      return (
        <pre data-testid={props.dataTestId || "code-editor"}>
          {props.value || ""}
        </pre>
      );
    },
  };
});

import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import HostCollectorJournaldOperatorsNotice, {
  JOURNALD_OPERATORS_NOTICE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorJournaldOperatorsNotice";
import HostCollectorConfig from "../../../Models/DatabaseModels/HostCollectorConfig";
import { HostCollectorOsType } from "../../../Types/HostCollector/HostCollector";
import ObjectID from "../../../Types/ObjectID";
import {
  JOURNALD_RECEIVER,
  getHostCollectorDefaultConfig,
} from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import { addJournaldOperators } from "../../../Utils/HostCollector/HostCollectorJournaldOperators";

const CONFIG_ID: string = "4a1b2c3d-1111-4aaa-8bbb-000000000010";

// A project's own config, as written before #9926.
const OWN_CONFIG: string = `receivers:
  # The services we run.
  journald:
    units: [nginx.service]
    priority: warning

exporters:
  otlp_http/oneuptime:
    endpoint: \${env:ONEUPTIME_URL}/otlp
    headers:
      x-oneuptime-token: \${env:ONEUPTIME_INGESTION_KEY}

service:
  pipelines:
    logs:
      receivers: [journald]
      exporters: [otlp_http/oneuptime]
`;

const OWN_OPERATORS: string = `receivers:
  journald:
    operators:
      - type: json_parser
        parse_from: body.MESSAGE
`;

const TWO_RECEIVERS: string = `receivers:
  journald/system:
    priority: info
  journald/kernel:
    priority: warning
`;

let onSavedCount: number = 0;

function renderNotice(data: {
  configYaml: string | null | undefined;
  canEdit?: boolean;
  provider?: i18n;
}): RenderResult {
  const notice: ReactElement = (
    <HostCollectorJournaldOperatorsNotice
      modelId={new ObjectID(CONFIG_ID)}
      configYaml={data.configYaml}
      canEdit={data.canEdit ?? true}
      onSaved={(): void => {
        onSavedCount++;
      }}
    />
  );

  return render(
    data.provider ? (
      <I18nextProvider i18n={data.provider}>{notice}</I18nextProvider>
    ) : (
      notice
    ),
  );
}

// The save's answer, and what the dialog draws after it.
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
}

function notice(): HTMLElement {
  return screen.getByTestId(JOURNALD_OPERATORS_NOTICE_TEST_ID);
}

beforeEach(() => {
  updateByIdMock.mockReset();
  toastSuccessMock.mockReset();
  onSavedCount = 0;
});

afterEach(() => {
  cleanup();
});

describe("a config whose journald receiver has no operators", () => {
  test("says what that costs, above its config.yaml, with Add OneUptime's operators", () => {
    renderNotice({ configYaml: OWN_CONFIG });

    expect(notice()).toHaveTextContent("Failed systemd units can't say why");
    expect(notice()).toHaveTextContent(
      "This config's journald receiver has no operators, so its hosts send each journal line as a whole entry, under no unit.",
    );
    expect(notice()).toHaveTextContent("Add OneUptime's operators");
    expect(notice()).toHaveAttribute("role", "alert");
  });

  test("Add shows the config as it will be, every line the person wrote kept, before anything is saved", () => {
    renderNotice({ configYaml: OWN_CONFIG });

    fireEvent.click(notice());

    const dialog: HTMLElement = screen.getByTestId("modal");
    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Add OneUptime's journald operators",
    );
    expect(within(dialog).getByTestId("modal-description")).toHaveTextContent(
      "They go under each journald receiver that has none, and nothing else changes.",
    );

    const newYaml: string =
      within(dialog).getByTestId(
        `${JOURNALD_OPERATORS_NOTICE_TEST_ID}-new-yaml`,
      ).textContent || "";

    expect(newYaml).toBe(addJournaldOperators(OWN_CONFIG));
    expect(newYaml).toContain("  # The services we run.");
    expect(newYaml).toContain("    units: [nginx.service]");
    expect(newYaml).toContain("    operators:");
    // Nothing is saved until Save.
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Save as New Version");
  });

  test("Save saves the config with the operators as a new version, says so, and the page reads it again", async () => {
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return Promise.resolve({});
    });
    renderNotice({ configYaml: OWN_CONFIG });

    fireEvent.click(notice());
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const [call] = updateByIdMock.mock.calls[0] as [
      {
        modelType: unknown;
        id: ObjectID;
        data: { configYaml: string };
      },
    ];
    expect(call.modelType).toBe(HostCollectorConfig);
    expect(call.id.toString()).toBe(CONFIG_ID);
    expect(call.data).toEqual({ configYaml: addJournaldOperators(OWN_CONFIG) });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Operators added. The hosts get the new version within a minute.",
    );
    expect(onSavedCount).toBe(1);
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("a save that fails says why in the dialog, and the page is not read again", async () => {
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return Promise.reject(new Error("The config is not valid YAML."));
    });
    renderNotice({ configYaml: OWN_CONFIG });

    fireEvent.click(notice());
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "The config is not valid YAML.",
    );
    expect(onSavedCount).toBe(0);
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  test("Cancel saves nothing", () => {
    renderNotice({ configYaml: OWN_CONFIG });

    fireEvent.click(notice());
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("several receivers without them are said as several", () => {
    renderNotice({ configYaml: TWO_RECEIVERS });

    expect(notice()).toHaveTextContent(
      "Some of this config's journald receivers have no operators",
    );

    fireEvent.click(notice());

    expect(
      screen.getByTestId(`${JOURNALD_OPERATORS_NOTICE_TEST_ID}-new-yaml`)
        .textContent,
    ).toBe(addJournaldOperators(TWO_RECEIVERS));
  });

  test("a reader who may not change the config is shown OneUptime's operators to copy, and nothing to save", () => {
    renderNotice({ configYaml: OWN_CONFIG, canEdit: false });

    expect(notice()).toHaveTextContent("Show OneUptime's operators");
    expect(notice()).not.toHaveTextContent("Add OneUptime's operators");

    fireEvent.click(notice());

    expect(
      screen.getByTestId(`${JOURNALD_OPERATORS_NOTICE_TEST_ID}-default-yaml`),
    ).toHaveTextContent("operators:");
    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
  });
});

describe("a config whose receiver has operators of its own", () => {
  test("says what that costs and shows OneUptime's operators to copy, never rewriting the person's own", () => {
    renderNotice({ configYaml: OWN_OPERATORS });

    expect(notice()).toHaveTextContent(
      "This config's journald receiver has operators of its own, and none of them files a journal line under its unit.",
    );
    expect(notice()).toHaveTextContent("Show OneUptime's operators");

    fireEvent.click(notice());

    const dialog: HTMLElement = screen.getByTestId("modal");
    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "OneUptime's journald operators",
    );
    const shown: string =
      within(dialog).getByTestId(
        `${JOURNALD_OPERATORS_NOTICE_TEST_ID}-default-yaml`,
      ).textContent || "";

    // The default's receiver, from its own key, as a config writes it.
    expect(shown.startsWith("# The systemd journal")).toBe(true);
    expect(shown).toContain("\njournald:\n  priority: info\n");
    expect(shown.split("\n").length).toBe(JOURNALD_RECEIVER.split("\n").length);
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a receiver on one line, which cannot be added to as written, is shown the operators too", () => {
    renderNotice({
      configYaml: "receivers:\n  journald: { priority: info }\n",
    });

    expect(notice()).toHaveTextContent("Show OneUptime's operators");
  });
});

describe("a config that says nothing", () => {
  test.each([
    [
      "OneUptime's default for Linux",
      getHostCollectorDefaultConfig(HostCollectorOsType.Linux),
    ],
    [
      "the config once the operators are added",
      addJournaldOperators(OWN_CONFIG),
    ],
    [
      "a config that reads no journal",
      getHostCollectorDefaultConfig(HostCollectorOsType.Windows),
    ],
    ["a config that does not read", "receivers: ["],
    ["a config not read yet", undefined],
  ])("%s", (_name: string, configYaml: string | null | undefined) => {
    renderNotice({ configYaml: configYaml });

    expect(screen.queryByTestId(JOURNALD_OPERATORS_NOTICE_TEST_ID)).toBeNull();
  });
});

describe("in Persian", () => {
  test("the notice and its action read in Persian", () => {
    const instance: i18n = createInstance();
    void instance.init({
      lng: "fa",
      fallbackLng: "en",
      resources: { fa: { translation: persianLocale } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });
    const words: Record<string, string> = persianLocale as Record<
      string,
      string
    >;

    renderNotice({ configYaml: OWN_CONFIG, provider: instance });

    expect(notice()).toHaveTextContent(
      words["Failed systemd units can't say why"]!,
    );
    expect(notice()).toHaveTextContent(words["Add OneUptime's operators"]!);
    expect(notice()).not.toHaveTextContent("operators");
  });
});

describe("the Collector Config page", () => {
  const source: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Pages/Host/CollectorConfigView.tsx",
    ),
    "utf8",
  );

  test("reads its config's YAML, and draws the notice above config.yaml, saving through the page", () => {
    expect(source).toContain(
      "// What its journald receiver sends (HostCollectorJournaldOperatorsNotice).\n        configYaml: true,",
    );
    expect(source).toMatch(
      /<HostCollectorJournaldOperatorsNotice[\s\S]*?configYaml=\{current\?\.configYaml\}[\s\S]*?canEdit=\{updateGate\.isAllowed\}[\s\S]*?\/>\s*\{configYamlCard\}/,
    );
  });
});
