/*
 * Offline fixture for a record's File and Multiple files custom fields: an
 * incident's Custom Fields page (Dashboard Pages/Incidents/View/
 * CustomFields), the card it draws (Common CustomFieldsDetail) with each
 * file a download of the record's own, and its Edit dialog's file pickers.
 * The page, the card, the dialog and the pickers are the production ones
 * from this branch; only the ModelAPI data boundary, the upload and the
 * signed-in user's permissions are replaced.
 *
 * The incident's project has three incident custom fields: "Signed change
 * request" (File), "Evidence" (Multiple files) and "Change ticket" (Text).
 *
 * Steered by the query string:
 *   data=files (default)  a signed change request, three pieces of evidence
 *                         and a change ticket
 *   data=empty            no values yet
 *   data=full             Evidence holds the ten files it may
 *   data=long             file names with nowhere to break
 *   upload=slow           each upload takes about two seconds, in steps, so
 *                         its progress can be seen
 *   upload=fail           every upload is refused, as the server refuses a
 *                         file of another kind
 *   save=fail             the save is refused, as the server refuses a file
 *                         it cannot find
 *   lang=de|fa            the Dashboard's German or Persian words (Persian
 *                         reads right to left)
 *   theme=dark            dark mode (set before the bundle by server.js)
 *
 * Recorded on window.__fixture: every upload (`uploads`: the name, type and
 * size the picker sent), every save (`updates`: the customFields it sent)
 * and every read or write this fixture does not model (`unmodelled`; the
 * spec fails on any). The saved values become the record's, as the server
 * stores them (each file as the file itself says it is), so the card shows
 * what a save left.
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
import IncidentCustomFieldsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/CustomFields";
import FileModel from "Common/Models/DatabaseModels/File";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import MimeType from "Common/Types/File/MimeType";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000c1";
const INCIDENT_ID = "20000000-0000-4000-8000-0000000000c1";
const USER_ID = "40000000-0000-4000-8000-0000000000c1";

const FILE_FIELD = "Signed change request";
const FILES_FIELD = "Evidence";
const TEXT_FIELD = "Change ticket";

const params = new URLSearchParams(window.location.search);
const dataKind = params.get("data") || "files";
const uploadMode = params.get("upload") || "";
const saveMode = params.get("save") || "";
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

window.__fixture = {
  uploads: [],
  updates: [],
  unmodelled: [],
};

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function idOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "object" && value._id) {
    return value._id.toString().toLowerCase();
  }
  return value.toString().toLowerCase();
}

function fileId(number) {
  return `f0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

// ---- the files the project holds -------------------------------------------

/*
 * Every File the project holds, by id: what the server reads a file
 * custom field's value from. An upload adds one.
 */
const FILES = new Map();

function addFile(number, name, fileType, size) {
  const file = { fileId: fileId(number), name, fileType, size };
  FILES.set(file.fileId, file);
  return file;
}

const LONG_NAME =
  "quarterly-capacity-review-for-the-payments-platform-including-the-eu-west-1-and-us-east-2-failover-drill-results-final-v7.pdf";

const signed = addFile(
  1,
  dataKind === "long" ? LONG_NAME : "change-request-CHG-2041-signed.pdf",
  MimeType.pdf,
  48213,
);
const evidence = [
  addFile(
    2,
    dataKind === "long"
      ? "checkout-latency-p99-dashboard-screenshot-taken-during-the-eu-west-1-incident-bridge.png"
      : "checkout-latency.png",
    MimeType.png,
    245760,
  ),
  addFile(3, "gateway-errors.csv", MimeType.csv, 18432),
  addFile(4, "capture-eu-west-1.pcap", "application/vnd.tcpdump.pcap", 2516582),
];

if (dataKind === "full") {
  for (let number = 5; number <= 11; number++) {
    evidence.push(
      addFile(number, `screenshot-${number - 4}.png`, MimeType.png, 102400),
    );
  }
}

let nextUpload = 100;

// ---- the record and its fields ----------------------------------------------

function definition(id, name, type, description, order) {
  const field = new IncidentCustomField();
  field._id = id;
  field.name = name;
  field.customFieldType = type;
  field.description = description;
  field.sortOrder = order;
  return field;
}

const DEFINITIONS = [
  definition(
    "30000000-0000-4000-8000-0000000000c1",
    FILE_FIELD,
    CustomFieldType.File,
    "The change request, signed by the change board.",
    1,
  ),
  definition(
    "30000000-0000-4000-8000-0000000000c2",
    FILES_FIELD,
    CustomFieldType.MultipleFiles,
    "Screenshots, logs and packet captures.",
    2,
  ),
  definition(
    "30000000-0000-4000-8000-0000000000c3",
    TEXT_FIELD,
    CustomFieldType.Text,
    "",
    3,
  ),
];

let storedCustomFields =
  dataKind === "empty"
    ? {}
    : {
        [FILE_FIELD]: signed,
        [FILES_FIELD]: evidence,
        [TEXT_FIELD]: "CHG-2041",
      };

function incident() {
  const record = new Incident();
  record._id = INCIDENT_ID;
  record.projectId = new ObjectID(PROJECT_ID);
  record.customFields = JSON.parse(JSON.stringify(storedCustomFields));
  return record;
}

/*
 * What the server stores for a save: each file a file field names, as the
 * file itself says it is (CustomFieldFiles); an emptied field loses its key.
 */
