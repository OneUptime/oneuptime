/*
 * Offline fixture for User Profile > Security (#8796): the Dashboard's real
 * Two-factor authentication page (Pages/Global/UserProfile/TwoFactorAuth)
 * and Passkeys page (Pages/Global/UserProfile/Passkeys), inside the User
 * Profile layout and its side menu, mounted under their RouteMap paths.
 * Only the data boundary (ModelAPI / API) and the signed-in user are
 * replaced.
 *
 * Scenarios, parsed once per page load:
 *
 *   ?lang=   de, ar or fa: the Dashboard's German, Arabic or Persian words,
 *            loaded as the Dashboard loads a locale, dates with them;
 *            Arabic and Persian read right to left. English otherwise.
 *   ?state=  set (default): two-factor authentication on, an authenticator
 *            app ready and one whose setup is incomplete, a security key, two
 *            passkeys, and seven of ten backup codes left. low: the same with
 *            two left. new: an account with nothing set up. pending:
 *            two-factor authentication on with nothing set up, as an
 *            administrator's requirement leaves it (#9666). sso: what "set"
 *            holds, on a server that requires SSO and signs in with "Okta",
 *            so the person's sign-in is managed by it (#9688).
 *   ?theme=  dark adds html.dark (server.js).
 *
 * Recorded on window.__securityPageFixture: every list read (`lists`: the
 * table), every create (`creates`), every update (`updates`), every API
 * request (`api`), and anything the fixture does not model (`unhandled`;
 * the spec fails on any).
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Outlet,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import UserProfileLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Layout";
import TwoFactorAuthPage from "../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/TwoFactorAuth";
import PasskeysPage from "../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Passkeys";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import TableView from "Common/Models/DatabaseModels/TableView";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { SIGN_IN_MANAGEMENT_API_ROUTE } from "Common/Types/SSO/SsoManagedSignIn";
import TwoFactorAuthSetupUtil, {
  TWO_FACTOR_AUTH_STATUS_API_ROUTE,
} from "Common/Types/TwoFactorAuthSetup";
import API from "Common/UI/Utils/API/API";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";

const USER_ID = "80000000-0000-4000-8000-0000000008a1";

const params = new URLSearchParams(window.location.search);
const language = ["de", "ar", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const state = ["low", "new", "pending", "sso"].includes(params.get("state"))
  ? params.get("state")
  : "set";

const fixture = {
  scenario: { language, state },
  lists: [],
  creates: [],
  updates: [],
  api: [],
  unhandled: [],
};
window.__securityPageFixture = fixture;

// ---- what the server holds ---------------------------------------------------

function tableName(modelType) {
  return String(new modelType().tableName);
}

function record(ModelType, fields) {
  const item = new ModelType();
  for (const [key, value] of Object.entries(fields)) {
    item[key] = value;
  }
  return item;
}

// Nothing set up: a new account, or one an administrator required it of.
const isNew = state === "new" || state === "pending";

const account = { enableTwoFactorAuth: state !== "new" };

// The authenticator app the guided setup adds, as the server issues one.
const NEW_AUTHENTICATOR_ID = "81000000-0000-4000-8000-0000000008c1";
const NEW_AUTHENTICATOR_OTP_URL =
  "otpauth://totp/OneUptime:maya.chen%40acme-shop.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=OneUptime&algorithm=SHA1&digits=6&period=30";

const authenticatorApps = isNew
  ? []
  : [
      record(UserTotpAuth, {
        _id: "81000000-0000-4000-8000-0000000008a1",
        userId: new ObjectID(USER_ID),
        name: "1Password",
        isVerified: true,
        createdAt: new Date("2026-10-02T08:15:00Z"),
      }),
      record(UserTotpAuth, {
        _id: "81000000-0000-4000-8000-0000000008a2",
        userId: new ObjectID(USER_ID),
        name: "Work phone",
        isVerified: false,
        createdAt: new Date("2026-11-12T16:40:00Z"),
      }),
    ];

const securityKeys = isNew
  ? []
  : [
      record(UserWebAuthn, {
        _id: "82000000-0000-4000-8000-0000000008a1",
        userId: new ObjectID(USER_ID),
        name: "YubiKey 5C",
        isVerified: true,
        isPasskey: false,
        createdAt: new Date("2026-10-02T08:20:00Z"),
      }),
    ];

const passkeys = isNew
  ? []
  : [
      record(UserWebAuthn, {
        _id: "82000000-0000-4000-8000-0000000008b1",
        userId: new ObjectID(USER_ID),
        name: "MacBook Pro",
        isVerified: true,
        isPasskey: true,
        createdAt: new Date("2026-09-18T10:05:00Z"),
      }),
      record(UserWebAuthn, {
        _id: "82000000-0000-4000-8000-0000000008b2",
        userId: new ObjectID(USER_ID),
        name: "Pixel 9",
        isVerified: true,
        isPasskey: true,
        createdAt: new Date("2026-11-03T19:30:00Z"),
      }),
    ];

const backupCodes = isNew
  ? { total: 0, unused: 0, generatedAt: null }
  : {
      total: 10,
      unused: state === "low" ? 2 : 7,
      generatedAt: "2026-10-02T08:21:00.000Z",
    };

/*
 * What a sign-in's second step can ask for (UserService
 * .countVerifiedTwoFactorAuthMethods): authenticator apps whose code was
 * entered, security keys and passkeys.
 */
