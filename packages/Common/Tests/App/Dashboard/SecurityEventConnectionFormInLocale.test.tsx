import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import SecurityEventConnectionFormModal from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionFormModal";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ObjectID from "../../../Types/ObjectID";
import {
  ConnectorField,
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { ComponentProps as CodeEditorProps } from "../../../UI/Components/CodeEditor/CodeEditor";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { escapeRegExp } from "../../../Utils/RegExpEscape";

/*
 * THE CONNECTION FORM IN THE READER'S LANGUAGE (#6700) - from the
 * Dashboard's shipped German locale.
 *
 * The connection form is generated from the connector catalog, and the
 * catalog's words were never keys: a German security engineer adding a
 * Microsoft Sentinel connection read German steps and buttons around
 * "Import Sentinel incidents from a Log Analytics workspace as Incident
 * Finding events.", "Resource group", "The resource group that contains the
 * Log Analytics workspace." and "Azure public cloud". Now each provider's
 * description, each setting's title, description and choice, and a
 * placeholder written in words are keys, and the form draws them in German -
 * on create, on edit, and in the sentences built around them ("Remove the
 * stored {{field}}", "{{description}} Leave blank to keep the stored value.").
 * The English form is pinned by SecurityEventConnectionFormModal.test.tsx.
 */

// A JSON field renders Monaco, which cannot run in jsdom: a labelled textarea.
jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          placeholder={props.placeholder}
          value={props.value ?? props.initialValue ?? ""}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
            props.onChange?.(event.target.value);
          }}
          onBlur={props.onBlur}
        />
      );
    },
  };
});

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");

/*
 * What the German Dashboard draws for `key`, filled with `values`. A word
 * German writes as English does (Cloud, Region) is drawn so.
 */
function german(key: string, values: Record<string, string> = {}): string {
  const text: string | undefined = DE[key];

  expect({
    key,
    inGerman: typeof text === "string" && text.length > 0,
  }).toEqual({ key, inGerman: true });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

// German's own words for `key`: it must not read as the English.
function worded(key: string, values: Record<string, string> = {}): string {
  const text: string = german(key, values);

  expect({ key, worded: DE[key] !== EN[key] }).toEqual({ key, worded: true });

  return text;
}

// A field's label as German draws it: the title, then any "optional" mark.
function labelled(title: string): RegExp {
  return new RegExp(`^${escapeRegExp(german(title))}`);
}

// The catalog's English a German page must not show: what German words otherwise.
function englishOf(texts: Array<string>): Array<string> {
  return texts.filter((text: string): boolean => {
    return DE[text] !== undefined && DE[text] !== text;
  });
}

function expectNoEnglish(element: HTMLElement, texts: Array<string>): void {
  const shown: string = element.textContent || "";

  expect(
    englishOf(texts).filter((text: string): boolean => {
      return shown.includes(text);
    }),
  ).toEqual([]);
}

function fieldWords(fields: Array<ConnectorField>): Array<string> {
  return fields.flatMap((field: ConnectorField): Array<string> => {
    return [field.title, field.description];
  });
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";

function connectionOf(
  provider: SecurityEventConnectorProvider,
  name: string,
  config: Record<string, string> = {},
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID;
  connection.projectId = PROJECT_ID;
  connection.name = name;
  connection.provider = provider;
  connection.config = config;
  connection.isEnabled = true;
  connection.pollIntervalInMinutes = 5;
  connection.alertingOnly = true;
  return connection;
}

function definitionOf(
  provider: SecurityEventConnectorProvider,
): SecurityEventConnectorDefinition {
  return getSecurityEventConnectorDefinition(
    provider,
  ) as SecurityEventConnectorDefinition;
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

async function next(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: worded("Next") }),
    );
  });
}

async function chooseProvider(title: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(title) }));
  });
  await waitFor((): void => {
    expect(
      screen.getByRole("radio", { name: new RegExp(title) }),
    ).toHaveAttribute("aria-checked", "true");
  });
}

