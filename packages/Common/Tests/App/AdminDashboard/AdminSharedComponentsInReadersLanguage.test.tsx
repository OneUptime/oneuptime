import "@testing-library/jest-dom";
import {
  afterAll,
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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * THE ADMIN DASHBOARD'S SHARED FORMS, DIALOGS AND TABLES, IN THE READER'S
 * LANGUAGE (#7567).
 *
 * The Admin Dashboard draws forms, dialogs and table controls from Common
 * and looks their words up in its own locale files, which lacked hundreds
 * of them: an admin reading Italian edited the mail server's "Hostname"
 * among Italian words, and every language read an OIDC provider's fields
 * and what deleting a probe does in English. The guard
 * (App/Tests/AdminDashboard/AdminImportedCommonStringsLocales) holds every
 * shared file the Admin Dashboard's bundle draws to its locales; this
 * renders some of them as Admin pages draw them, with the Admin
 * Dashboard's own i18next set up (src/Utils/i18n.ts, its 18 locale files),
 * in German, Italian and Arabic, and reads all they draw - every text, and
 * every label, title and alt text, and a placeholder while its field is
 * empty: nothing the Dashboard words otherwise is left in English, and the
 * words this issue was about read as the Dashboard words them.
 *
 *   - Settings > Single Sign-On: an OIDC provider's form, both steps, with
 *     More fields open - the page's builder (OidcProviderFormFields with
 *     the instance-wide questions) through the real ModelForm;
 *   - Settings > Email > Host Settings: the real page and dialog, both
 *     steps, for a server signing in with a password and one signing in
 *     with OAuth (its grant and its OAuth app);
 *   - Settings > Global Probes: the real page and table, a row's ⋯ menu
 *     and its Delete.
 *
 * Only the network, the page chrome and the side menu are stand-ins.
 */

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

// The Admin Dashboard's reader: a master admin, with no project permissions.
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode | undefined }): ReactElement => {
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import EmailSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/Index";
import ProbesSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Probes/Index";
import AdminI18n from "../../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { EmailServerType } from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalOIDC from "../../../Models/DatabaseModels/GlobalOidc";
import Probe from "../../../Models/DatabaseModels/Probe";
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import { FORM_NEXT_BUTTON_TEST_ID } from "../../../UI/Components/Forms/Utils/SteppedFormFooter";
import { getOidcProviderFormFields } from "../../../UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "../../../UI/Components/Sso/SsoProviderFormFields";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ServerSetupChecklistLoader from "../../../UI/Utils/ServerSetupChecklist";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const WAIT: { timeout: number } = { timeout: 30000 };

// Three of the Admin Dashboard's languages: one of them read from the right.
const LANGUAGES: Array<string> = ["de", "it", "ar"];

// The Admin Dashboard's i18next, in a language, as its language menu sets it.
async function readIn(code: string): Promise<void> {
  await act(async () => {
    await AdminI18n.changeLanguage(code);
  });

  expect(AdminI18n.resolvedLanguage).toBe(code);
}

// A word as a shared component looks it up (UI/Utils/Translation).
function sharedWord(text: string): string {
  return AdminI18n.t(text, {
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  });
}

// An Admin page's own entry ("pages.settings.email.smtpCardTitle").
function pageWord(key: string): string {
  return AdminI18n.t(key);
}

// How the Dashboard words `text` in a language.
function dashboardWord(code: string, text: string): string {
  const worded: unknown = readDashboardLocale(code)[text];

  return typeof worded === "string" ? worded : text;
}

const DASHBOARD_ENGLISH: Record<string, string> = readDashboardLocale("en");

// The English of every word the Dashboard words otherwise in a language.
function wordedOtherwise(code: string): Set<string> {
  const worded: Record<string, string> = readDashboardLocale(code);
  const english: Set<string> = new Set<string>();

  for (const [key, text] of Object.entries(DASHBOARD_ENGLISH)) {
    if (
      key === text &&
      typeof worded[key] === "string" &&
      worded[key] !== text
    ) {
      english.add(text);
    }
  }

  return english;
}

// What a screen reader reads off an element, besides its text.
const READ_ATTRIBUTES: Array<string> = ["aria-label", "title", "alt"];

/*
 * Everything `root` draws: each text, each label, title and alt text, and
 * a placeholder while its field is empty (it is not drawn once the field
 * holds a value) - but not what a field holds, which is the record's.
 */
function drawnStrings(root: HTMLElement): Array<string> {
  const strings: Array<string> = [];
  const walker: TreeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );

  for (
    let node: Node | null = walker.nextNode();
    node;
    node = walker.nextNode()
  ) {
    if (!node.parentElement?.closest("textarea")) {
      strings.push(node.textContent || "");
    }
  }

  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of READ_ATTRIBUTES) {
      strings.push(element.getAttribute(attribute) || "");
    }

    if (
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement) &&
      element.value === ""
    ) {
      strings.push(element.placeholder);
    }
  }

  return strings
    .map((text: string): string => {
      return withoutIsolateMarks(text).trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
}

// What is drawn in English that the Dashboard words otherwise in `code`.
function leftInEnglish(code: string, drawn: Array<string>): Array<string> {
  const english: Set<string> = wordedOtherwise(code);

  return Array.from(
    new Set(
      drawn.filter((text: string): boolean => {
        return english.has(text);
      }),
    ),
  ).sort();
}

// Which of `words` are not drawn as the Dashboard words them in `code`.
function notWordedAsTheDashboard(
  code: string,
  drawn: Array<string>,
  words: Array<string>,
): Array<string> {
  return words.filter((english: string): boolean => {
    const worded: string = dashboardWord(code, english);

    return !drawn.some((text: string): boolean => {
      return text.includes(worded);
    });
  });
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// A form's More fields fold, opened.
async function openMoreFields(root: HTMLElement): Promise<void> {
  const title: string = sharedWord("More fields");
  const header: HTMLElement = within(root).getByRole("button", {
    name: new RegExp(escapeRegExp(title)),
  });

  if (header.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      fireEvent.click(header);
    });
    await settle();
  }
}

