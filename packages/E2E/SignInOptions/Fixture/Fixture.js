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
 *   folded=1                             the sign-in page as a first visit draws it:
 *                                        "More ways to sign in" folded (#9023). It is
 *                                        open otherwise, as a browser that left it
 *                                        open finds it, so single sign-on and the
 *                                        passkey are drawn
 *   enrolment=1                          a sign-in that sets up a second step
 *                                        (#9764, SecurityKeyEnrolment.spec.ts): the
 *                                        password sign-in and its second steps go
 *                                        over the real network - with apihost=self
 *                                        (server.js) to this fixture's own address,
 *                                        where the spec answers them - and the
 *                                        browser's own WebAuthn runs, for the spec's
 *                                        virtual authenticator. The rest is answered
 *                                        here, as for every page
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
import { MORE_WAYS_TO_SIGN_IN_OPEN_KEY } from "Common/Types/Accounts/MoreWaysToSignIn";

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "login";
// A sign-in that sets up a second step, over the real network (see above).
const isEnrolment = params.get("enrolment") === "1";

// "More ways to sign in", as this browser left it: open unless folded=1.
if (params.get("folded") === "1") {
  window.localStorage.removeItem(MORE_WAYS_TO_SIGN_IN_OPEN_KEY);
} else {
  window.localStorage.setItem(MORE_WAYS_TO_SIGN_IN_OPEN_KEY, "true");
}

const never = () => {
  return new Promise(() => {});
};

/*
 * Nobody is signed in, and a password sign-in never answers - but in an
 * enrolment, where the spec answers it.
 */
UserUtil.isLoggedIn = () => {
  return false;
};
if (!isEnrolment) {
  ModelAPI.createOrUpdate = async () => {
    return never();
  };
}

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

// An enrolment's second steps go over the real network, to the spec.
const realPost = API.post;

API.post = async (options) => {
  const url = options.url.toString();
  if (isEnrolment) {
    return realPost.call(API, options);
  }
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

/*
 * The browser's passkey prompt: answered here, but in an enrolment, whose
 * spec drives the browser's own with a virtual authenticator.
 */
if (params.get("webauthn") === "0") {
  Object.defineProperty(window, "PublicKeyCredential", {
    configurable: true,
    value: undefined,
  });
} else if (!isEnrolment) {
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
    i18nReady: i18nModule.i18nReady,
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

/*
 * The page the address names, one static import each: the name comes from
 * the address, so it picks among these and nothing else is loaded or called
 * (a lookup by name in an object of loaders is a dynamic call to CodeQL,
 * #2416, as the locale loaders' were, #2408 and #2409).
 */
const importAccountsPage = (name) => {
  switch (name) {
    case "login":
    case "adminlogin":
      return import("../../../App/FeatureSet/Accounts/src/Pages/Login");
    case "sso":
      return import("../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO");
    case "register":
      return import("../../../App/FeatureSet/Accounts/src/Pages/Register");
    default:
      throw new Error(`No such page in this fixture: ${name}`);
  }
};

const loadAccountsPage = async () => {
  const [i18nModule, pageModule] = await Promise.all([
    import("../../../App/FeatureSet/Accounts/src/Utils/i18n"),
    importAccountsPage(page),
  ]);
  const Page = pageModule.default;

  // The master admins' address renders the sign-in page as App.tsx does there.
  return {
    i18n: i18nModule.default,
    i18nReady: i18nModule.i18nReady,
    element:
      page === "adminlogin" ? <Page isMasterAdminSignIn={true} /> : <Page />,
  };
};

const start = async () => {
  const loaded =
    page === "statuspage" ? await loadStatusPage() : await loadAccountsPage();

  /*
   * As the page's own src/Index.tsx starts: every language but English is a
   * chunk of its own (Utils/i18n.ts), so i18n first settles on the language
   * it detects - in the product, the one the last page left in localStorage
   * - and only then is this page's language set. Set before that, the
   * detected language's chunk could arrive last and switch the page back to
   * it. Here the detector is Common's stand-in (server.js), which answers
   * English and stores nothing, so start-up settles at once; waiting keeps
   * the page's own order all the same.
   */
  await loaded.i18nReady.catch(() => {});
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