// The Connection step's More fields, where a Microsoft connection's Cloud waits.
async function openMoreFields(): Promise<void> {
  const more: HTMLElement | null = within(dialog()).queryByRole("button", {
    name: new RegExp(`^${escapeRegExp(worded("More fields"))}`),
  });

  if (more && more.getAttribute("aria-expanded") !== "true") {
    await act(async (): Promise<void> => {
      fireEvent.click(more);
    });
  }
}

function fill(title: string, value: string): void {
  fireEvent.change(screen.getByLabelText(labelled(title)), {
    target: { value },
  });
}

async function renderModal(
  props: {
    connection?: SecurityEventConnection;
    credentialsOnly?: boolean;
  } = {},
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <SecurityEventConnectionFormModal
          connection={props.connection}
          credentialsOnly={props.credentialsOnly}
          onClose={(): void => {}}
          onSaved={(): void => {}}
        />
      </MemoryRouter>,
    );
  });
  await waitFor((): void => {
    expect(dialog()).toBeVisible();
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ "project-id": PROJECT_ID.toString() });
  jest
    .spyOn(ModelAPI, "create")
    .mockResolvedValue(new HTTPResponse(200, {}, {}));
  jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue(new HTTPResponse(200, {}, {}));
  jest.spyOn(API, "post").mockResolvedValue(new HTTPResponse(200, {}, {}));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("creating a connection in German", () => {
  test("the Provider step describes every provider in German", async () => {
    await renderModal();

    const group: HTMLElement = screen.getByRole("radiogroup");

    for (const definition of SecurityEventConnectorCatalog) {
      const tile: HTMLElement = within(group).getByRole("radio", {
        name: new RegExp(escapeRegExp(definition.title)),
      });

      // The name stays as the vendor writes it; what it imports is German.
      expect(tile).toHaveTextContent(definition.title);
      expect(tile).toHaveTextContent(worded(definition.description));
      expect(tile).not.toHaveTextContent(definition.description);
    }

    expect(dialog()).toHaveTextContent(
      worded(
        "The security product to import from. Each provider has its own setup guide with the roles and values it needs.",
      ),
    );
    expectNoEnglish(dialog(), [
      ...SecurityEventConnectorCatalog.map(
        (definition: SecurityEventConnectorDefinition): string => {
          return definition.description;
        },
      ),
      "The security product to import from. Each provider has its own setup guide with the roles and values it needs.",
    ]);
  });

  test("Microsoft Sentinel: every setting, its description and the cloud's choices in German, then the client secret", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });
    const sentinel: SecurityEventConnectorDefinition = definitionOf(
      SecurityEventConnectorProvider.MicrosoftSentinel,
    );

    await renderModal();
    await chooseProvider("Microsoft Sentinel");
    await next();

    for (const title of [
      "Directory (tenant) ID",
      "Application (client) ID",
      "Subscription ID",
      "Resource group",
      "Workspace name",
    ]) {
      expect(screen.getByLabelText(labelled(title))).toBeVisible();
    }

    expect(dialog()).toHaveTextContent(
      worded("The resource group of the Log Analytics workspace."),
    );
    expect(german("Resource group")).toBe("Ressourcengruppe");

    // Cloud waits under More fields, its choices German too.
    await openMoreFields();
    expect(dialog()).toHaveTextContent(
      worded("Which Azure cloud hosts the tenant and workspace."),
    );

    const cloud: HTMLElement = screen.getByRole("combobox", {
      name: labelled("Cloud"),
    });

    expect(
      cloud
        .closest(".ou-select__control")
        ?.querySelector(".ou-select__single-value")?.textContent,
    ).toBe(worded("Azure public cloud"));

    await user.click(cloud);
    const listbox: HTMLElement = await screen.findByRole("listbox");

    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.textContent || "";
        }),
    ).toEqual([worded("Azure public cloud"), worded("Azure Government (US)")]);
    await user.click(
      within(listbox).getByRole("option", {
        name: worded("Azure public cloud"),
      }),
    );

    expectNoEnglish(dialog(), [
      sentinel.description,
      ...fieldWords(sentinel.configFields),
      "Azure public cloud",
      "Azure Government (US)",
    ]);

    fill("Directory (tenant) ID", "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c");
    fill("Application (client) ID", "00001111-aaaa-2222-bbbb-3333cccc4444");
    fill("Subscription ID", "c0ffee00-1111-4222-8333-444455556666");
    fill("Resource group", "security-rg");
    fill("Workspace name", "sentinel-ws");
    await next();

    // The Credentials step: the secret's title and description in German.
    expect(screen.getByLabelText(labelled("Client secret"))).toBeVisible();
    expect(dialog()).toHaveTextContent(
      worded("A client secret of the app registration."),
    );
    expectNoEnglish(dialog(), fieldWords(sentinel.secretFields));
  });

  test("the last step's button creates the connection in German", async () => {
    await renderModal();
    await chooseProvider("Microsoft Sentinel");
    await next();
    fill("Directory (tenant) ID", "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c");
    fill("Application (client) ID", "00001111-aaaa-2222-bbbb-3333cccc4444");
    fill("Subscription ID", "c0ffee00-1111-4222-8333-444455556666");
    fill("Resource group", "security-rg");
    fill("Workspace name", "sentinel-ws");
    await next();
    fill("Client secret", "a-client-secret");
    await next();

    // The Polling step: the action that creates it, read as German reads it.
    expect(
      within(dialog()).getByRole("button", {
        name: worded("Create connection"),
      }),
    ).toBeVisible();
    expect(german("Create connection")).toBe("Verbindung erstellen");
    expect(
      within(dialog()).queryByRole("button", { name: "Create connection" }),
    ).toBeNull();
  });

  test("Google SecOps: the Region placeholder is German, its region codes as written", async () => {
    await renderModal();
    await chooseProvider("Google SecOps");
    await next();

    const region: HTMLElement = screen.getByRole("combobox", {
      name: labelled("Region"),
    });

    expect(
      region
        .closest(".ou-select__control")
        ?.querySelector(".ou-select__placeholder")?.textContent,
    ).toBe(worded("Select a region"));
    expectNoEnglish(dialog(), [
      "Select a region",
      ...fieldWords(
        definitionOf(SecurityEventConnectorProvider.GoogleSecOps).configFields,
      ),
    ]);
  });

  test.each(
    SecurityEventConnectorCatalog.map(
      (definition: SecurityEventConnectorDefinition): [string] => {
        return [definition.title];
      },
    ),
  )(
    "%s: the Connection step draws every setting and description in German",
    async (title: string) => {
      const definition: SecurityEventConnectorDefinition =
        SecurityEventConnectorCatalog.find(
          (candidate: SecurityEventConnectorDefinition): boolean => {
            return candidate.title === title;
          },
        ) as SecurityEventConnectorDefinition;

      await renderModal();
      await chooseProvider(title);
      await next();
      await openMoreFields();

      // An option waits on the last step, with the connection's other options.
      const settings: Array<ConnectorField> = definition.configFields.filter(
        (field: ConnectorField): boolean => {
          return !field.isOption;
        },
      );

      expect(settings.length).toBeGreaterThan(0);

      for (const field of settings) {
        expect({ field: field.key, title: dialog().textContent }).toEqual({
          field: field.key,
          title: expect.stringContaining(german(field.title)),
        });
        expect({ field: field.key, description: dialog().textContent }).toEqual(
          {
            field: field.key,
            description: expect.stringContaining(worded(field.description)),
          },
        );
      }

      expectNoEnglish(dialog(), fieldWords(settings));
    },
  );
});