beforeEach(() => {
  window.localStorage.clear();
  TableFilterUrlState.resetClaimedKeys();
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await AdminI18n.changeLanguage("en");
});

/*
 * The check itself: English drawn where the Dashboard words it otherwise
 * is found - in a text, in a label, in an empty field's placeholder - and
 * the Dashboard's own word, a field's value and the placeholder of a field
 * that holds one are not.
 */
describe("what is left in English", () => {
  test("is found in a text, a label and an empty field's placeholder, and nothing else is", () => {
    const view: ReturnType<typeof render> = render(
      <div>
        <p>Issuer URL</p>
        <input aria-label="Client Secret" />
        <input placeholder="Scopes" />
        <p>{dashboardWord("de", "Discovery URL")}</p>
        <input placeholder="Client ID" defaultValue="oneuptime-admin" />
        <input defaultValue="Name Claim Name" />
        <textarea defaultValue="Email Claim Name" />
      </div>,
    );

    expect(leftInEnglish("de", drawnStrings(view.container))).toEqual([
      "Client Secret",
      "Issuer URL",
      "Scopes",
    ]);
  });
});

const OIDC_PROVIDER_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000d1",
);

// An instance-wide OIDC provider, as the server holds it.
const OIDC_PROVIDER: JSONObject = {
  _id: OIDC_PROVIDER_ID.toString(),
  name: "Acme Identity",
  description: "For Acme staff",
  issuerURL: "https://login.acme.example",
  clientId: "oneuptime-admin",
  clientSecret: "oidc-client-secret",
  isEnabled: true,
  discoveryURL: "https://login.acme.example/.well-known/openid-configuration",
  scopes: "openid email profile",
  emailClaimName: "email",
  nameClaimName: "name",
  disableSignUpWithSso: false,
  restrictToAttachedProjects: false,
};

// The OIDC provider form's own words, which every Admin language lacked.
const OIDC_WORDS: Array<string> = [
  "Issuer URL",
  "Your identity provider's issuer, exactly as the provider shows it. Pasting its discovery URL works too.",
  "Client ID",
  "OIDC client ID issued by your identity provider.",
  "Client Secret",
  "OIDC client secret issued by your identity provider. Stored encrypted at rest.",
  "Sign-in",
  "Discovery URL",
  "Scopes",
  "Email Claim Name",
  "Name Claim Name",
];

/*
 * Settings > Single Sign-On's OIDC provider form, as a provider's
 * configuration card opens it: the Provider step, then Sign-in with More
 * fields open. What both steps drew.
 */