function verifiedMethodCount() {
  return [...authenticatorApps, ...securityKeys, ...passkeys].filter((item) => {
    return item.isVerified === true;
  }).length;
}

// ---- the signed-in user and the data boundary ---------------------------------

window.localStorage.setItem("user_id", USER_ID);
window.localStorage.setItem("user_name", "Maya Chen");

UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID(USER_ID);
};
UserUtil.getName = () => {
  return "Maya Chen";
};
UserUtil.getEmail = () => {
  return "maya.chen@acme-shop.example";
};
// What the server grants every signed-in user (AccessTokenService).
PermissionUtil.getAllPermissions = () => {
  return [Permission.Public, Permission.User, Permission.CurrentUser];
};

function list(items, options) {
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  fixture.lists.push(name);

  if (name === tableName(UserTotpAuth)) {
    return list(authenticatorApps, options);
  }

  if (name === tableName(UserWebAuthn)) {
    const isPasskey = String(options.query?.isPasskey?.value) === "true";

    return list(isPasskey ? passkeys : securityKeys, options);
  }

  if (name === tableName(TableView)) {
    return list([], options);
  }

  fixture.unhandled.push({ kind: "getList", table: name });
  return list([], options);
};

ModelAPI.count = async (options) => {
  fixture.unhandled.push({
    kind: "count",
    table: tableName(options.modelType),
  });
  return 0;
};

ModelAPI.getItem = async (options) => {
  const name = tableName(options.modelType);

  if (name === tableName(User)) {
    return record(User, { _id: USER_ID, ...account });
  }

  if (name === tableName(UserTotpAuth)) {
    return (
      authenticatorApps.find((item) => {
        return String(item._id) === String(options.id);
      }) || null
    );
  }

  fixture.unhandled.push({ kind: "getItem", table: name });
  return null;
};

// The guided setup's authenticator app (#9666): saved unverified, with its code.
ModelAPI.create = async (options) => {
  const name = tableName(options.modelType);
  fixture.creates.push({ table: name, name: options.model?.name });

  if (name === tableName(UserTotpAuth)) {
    const created = record(UserTotpAuth, {
      _id: NEW_AUTHENTICATOR_ID,
      userId: new ObjectID(USER_ID),
      name: options.model?.name,
      isVerified: false,
      twoFactorOtpUrl: NEW_AUTHENTICATOR_OTP_URL,
      createdAt: new Date("2026-11-19T09:00:00Z"),
    });
    authenticatorApps.push(created);

    // The constructor reads its data as JSON; the page reads the model.
    const response = new HTTPResponse(200, {}, {});
    response.data = created;
    return response;
  }

  fixture.unhandled.push({ kind: "create", table: name });
  return new HTTPResponse(200, {}, {});
};

ModelAPI.updateById = async (options) => {
  const name = tableName(options.modelType);
  fixture.updates.push({
    table: name,
    data: JSON.parse(JSON.stringify(options.data)),
  });

  if (name === tableName(User)) {
    Object.assign(account, options.data);
    return new HTTPResponse(200, {}, {});
  }

  fixture.unhandled.push({ kind: "updateById", table: name });
  return new HTTPResponse(200, {}, {});
};