describe("editing a connection in German", () => {
  test.each([
    [
      SecurityEventConnectorProvider.MicrosoftEntraId,
      {
        tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
        clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
        cloud: "public",
      },
    ],
    [
      SecurityEventConnectorProvider.GoogleWorkspace,
      { adminEmail: "admin@example.com" },
    ],
    [
      SecurityEventConnectorProvider.GoogleSecOps,
      {
        region: "europe",
        instanceResourceName: "projects/acme/locations/europe/instances/i",
      },
    ],
  ])(
    "%s: the Polling step draws the connection's options in German",
    async (provider: string, config: Record<string, string>) => {
      const definition: SecurityEventConnectorDefinition = definitionOf(
        provider as SecurityEventConnectorProvider,
      );
      const options: Array<ConnectorField> = definition.configFields.filter(
        (field: ConnectorField): boolean => {
          return Boolean(field.isOption);
        },
      );

      await renderModal({
        connection: connectionOf(
          provider as SecurityEventConnectorProvider,
          "Contoso",
          config,
        ),
      });
      await next();
      await next();

      expect(options.length).toBeGreaterThan(0);

      for (const field of options) {
        expect(dialog()).toHaveTextContent(worded(field.title));
        expect(dialog()).toHaveTextContent(worded(field.description));
      }

      expectNoEnglish(dialog(), fieldWords(options));
    },
  );

  test("Splunk: the settings in German, the stored secrets' switches and Leave blank sentences named in German", async () => {
    const splunk: SecurityEventConnectorDefinition = definitionOf(
      SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    );

    await renderModal({
      connection: connectionOf(
        SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
        "Splunk ES",
        {
          url: "https://splunk.example.com:8089",
          searchString: "index=notable",
        },
      ),
    });

    expect(
      screen.getByRole("dialog", {
        name: worded("Edit connection: {{name}}", { name: "Splunk ES" }),
      }),
    ).toBeVisible();
    expect(
      screen.getByLabelText(labelled("Splunk management URL")),
    ).toHaveValue("https://splunk.example.com:8089");
    expectNoEnglish(dialog(), fieldWords(splunk.configFields));

    await next();

    // Each optional secret's switch is one German sentence around its title.
    for (const title of ["Authentication token", "Password"]) {
      expect(
        screen.getByRole("switch", {
          name: new RegExp(
            `^${escapeRegExp(
              worded("Remove the stored {{field}}", { field: worded(title) }),
            )}`,
          ),
        }),
      ).toBeInTheDocument();
    }

    // A stored secret's description says, in German, a blank keeps it.
    expect(dialog()).toHaveTextContent(
      worded("{{description}} Leave blank to keep the stored value.", {
        description: worded(
          "A Splunk authentication token (Settings > Tokens). Leave empty when using username and password.",
        ),
      }),
    );
    expect(
      screen.getByLabelText(labelled("Authentication token")),
    ).toHaveAttribute("placeholder", worded("Unchanged"));
    expectNoEnglish(dialog(), [
      ...fieldWords(splunk.secretFields),
      "Remove the stored",
      "Leave blank to keep the stored value.",
    ]);
  });

  test("an edit's action and new credentials' action are German too", async () => {
    await renderModal({
      connection: connectionOf(
        SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
        "Splunk ES",
        {
          url: "https://splunk.example.com:8089",
          searchString: "index=notable",
        },
      ),
    });
    await next();
    await next();

    expect(
      within(dialog()).getByRole("button", { name: worded("Save changes") }),
    ).toBeVisible();
    expect(
      within(dialog()).queryByRole("button", { name: "Save changes" }),
    ).toBeNull();
    cleanup();

    await renderModal({
      connection: connectionOf(
        SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
        "Splunk ES",
      ),
      credentialsOnly: true,
    });

    expect(
      within(dialog()).getByRole("button", {
        name: worded("Update credentials"),
      }),
    ).toBeVisible();
    expect(
      within(dialog()).queryByRole("button", { name: "Update credentials" }),
    ).toBeNull();
  });

  test.each(
    SecurityEventConnectorCatalog.map(
      (definition: SecurityEventConnectorDefinition): [string, string] => {
        return [definition.title, definition.provider];
      },
    ),
  )(
    "%s: Update credentials draws every secret's title and description in German",
    async (title: string, provider: string) => {
      const definition: SecurityEventConnectorDefinition = definitionOf(
        provider as SecurityEventConnectorProvider,
      );

      await renderModal({
        connection: connectionOf(
          provider as SecurityEventConnectorProvider,
          `${title} connection`,
        ),
        credentialsOnly: true,
      });

      for (const field of definition.secretFields) {
        expect({ field: field.key, text: dialog().textContent }).toEqual({
          field: field.key,
          text: expect.stringContaining(
            worded("{{description}} Leave blank to keep the stored value.", {
              description: worded(field.description),
            }),
          ),
        });
        expect(dialog()).toHaveTextContent(german(field.title));
      }

      expect(definition.secretFields.length).toBeGreaterThan(0);
      expectNoEnglish(dialog(), fieldWords(definition.secretFields));
    },
  );
});