async function readOidcForm(): Promise<Array<string>> {
  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<never> => {
      return { ...OIDC_PROVIDER } as never;
    });

  const view: ReturnType<typeof render> = render(
    <ModelForm<GlobalOIDC>
      modelType={GlobalOIDC}
      modelAPI={AdminModelAPI}
      id="global-oidc-form"
      name="Settings > Global OIDC"
      fields={getOidcProviderFormFields<GlobalOIDC>({
        withGlobalAccessSwitches: true,
      })}
      steps={getSsoProviderFormSteps<GlobalOIDC>()}
      formType={FormType.Update}
      modelIdToEdit={OIDC_PROVIDER_ID}
      onSuccess={(): void => {
        // Not saved here.
      }}
      submitButtonText={sharedWord("Save Changes")}
      disableAutofocus={true}
    />,
  );

  await within(view.container).findByDisplayValue(
    "https://login.acme.example",
    undefined,
    WAIT,
  );
  await settle();

  const provider: Array<string> = drawnStrings(view.container);

  await act(async () => {
    fireEvent.click(screen.getByTestId(FORM_NEXT_BUTTON_TEST_ID));
  });
  await settle();
  await openMoreFields(view.container);

  return [...provider, ...drawnStrings(view.container)];
}

// What the server holds for the instance's mail server.
let storedMailServer: Record<string, unknown> = {};

const SMTP_SERVER: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpTransportType: MailTransportType.SMTP,
  smtpHost: "smtp.acme.example",
  smtpPort: 465,
  smtpUsername: "postmaster@acme.example",
  smtpPassword: "smtp-password",
  isSMTPSecure: true,
  smtpAuthType: SMTPAuthenticationType.UsernamePassword,
  smtpOAuthProviderType: null,
  smtpClientId: null,
  smtpClientSecret: null,
  smtpTokenUrl: null,
  smtpScope: null,
  smtpFromEmail: "noreply@acme.example",
  smtpFromName: "Acme Status",
};

// A server on SMTP signing in with OAuth: its grant and its OAuth app.
const OAUTH_SERVER: Record<string, unknown> = {
  ...SMTP_SERVER,
  smtpPort: 587,
  isSMTPSecure: false,
  smtpPassword: null,
  smtpAuthType: SMTPAuthenticationType.OAuth,
  smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
  smtpClientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
  smtpClientSecret: "oauth-client-secret",
  smtpTokenUrl: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
  smtpScope: "https://outlook.office365.com/.default",
};

/*
 * Settings > Email > Host Settings: its dialog, on the Server step with
 * More fields open, then on its last step. What both drew.
 */
async function readHostSettingsDialog(
  server: Record<string, unknown>,
): Promise<Array<string>> {
  storedMailServer = { ...server };

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (options: unknown): Promise<never> => {
      const call: { modelType: { new (): BaseModel }; id: ObjectID } =
        options as { modelType: { new (): BaseModel }; id: ObjectID };
      const item: BaseModel = new call.modelType();

      (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();
      Object.assign(item, storedMailServer);

      return item as never;
    });
  jest.spyOn(ModelAPI, "getList").mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 10 } as never;
  });
  jest.spyOn(ModelAPI, "count").mockImplementation(async () => {
    return 0 as never;
  });
  // The page's test card reads the setup checklist; none, as when that read fails.
  jest.spyOn(ServerSetupChecklistLoader, "load").mockResolvedValue(null);

  render(<EmailSettings />);

  const cardTitle: string = pageWord("pages.settings.email.smtpCardTitle");
  const editButton: string = pageWord("pages.settings.email.smtpEditButton");
  let card: HTMLElement | undefined = undefined;

  await waitFor(() => {
    card = screen
      .getAllByTestId("card")
      .find((candidate: HTMLElement): boolean => {
        return within(candidate).queryByText(cardTitle) !== null;
      });

    expect(card).toBeDefined();
    expect(
      within(card!).getByRole("button", { name: editButton }),
    ).toBeVisible();
  }, WAIT);

  fireEvent.click(within(card!).getByRole("button", { name: editButton }));

  const dialog: HTMLElement = await screen.findByTestId(
    "modal",
    undefined,
    WAIT,
  );

  await waitFor(() => {
    expect(
      within(dialog).getByTestId("collapsible-section-summary"),
    ).not.toBeEmptyDOMElement();
  }, WAIT);
  await settle();
  await openMoreFields(dialog);

  const serverStep: Array<string> = drawnStrings(dialog);
  const steps: Array<HTMLElement> = within(
    within(dialog).getByRole("navigation", { name: sharedWord("Progress") }),
  ).getAllByRole("listitem");

  await act(async () => {
    fireEvent.click(steps[steps.length - 1]!);
  });
  await settle();

  return [...serverStep, ...drawnStrings(dialog)];
}

const PROBES: Array<{ _id: string; name: string }> = [
  { _id: "00000000-0000-4000-8000-0000000000e1", name: "fra-1" },
  { _id: "00000000-0000-4000-8000-0000000000e2", name: "iad-1" },
];