function handleApi(method, options) {
  const url = String(options.url);
  fixture.api.push({ method, url });

  if (method === "GET" && url.endsWith("/user-two-factor-backup-code/status")) {
    return new HTTPResponse(200, backupCodes, {});
  }

  // Where the person stands: on or off, and what is set up behind it.
  if (method === "GET" && url.endsWith(TWO_FACTOR_AUTH_STATUS_API_ROUTE)) {
    const count = verifiedMethodCount();

    return new HTTPResponse(
      200,
      {
        status: TwoFactorAuthSetupUtil.getStatus({
          isTwoFactorAuthEnabled: account.enableTwoFactorAuth === true,
          verifiedMethodCount: count,
        }),
        verifiedMethodCount: count,
      },
      {},
    );
  }

  // Who manages the person's sign-in: the server's SSO, in the sso scenario.
  if (method === "GET" && url.endsWith(SIGN_IN_MANAGEMENT_API_ROUTE)) {
    return new HTTPResponse(
      200,
      state === "sso"
        ? { isManagedBySso: true, ssoProviderNames: ["Okta"] }
        : { isManagedBySso: false, ssoProviderNames: [] },
      {},
    );
  }

  /*
   * The authenticator app's first code: any six digits (the server checks
   * them). The first second step comes with the account's backup codes.
   */
  if (method === "POST" && url.endsWith("/user-totp-auth/validate")) {
    const app = authenticatorApps.find((item) => {
      return String(item._id) === String(options.data?.id);
    });

    if (!app || !/^\d{6}$/.test(String(options.data?.code))) {
      fixture.unhandled.push({ kind: "api", method, url });
      return new HTTPResponse(200, {}, {});
    }

    const isFirst = verifiedMethodCount() === 0;
    app.isVerified = true;

    if (!isFirst) {
      return new HTTPResponse(200, {}, {});
    }

    backupCodes.total = 10;
    backupCodes.unused = 10;
    backupCodes.generatedAt = "2026-11-19T09:01:00.000Z";

    return new HTTPResponse(
      200,
      {
        backupCodes: Array.from({ length: 10 }, (_unused, index) => {
          return `k7m2-9qx${index}`;
        }),
      },
      {},
    );
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return new HTTPResponse(200, {}, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does. <html lang> and <html dir>
 * follow the language through the production helper.
 */
followLanguageForPage(i18next);

/*
 * English, the fallback, is in the bundle; German, Arabic and Persian are
 * each a chunk of its own, loaded only by a page drawn in that language, as
 * the Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts), and built as
 * the Dashboard ships them (server.js, SuiteHelpers/FixtureLocalesBuild.js).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  ar: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/ar.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: await localeResources({
    language: language,
    english: EN,
    loaders: LOCALE_LOADERS,
  }),
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Dates in the reader's language, as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

// ---- the pages ---------------------------------------------------------------

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Maya Chen</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview account · Synthetic data
        </span>
      </header>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
        <Outlet />
      </div>
    </>
  );
}

// A page the side menu leads to that is not modelled: says where it is.
function StubPage() {
  const location = useLocation();

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-8 py-12">
      <h2 className="text-xl font-semibold text-gray-900">Not modelled</h2>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
      </p>
    </div>
  );
}

const TWO_FACTOR_ROUTE = RouteMap[PageMap.USER_TWO_FACTOR_AUTH];
const PASSKEYS_ROUTE = RouteMap[PageMap.USER_PASSKEYS];

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Routes>
      <PageRoute element={<Shell />}>
        <PageRoute element={<UserProfileLayout />}>
          <PageRoute
            path={TWO_FACTOR_ROUTE.toString()}
            element={<TwoFactorAuthPage pageRoute={TWO_FACTOR_ROUTE} />}
          />
          <PageRoute
            path={PASSKEYS_ROUTE.toString()}
            element={<PasskeysPage pageRoute={PASSKEYS_ROUTE} />}
          />
          <PageRoute path="*" element={<StubPage />} />
        </PageRoute>
      </PageRoute>
    </Routes>
  </BrowserRouter>,
);
