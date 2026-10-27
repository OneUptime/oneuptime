/*
 * The real sign-in pages, with the network stubbed, for SignInOptions.spec.ts:
 * Accounts' sign-in, single sign-on and sign-up pages, and a private status
 * page's sign-in. The pages, their components and their translations run
 * unchanged; only what they would ask a server, and the browser's passkey
 * prompt, are answered here.
 *
 * Query string:
 *   page=login|sso|register|statuspage   which page (login by default);
 *        |adminlogin                     adminlogin is the master admins'
 *                                        sign-in page (/accounts/admin-login)
 *   lang=<code>                          its language (English by default)
 *   ms=1                                 the server offers Sign in with Microsoft
 *                                        (server.js puts it in window.process.env)
 *   passkey=pending|cancel               what the passkey prompt does
 *   webauthn=0                           a browser without passkeys
 *   globalsso=1                          the server has an instance-wide provider
 *   ssorequired=1                        the whole server requires SSO (with one
 *                                        instance-wide provider unless providers= says)
 *   providers=<n>                        how many instance-wide providers (0 to 3)
 *   projectsso=1                         while SSO is required, some project has a
 *                                        provider of its own (the email lookup stays)
 *   lookup=found                         the email lookup finds providers in two
 *                                        projects (it finds none otherwise)
 *   sso=0                                the status page has no SSO provider
 *   firstaccount=1                       the self-hosted server has no account yet
 *                                        (POST /identity/first-account says so; the
 *                                        sign-up page waits for that answer)
 *
 * window.__setLanguage(code) switches the page's language in place, and
 * resolves once the page has drawn it.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import UserUtil from "Common/UI/Utils/User";
import Navigation from "Common/UI/Utils/Navigation";

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "login";

const never = () => {
  return new Promise(() => {});
};

// Nobody is signed in, and a password sign-in never answers.
UserUtil.isLoggedIn = () => {
  return false;
};
ModelAPI.createOrUpdate = async () => {
  return never();
};

// The server's instance-wide providers, as GET /identity/sign-in-methods lists them.
const PROVIDERS = [
  {
    type: "GlobalSSO",
    id: "33333333-3333-4333-8333-333333333333",
    name: "Okta",
    description: "Everyone at Acme",
  },
  {
    type: "GlobalOIDC",
    id: "44444444-4444-4444-8444-444444444444",
    name: "Google Workspace",
    description: "",
  },
  {
    type: "GlobalSSO",
    id: "55555555-5555-4555-8555-555555555555",
    name: "Microsoft Entra ID",
    description: "Sign in with Microsoft Entra ID",
  },
];

/*
 * What the email lookups find for an address with lookup=found: SAML
 * providers in two projects (GET /identity/service-provider-login), and an
 * OpenID Connect one in the first (.../service-provider-login-oidc).
 */
const ACME = { _id: "66666666-6666-4666-8666-666666666666", name: "Acme" };
const GLOBEX = {
  _id: "77777777-7777-4777-8777-777777777777",
  name: "Globex Corporation - Customer Support Operations (EMEA)",
};
const projectProvider = (id, name, description, project) => {
  return {
    _id: id,
    name: name,
    description: description,
    projectId: project._id,
    project: project,
  };
};
const LOOKUP_SAML = [
  projectProvider(
    "88888888-8888-4888-8888-888888888888",
    "Acme Okta",
    "Sign in with Acme Okta",
    ACME,
  ),
  projectProvider(
    "99999999-9999-4999-8999-999999999999",
    "Globex Microsoft Entra ID for contractors",
    "Use the email address your Globex manager gave you",
    GLOBEX,
  ),
];
const LOOKUP_OIDC = [
  projectProvider(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "Acme Google Workspace",
    "Sign in with Acme Google Workspace",
    ACME,
  ),
];

const isSsoRequired = params.get("ssorequired") === "1";
const providerCount = params.has("providers")
  ? Number(params.get("providers"))
  : isSsoRequired || params.get("globalsso") === "1"
    ? 1
    : 0;

API.get = async (options) => {
  const url = options.url.toString();
  // How the server signs people in: what every Accounts page reads first.
  if (url.endsWith("/sign-in-methods")) {
    return new HTTPResponse(
      200,
      {
        isSsoRequired: isSsoRequired,
        ssoProviders: PROVIDERS.slice(0, providerCount),
        hasProjectSsoProviders:
          isSsoRequired && params.get("projectsso") === "1",
      },
      {},
    );
  }
  // An email's projects' providers: none, unless lookup=found.
  if (url.includes("/service-provider-login")) {
    if (params.get("lookup") !== "found") {
      return new HTTPResponse(200, [], {});
    }
    return new HTTPResponse(
      200,
      url.includes("/service-provider-login-oidc") ? LOOKUP_OIDC : LOOKUP_SAML,
      {},
    );
  }
  return new HTTPResponse(200, [], {});
};