function storeAsServer(customFields) {
  const stored = {};

  for (const [name, value] of Object.entries(customFields || {})) {
    const field = DEFINITIONS.find((candidate) => {
      return candidate.name === name;
    });
    const isFileField =
      field &&
      (field.customFieldType === CustomFieldType.File ||
        field.customFieldType === CustomFieldType.MultipleFiles);

    if (!isFileField) {
      if (value !== null && value !== undefined && value !== "") {
        stored[name] = value;
      }
      continue;
    }

    const entries = Array.isArray(value) ? value : value ? [value] : [];
    const files = entries
      .map((entry) => {
        return FILES.get(idOf(entry && (entry.fileId || entry._id || entry)));
      })
      .filter(Boolean);

    if (files.length === 0) {
      continue;
    }

    stored[name] =
      field.customFieldType === CustomFieldType.File ? files[0] : files;
  }

  return stored;
}

// ---- who is signed in -------------------------------------------------------

const HELD = [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [
  ...HELD,
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: HELD.map((permission) => ({
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
  })),
});
PermissionUtil.getGlobalPermissions = () => ({
  _type: "UserGlobalAccessPermission",
  globalPermissions: [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
  ],
  projectIds: [new ObjectID(PROJECT_ID)],
});

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme Commerce";
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- the data boundary --------------------------------------------------------

function tableName(modelType) {
  return new modelType().tableName;
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  await waitFor(40);

  if (name === "IncidentCustomField") {
    return {
      data: DEFINITIONS,
      count: DEFINITIONS.length,
      skip: 0,
      limit: DEFINITIONS.length,
    };
  }

  window.__fixture.unmodelled.push(`getList ${name}`);
  return { data: [], count: 0, skip: 0, limit: 10 };
};

ModelAPI.getItem = async (options) => {
  const name = tableName(options.modelType);
  await waitFor(40);

  if (name === "Incident" && idOf(options.id) === INCIDENT_ID) {
    return incident();
  }

  window.__fixture.unmodelled.push(`getItem ${name}`);
  return null;
};

ModelAPI.updateById = async (options) => {
  const name = tableName(options.modelType);
  const data = JSON.parse(JSON.stringify(options.data || {}));

  if (name !== "Incident" || idOf(options.id) !== INCIDENT_ID) {
    window.__fixture.unmodelled.push(`updateById ${name}`);
    return new HTTPResponse(200, {}, {});
  }

  window.__fixture.updates.push(data);
  await waitFor(60);

  if (saveMode === "fail") {
    throw new HTTPErrorResponse(
      400,
      {
        message: `One of the files for "${FILES_FIELD}" could not be found. Upload it again.`,
      },
      {},
    );
  }

  storedCustomFields = storeAsServer(data.customFields);
  return new HTTPResponse(200, {}, {});
};

/*
 * An upload: the file picker's POST /api/file. Its progress is told in
 * steps, as the browser tells it for a large body; the stored File comes
 * back with an id of its own.
 */
async function upload(options) {
  const model = options.model;
  const size = model.file ? model.file.byteLength : 0;
  const onUploadProgress =
    options.requestOptions &&
    options.requestOptions.apiRequestOptions &&
    options.requestOptions.apiRequestOptions.onUploadProgress;

  window.__fixture.uploads.push({
    name: model.name,
    fileType: model.fileType,
    size: size,
  });

  const steps = uploadMode === "slow" ? [0.2, 0.45, 0.7, 0.9, 1] : [0.5, 1];

  for (const step of steps) {
    await waitFor(uploadMode === "slow" ? 400 : 30);

    if (onUploadProgress) {
      onUploadProgress({ loaded: Math.round(size * step), total: size });
    }
  }

  if (uploadMode === "fail") {
    throw new HTTPErrorResponse(
      400,
      {
        message:
          "This file type is not supported. Please upload a supported file type.",
      },
      {},
    );
  }

  const stored = addFile(nextUpload++, model.name, model.fileType, size);
  const created = new FileModel();
  created._id = stored.fileId;
  created.name = stored.name;
  created.fileType = stored.fileType;
  created.file = model.file;

  return new HTTPResponse(200, created, {});
}

ModelAPI.create = async (options) => {
  if (tableName(options.modelType) === "File") {
    return await upload(options);
  }

  window.__fixture.unmodelled.push(`create ${tableName(options.modelType)}`);
  return new HTTPResponse(200, {}, {});
};

ModelAPI.createOrUpdate = async (options) => {
  window.__fixture.unmodelled.push(
    `createOrUpdate ${tableName(options.modelType)}`,
  );
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  window.__fixture.unmodelled.push(`API.get ${String(options && options.url)}`);
  return new HTTPResponse(200, {}, {});
};

API.post = async (options) => {
  window.__fixture.unmodelled.push(
    `API.post ${String(options && options.url)}`,
  );
  return new HTTPResponse(200, {}, {});
};

// ---- the page -----------------------------------------------------------------

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does. <html lang> and <html dir>
 * follow the language through the production helper.
 */
followLanguageForPage(i18next);

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Outlet />
    </main>
  );
}

const pageProps = {
  pageRoute: undefined,
  currentProject: project,
  hasPaymentMethod: true,
};

const target = `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}/custom-fields`;

if (!window.location.pathname.startsWith(target)) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Routes>
      <PageRoute element={<Shell />}>
        <PageRoute
          path="/dashboard/:projectId/incidents/:modelId/custom-fields"
          element={
            <IncidentCustomFieldsPage
              {...pageProps}
              pageRoute={Navigation.getCurrentRoute()}
            />
          }
        />
      </PageRoute>
    </Routes>
  </BrowserRouter>,
);