// Settings > Global Probes, with two probes listed.
async function renderProbes(): Promise<void> {
  window.history.replaceState(
    window.history.state,
    "",
    "/admin/settings/probes",
  );
  Navigation.setLocation({
    pathname: window.location.pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  });

  jest
    .spyOn(AdminModelAPI, "getList")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const request: { skip: number; limit: number } = data as {
        skip: number;
        limit: number;
      };
      const probes: Array<Probe> = PROBES.map(
        (row: { _id: string; name: string }): Probe => {
          const probe: Probe = new Probe();

          probe._id = row._id;
          probe.name = row.name;
          probe.isGlobalProbe = true;

          return probe;
        },
      );

      return {
        data: probes,
        count: probes.length,
        skip: request.skip,
        limit: request.limit,
      } as never;
    });
  jest.spyOn(AdminModelAPI, "count").mockImplementation(async () => {
    return PROBES.length as never;
  });

  await act(async () => {
    render(
      <MemoryRouter>
        <ProbesSettings />
      </MemoryRouter>,
    );
  });

  await screen.findAllByText(PROBES[1]!.name, undefined, WAIT);
  await settle();
}

// The table row of a probe, by its name.
function rowOf(name: string): HTMLElement {
  const cell: HTMLElement | undefined = screen
    .getAllByText(name)
    .find((element: HTMLElement): boolean => {
      return Boolean(element.closest("tr"));
    });

  if (!cell) {
    throw new Error(`No table row named ${name}`);
  }

  return cell.closest("tr") as HTMLElement;
}

describe.each(LANGUAGES)("in %s", (code: string) => {
  beforeEach(async () => {
    await readIn(code);
  });

  test("Settings > Single Sign-On: an OIDC provider's form reads as the Dashboard words it, none of it in English", async () => {
    const drawn: Array<string> = await readOidcForm();

    expect({ code, leftInEnglish: leftInEnglish(code, drawn) }).toEqual({
      code,
      leftInEnglish: [],
    });
    expect({
      code,
      notWorded: notWordedAsTheDashboard(code, drawn, OIDC_WORDS),
    }).toEqual({ code, notWorded: [] });
  });

  test("Settings > Email > Host Settings: the mail server's dialog reads as the Dashboard words it, none of it in English", async () => {
    const drawn: Array<string> = await readHostSettingsDialog(SMTP_SERVER);

    expect({ code, leftInEnglish: leftInEnglish(code, drawn) }).toEqual({
      code,
      leftInEnglish: [],
    });
    // Its Hostname was the one word left in English in Italian.
    expect({
      code,
      notWorded: notWordedAsTheDashboard(code, drawn, [
        "Hostname",
        "Port",
        "Username",
        "Password",
      ]),
    }).toEqual({ code, notWorded: [] });
  });

  test("Settings > Email > Host Settings: a server signing in with OAuth reads its grant and OAuth app as the Dashboard words them, none of it in English", async () => {
    const drawn: Array<string> = await readHostSettingsDialog(OAUTH_SERVER);

    expect({ code, leftInEnglish: leftInEnglish(code, drawn) }).toEqual({
      code,
      leftInEnglish: [],
    });
    expect({
      code,
      notWorded: notWordedAsTheDashboard(code, drawn, [
        "Client Credentials",
        "OAuth Provider Type",
        "OAuth Client ID",
      ]),
    }).toEqual({ code, notWorded: [] });
  });

  test("Settings > Global Probes: the table and a row's Delete say what deleting a probe does as the Dashboard words it, none of it in English", async () => {
    await renderProbes();

    const table: Array<string> = drawnStrings(document.body);

    fireEvent.click(
      within(rowOf(PROBES[0]!.name)).getByTestId("row-actions-more-button"),
    );

    const menu: Array<string> = drawnStrings(screen.getByRole("menu"));

    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: sharedWord("Delete"),
      }),
    );

    const dialog: HTMLElement = await screen.findByRole(
      "dialog",
      undefined,
      WAIT,
    );
    const drawn: Array<string> = [...table, ...menu, ...drawnStrings(dialog)];

    expect({ code, leftInEnglish: leftInEnglish(code, drawn) }).toEqual({
      code,
      leftInEnglish: [],
    });
    expect({
      code,
      notWorded: notWordedAsTheDashboard(code, drawn, [
        "Deleting a probe takes it off every monitor it checks.",
      ]),
    }).toEqual({ code, notWorded: [] });
  });
});