API.post = async (options) => {
  const url = options.url.toString();
  // Whether this self-hosted server waits for its first account: the sign-up page asks.
  if (url.endsWith("/first-account")) {
    return new HTTPResponse(
      200,
      { isAwaitingFirstAccount: params.get("firstaccount") === "1" },
      {},
    );
  }
  if (url.endsWith("/passkey-login-options")) {
    return new HTTPResponse(
      200,
      {
        options: {
          challenge: "-_8A",
          rpId: "localhost",
          timeout: 60000,
          userVerification: "required",
        },
      },
      {},
    );
  }
  return never();
};

// The browser's passkey prompt.
if (params.get("webauthn") === "0") {
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: undefined,
  });
} else {
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: {
      get: async (request) => {
        if (params.get("passkey") === "cancel") {
          throw new DOMException(
            "The prompt was dismissed.",
            "NotAllowedError",
          );
        }
        // Open until the page cancels it.
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
      // Not used on these pages; a browser with passkeys has it.
      create: async () => {
        throw new DOMException("Not used here.", "NotAllowedError");
      },
    },
  });
}

// What the Accounts app's App component does for every page.
function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="m-auto flex min-h-screen flex-col">
      <div className="flex flex-grow flex-col justify-center">
        {props.children}
      </div>
    </div>
  );
}

const loadStatusPage = async () => {
  const [i18nModule, utilModule, pageModule] = await Promise.all([
    import("../../../App/FeatureSet/StatusPage/src/Utils/i18n"),
    import("../../../App/FeatureSet/StatusPage/src/Utils/StatusPage"),
    import("../../../App/FeatureSet/StatusPage/src/Pages/Accounts/Login"),
  ]);
  const StatusPageUtil = utilModule.default;
  const LoginPage = pageModule.default;

  // A private status page, without a master password, signed out.
  StatusPageUtil.getStatusPageId = () => {
    return new ObjectID("11111111-1111-4111-8111-111111111111");
  };
  StatusPageUtil.isPrivateStatusPage = () => {
    return true;
  };
  StatusPageUtil.requiresMasterPassword = () => {
    return false;
  };
  StatusPageUtil.isPreviewPage = () => {
    return false;
  };
  Navigation.navigate = () => {};

  return {
    i18n: i18nModule.default,
    element: (
      <LoginPage
        statusPageName="Acme Status"
        logoFileId={undefined}
        forceSSO={false}
        hasEnabledSSOConfig={params.get("sso") !== "0"}
      />
    ),
  };
};

const loadAccountsPage = async () => {
  const pages = {
    login: () => {
      return import("../../../App/FeatureSet/Accounts/src/Pages/Login");
    },
    adminlogin: () => {
      return import("../../../App/FeatureSet/Accounts/src/Pages/Login");
    },
    sso: () => {
      return import("../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO");
    },
    register: () => {
      return import("../../../App/FeatureSet/Accounts/src/Pages/Register");
    },
  };
  // The name comes from the address: only the pages above are loaded.
  if (!Object.prototype.hasOwnProperty.call(pages, page)) {
    throw new Error(`No such page in this fixture: ${page}`);
  }

  const [i18nModule, pageModule] = await Promise.all([
    import("../../../App/FeatureSet/Accounts/src/Utils/i18n"),
    pages[page](),
  ]);
  const Page = pageModule.default;

  // The master admins' address renders the sign-in page as App.tsx does there.
  return {
    i18n: i18nModule.default,
    element:
      page === "adminlogin" ? <Page isMasterAdminSignIn={true} /> : <Page />,
  };
};

const start = async () => {
  const loaded =
    page === "statuspage" ? await loadStatusPage() : await loadAccountsPage();

  await loaded.i18n.changeLanguage(params.get("lang") || "en");

  window.__setLanguage = async (code) => {
    await loaded.i18n.changeLanguage(code);
    // Two frames: React commits the new words, then the browser lays them out.
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  };

  createRoot(document.getElementById("root")).render(
    <BrowserRouter>
      <Shell>{loaded.element}</Shell>
    </BrowserRouter>,
  );
};

start();
