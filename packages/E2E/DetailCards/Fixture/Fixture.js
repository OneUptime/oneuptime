/*
 * Offline fixture for the detail cards: CardModelDetail, the ModelDetail
 * and Detail it draws, and the pages built on them.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced; the pages, cards, fields, edit dialogs and the
 * shared components they draw are the production ones from this branch.
 *
 * Pages (the path picks one):
 *   /dashboard/<project>/user-settings/profile   User Settings > Profile:
 *                                                 the "Basic Info" card of the
 *                                                 maintainer's screenshot
 *   /dashboard/<project>/settings/project        Project Settings
 *   /dashboard/<project>/status-pages/<id>       a status page's Overview
 *   /dashboard/<project>/teams/<id>              a team's page
 *   /dashboard/<project>/detail-cards            the gallery: one, two,
 *                                                 three and four columns,
 *                                                 every kind of value, empty
 *                                                 values, long values, the
 *                                                 compact style and a card's
 *                                                 sections
 *   /dashboard/<project>/card-rows               rows of cards of different
 *                                                 heights (CardGrid) in the
 *                                                 production Page beside a
 *                                                 side menu
 *
 * Steered by the query string:
 *   - data=empty      every optional value is unset
 *   - data=long       long names, an email and a URL with nowhere to break
 *   - role=viewer     a member who may read but not edit (the Edit button is
 *                     locked and says which permission is missing)
 *   - delay=<ms>      each read takes this long (40 ms otherwise), to see
 *                     the cards while they load
 *   - fail=<table>    every read of that table fails (StatusPage, User, ...),
 *                     as a server that cannot be reached does
 *   - lang=de|ja|fa   the Dashboard's German, Japanese or Persian words
 *   - theme=dark      (read by server.js) the Dashboard's dark mode
 *
 * Every single read is recorded on `window.__fixture.itemRequests` and every
 * write on `window.__fixture.updates`, so the spec checks what the page asked
 * for as well as what it drew.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import UserProfilePage from "../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Index";
import ProjectSettingsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectSettings";
import StatusPageOverviewPage from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index";
import TeamPage from "../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Index";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "Common/UI/Components/Card/CardGridLayout";
import Page from "Common/UI/Components/Page/Page";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import IconProp from "Common/Types/Icon/IconProp";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import Route from "Common/Types/API/Route";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const STATUS_PAGE_ID = "30000000-0000-4000-8000-000000000001";
const TEAM_ID = "50000000-0000-4000-8000-000000000001";

const params = new URLSearchParams(window.location.search);
const dataKind = params.get("data") || "normal";
const isEmpty = dataKind === "empty";
const isLong = dataKind === "long";
const role = params.get("role") || "owner";
const delay = Number(params.get("delay") || 40);
const failingTable = params.get("fail") || "";
const language = ["de", "ja", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

window.__fixture = {
  itemRequests: [],
  listRequests: [],
  updates: [],
  unmodelled: [],
};

const LONG_URL =
  "https://status.acme-commerce.example/incidents/2026/checkout-latency-in-eu-west-one-and-retries-on-the-payments-gateway-callback-queue";
// A made-up value with nowhere to break, as long as a real key.
const LONG_TOKEN =
  "examplesigningvalue0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff";

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

function label(id, name, color) {
  const record = new Label();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.color = new Color(color);
  return record;
}

const LABELS = [
  label("20000000-0000-4000-8000-000000000001", "Production", "#ef4444"),
  label("20000000-0000-4000-8000-000000000002", "Customer facing", "#6366f1"),
  label("20000000-0000-4000-8000-000000000003", "EU", "#10b981"),
];

// The signed-in user: the "Basic Info" card of User Settings > Profile.
function makeUser() {
  const user = new User();
  user._id = USER_ID;
  user.name = new Name(
    isLong
      ? "Maximiliane Alexandra von Hohenzollern-Sigmaringen-Rothenburg"
      : "Test User",
  );
  user.email = new Email(
    isLong
      ? "maximiliane.alexandra.von-hohenzollern@platform-reliability.acme-commerce.example"
      : "test@oneuptime.com",
  );
  user.timezone = isEmpty ? undefined : "Europe/London";
  return user;
}

function makeProject() {
  const project = new Project();
  project._id = PROJECT_ID;
  project.name = isLong
    ? "Acme Commerce Platform Reliability and Incident Response Program"
    : "Acme Commerce";
  return project;
}

function makeTeam() {
  const team = new Team();
  team._id = TEAM_ID;
  team.projectId = new ObjectID(PROJECT_ID);
  team.name = "Payments On-Call";
  team.description = isEmpty
    ? undefined
    : "Owns checkout, payments and refunds. Pages go to the primary on-call first.";
  team.createdAt = new Date("2026-03-02T09:30:00.000Z");
  return team;
}

/*
 * One status page per gallery card, so each card reads the record its
 * fields describe. The overview page reads STATUS_PAGE_ID.
 */
function statusPage(id, values) {
  const record = new StatusPage();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.createdAt = new Date("2026-03-02T09:30:00.000Z");
  Object.assign(record, values);
  return record;
}

const GALLERY = {
  one: "31000000-0000-4000-8000-000000000001",
  two: "31000000-0000-4000-8000-000000000002",
  three: "31000000-0000-4000-8000-000000000003",
  four: "31000000-0000-4000-8000-000000000004",
  code: "31000000-0000-4000-8000-000000000005",
  keys: "31000000-0000-4000-8000-000000000006",
  notes: "31000000-0000-4000-8000-000000000007",
  compact: "31000000-0000-4000-8000-000000000008",
  sectionA: "31000000-0000-4000-8000-000000000009",
  sectionB: "31000000-0000-4000-8000-00000000000a",
  mixed: "31000000-0000-4000-8000-00000000000b",
};

function monitorStatus(id, name, color) {
  const record = new MonitorStatus();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = name;
  record.color = new Color(color);
  return record;
}

const MARKDOWN = [
  "Public status for **checkout**, payments and the API.",
  "",
  "- Incidents are posted here first",
  "- Maintenance is announced a week ahead",
  "",
  `Read the [runbook](${LONG_URL}).`,
].join("\n");

const STATUS_PAGES = [
  statusPage(STATUS_PAGE_ID, {
    name: isLong
      ? "Acme Commerce Public Status for Checkout, Payments and the Partner API"
      : "Acme Status",
    description: isEmpty
      ? undefined
      : "Public status for checkout, payments and the API.",
    labels: isEmpty ? [] : LABELS,
  }),
  statusPage(GALLERY.one, {
    name: "Acme Status",
    description: isEmpty
      ? undefined
      : `Incidents are posted here first: ${LONG_URL}`,
    labels: isEmpty ? [] : LABELS,
    isPublicStatusPage: !isEmpty,
    enableSearchEngineIndexing: false,
    pageTitle: undefined,
    copyrightText: undefined,
    reportStartDateTime: isEmpty
      ? undefined
      : new Date("2026-10-01T08:00:00.000Z"),
  }),
  statusPage(GALLERY.two, {
    name: isLong
      ? "Maximiliane Alexandra von Hohenzollern-Sigmaringen-Rothenburg"
      : "Test User",
    pageTitle: isLong
      ? "maximiliane.alexandra.von-hohenzollern@platform-reliability.acme-commerce.example"
      : "test@oneuptime.com",
    reportTimezone: isEmpty ? undefined : "Europe/London",
  }),
  statusPage(GALLERY.three, {
    name: "Acme Status",
    slug: "acme-status",
    pageTitle: "Acme Commerce status",
    isPublicStatusPage: true,
    enableEmailSubscribers: true,
    enableSmsSubscribers: false,
    showIncidentHistoryInDays: 14,
  }),
  statusPage(GALLERY.four, {
    name: "Acme Status",
    slug: "acme-status",
    pageTitle: "Acme Commerce status",
    isPublicStatusPage: true,
    description: isLong
      ? `Incidents are posted here first: ${LONG_URL}`
      : "Public status for checkout, payments and the API.",
    showIncidentHistoryInDays: 14,
  }),
  statusPage(GALLERY.code, {
    description: MARKDOWN,
    customCSS: ".banner {\n  color: #4f46e5;\n  font-weight: 600;\n}",
    headerHTML: '<div class="banner">Acme Commerce</div>',
  }),
  statusPage(GALLERY.keys, {
    slug: isLong ? LONG_TOKEN : "acme-status",
    logoAltText: LONG_TOKEN,
    copyrightText: LONG_URL,
  }),
  statusPage(GALLERY.notes, {
    name: "Acme Status",
    pageTitle: undefined,
    showIncidentHistoryInDays: 14,
  }),
  statusPage(GALLERY.compact, {
    name: "Acme Status",
    description: "Public status for checkout, payments and the API.",
    labels: LABELS,
  }),
  statusPage(GALLERY.sectionA, {
    name: "Acme Status",
    isPublicStatusPage: true,
  }),
  statusPage(GALLERY.sectionB, {
    showIncidentHistoryInDays: 14,
    showAnnouncementHistoryInDays: 30,
  }),
  /*
   * Every kind of one-line value side by side - text, a yes/no, a choice, a
   * colour, labels, related records, a dash and the field's own words - to
   * hold them all to one line in each row.
   */
  statusPage(GALLERY.mixed, {
    name: "Acme Status",
    isPublicStatusPage: true,
    theme: "Dark",
    defaultBarColor: new Color("#10b981"),
    labels: LABELS,
    downtimeMonitorStatuses: [
      monitorStatus(
        "21000000-0000-4000-8000-000000000001",
        "Offline",
        "#ef4444",
      ),
      monitorStatus(
        "21000000-0000-4000-8000-000000000002",
        "Degraded",
        "#f59e0b",
      ),
    ],
    pageTitle: undefined,
    copyrightText: undefined,
  }),
];

const STATUS_PAGE_CUSTOM_FIELDS = isEmpty
  ? []
  : [
      (() => {
        const field = new StatusPageCustomField();
        field._id = "32000000-0000-4000-8000-000000000001";
        field.projectId = new ObjectID(PROJECT_ID);
        field.name = "Region";
        field.customFieldType = CustomFieldType.Text;
        return field;
      })(),
    ];

const RECORDS = {
  User: () => [makeUser()],
  Project: () => [makeProject()],
  Team: () => [makeTeam()],
  StatusPage: () => STATUS_PAGES,
  StatusPageCustomField: () => STATUS_PAGE_CUSTOM_FIELDS,
  /*
   * The Overview's Status Page Link card lists the page's custom domains
   * before its OneUptime address: this page has none.
   */
  StatusPageDomain: () => [],
  // A team page's Custom Fields card: none defined, so it hides itself.
  TeamCustomField: () => [],
  Label: () => LABELS,
};

/*
 * A project owner, or a member who may read everything here but change
 * none of it.
 */
const heldPermissions =
  role === "viewer"
    ? [
        Permission.Viewer,
        Permission.ReadStatusPage,
        Permission.ReadProjectTeam,
        Permission.ReadProject,
      ]
    : [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [
  ...heldPermissions,
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: heldPermissions.map((permission) => ({
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
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.itemRequests.push({
    tableName,
    id,
    select: Object.keys(options.select || {}),
  });
  await waitFor(delay);
  if (failingTable === tableName || failingTable === "all") {
    throw new Error(
      "We could not reach OneUptime. Check your connection and try again.",
    );
  }
  const rows = RECORDS[tableName] ? RECORDS[tableName]() : null;
  if (!rows) {
    window.__fixture.unmodelled.push(`getItem ${tableName}`);
    return null;
  }
  return rows.find((record) => idOf(record._id) === id) || null;
};

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  window.__fixture.listRequests.push({ tableName });
  await waitFor(delay);
  const rows = RECORDS[tableName] ? RECORDS[tableName]() : null;
  if (!rows) {
    window.__fixture.unmodelled.push(`getList ${tableName}`);
    return { data: [], count: 0, skip: 0, limit: 10 };
  }
  return { data: rows, count: rows.length, skip: 0, limit: rows.length };
};

ModelAPI.count = async (options) => {
  const tableName = new options.modelType().tableName;
  const rows = RECORDS[tableName] ? RECORDS[tableName]() : [];
  return rows.length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.createOrUpdate = async (options) => {
  const record = options.model;
  window.__fixture.updates.push({
    tableName: record.tableName,
    id: idOf(record._id),
  });
  return { data: record };
};

ModelAPI.updateById = async (options) => {
  window.__fixture.updates.push({
    tableName: new options.modelType().tableName,
    id: idOf(options.id),
  });
  return { data: options.data || {} };
};

API.get = async (options) => {
  window.__fixture.unmodelled.push(`API.get ${String(options && options.url)}`);
  return { data: { data: [], count: 0 } };
};
API.post = async (options) => {
  window.__fixture.unmodelled.push(
    `API.post ${String(options && options.url)}`,
  );
  return { data: { data: [], count: 0 } };
};

/*
 * The Dashboard looks every string up by its English text, so the separators
 * i18next reads in a key (the "." and ":" of a sentence) are turned off, as
 * the Dashboard's own setup does.
 */
await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    ja: { translation: JA },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;

// What App.tsx does for every page: the router's hooks, handed to Navigation.
function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {props.children}
    </div>
  );
}

const PAGE_PROPS = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

/*
 * The gallery's cards. Each reads its own status page, and each is a
 * CardModelDetail exactly as a page writes one.
 */
function galleryCard(props) {
  return (
    <div data-testid={`gallery-${props.testId}`}>
      <CardModelDetail
        name={props.title}
        cardProps={{ title: props.title, description: props.description }}
        isEditable={props.isEditable !== false}
        documentationLink={props.documentationLink}
        videoLink={props.videoLink}
        editButtonText={props.editButtonText}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Status Page Name",
          },
        ]}
        modelDetailProps={{
          modelType: StatusPage,
          id: `detail-${props.testId}`,
          modelId: new ObjectID(props.modelId),
          showDetailsInNumberOfColumns: props.columns,
          style: props.style,
          fields: props.fields,
        }}
      />
    </div>
  );
}

function Gallery() {
  return (
    <div className="space-y-2">
      {galleryCard({
        testId: "one",
        title: "One column",
        description: "Every kind of value a detail card draws, one per row.",
        modelId: GALLERY.one,
        columns: 1,
        fields: [
          {
            field: { _id: true },
            title: "Status Page ID",
            fieldType: FieldType.ObjectID,
          },
          { field: { name: true }, title: "Name" },
          { field: { description: true }, title: "Description" },
          {
            field: { labels: { name: true, color: true } },
            title: "Labels",
            fieldType: FieldType.Element,
            getElement: (item) => {
              return <LabelsElement labels={item.labels || []} />;
            },
          },
          {
            field: { isPublicStatusPage: true },
            title: "Public",
            fieldType: FieldType.Boolean,
          },
          {
            field: { reportStartDateTime: true },
            title: "Reports start",
            fieldType: FieldType.DateTime,
          },
          { field: { pageTitle: true }, title: "Page title" },
          {
            field: { copyrightText: true },
            title: "Copyright text",
            placeholder: "No copyright text yet.",
          },
          {
            field: { createdAt: true },
            title: "Created At",
            fieldType: FieldType.DateTime,
          },
        ],
      })}
      {galleryCard({
        testId: "two",
        title: "Basic Info",
        description:
          "Your name and email as your team sees them, and the time zone OneUptime shows times in.",
        modelId: GALLERY.two,
        columns: 2,
        editButtonText: "Edit User",
        fields: [
          {
            field: { name: true },
            title: "Name",
            placeholder: "No name added",
          },
          {
            field: { pageTitle: true },
            title: "Email",
            placeholder: "No email added",
          },
          {
            field: { reportTimezone: true },
            title: "Timezone",
            placeholder: "No timezone selected",
          },
        ],
      })}
      {galleryCard({
        testId: "three",
        title: "Three columns",
        modelId: GALLERY.three,
        columns: 3,
        fields: [
          { field: { name: true }, title: "Name" },
          { field: { slug: true }, title: "Slug" },
          { field: { pageTitle: true }, title: "Page title" },
          {
            field: { isPublicStatusPage: true },
            title: "Public",
            fieldType: FieldType.Boolean,
          },
          {
            field: { enableEmailSubscribers: true },
            title: "Email subscribers",
            fieldType: FieldType.Boolean,
          },
          {
            field: { enableSmsSubscribers: true },
            title: "SMS subscribers",
            fieldType: FieldType.Boolean,
          },
          {
            field: { showIncidentHistoryInDays: true },
            title: "Incident history (days)",
            fieldType: FieldType.Number,
          },
        ],
      })}
      {galleryCard({
        testId: "four",
        title: "Four columns",
        modelId: GALLERY.four,
        columns: 4,
        fields: [
          { field: { name: true }, title: "Name" },
          { field: { slug: true }, title: "Slug" },
          { field: { pageTitle: true }, title: "Page title" },
          {
            field: { isPublicStatusPage: true },
            title: "Public",
            fieldType: FieldType.Boolean,
          },
          { field: { description: true }, title: "Description", colSpan: 2 },
          {
            field: { showIncidentHistoryInDays: true },
            title: "Incident history (days)",
            fieldType: FieldType.Number,
          },
        ],
      })}
      {galleryCard({
        testId: "code",
        title: "Markdown and code",
        modelId: GALLERY.code,
        columns: 1,
        fields: [
          {
            field: { description: true },
            title: "Description",
            fieldType: FieldType.Markdown,
          },
          {
            field: { customCSS: true },
            title: "Custom CSS",
            fieldType: FieldType.CSS,
          },
          {
            field: { headerHTML: true },
            title: "Header HTML",
            fieldType: FieldType.HTML,
          },
        ],
      })}
      {galleryCard({
        testId: "keys",
        title: "Keys and links",
        modelId: GALLERY.keys,
        columns: 2,
        videoLink: new Route("/docs/status-pages/index"),
        documentationLink: new Route("/docs/status-pages/index"),
        fields: [
          {
            field: { projectId: true },
            title: "Project ID",
            fieldType: FieldType.ObjectID,
            opts: { isCopyable: true },
          },
          {
            field: { slug: true },
            title: "Slug",
            opts: { isCopyable: true },
          },
          {
            field: { logoAltText: true },
            title: "Signing key",
            fieldType: FieldType.HiddenText,
            opts: { isCopyable: true },
          },
          { field: { copyrightText: true }, title: "Runbook" },
        ],
      })}
      {galleryCard({
        testId: "notes",
        title: "Descriptions and links",
        modelId: GALLERY.notes,
        columns: 2,
        fields: [
          {
            field: { name: true },
            title: "Name",
            description: "Shown at the top of the status page.",
            sideLink: {
              text: "Preview",
              url: new Route("/status-page/acme"),
              openLinkInNewTab: true,
            },
          },
          {
            field: { pageTitle: true },
            title: "Page title",
            description:
              "The browser tab's title. The name is used when empty.",
          },
          {
            field: { showIncidentHistoryInDays: true },
            title: "Incident history (days)",
            fieldType: FieldType.Number,
          },
        ],
      })}
      {galleryCard({
        testId: "mixed",
        title: "Mixed values",
        description: "One-line values of every kind, side by side.",
        modelId: GALLERY.mixed,
        columns: 4,
        fields: [
          { field: { name: true }, title: "Name" },
          {
            field: { isPublicStatusPage: true },
            title: "Public",
            fieldType: FieldType.Boolean,
          },
          {
            field: { theme: true },
            title: "Theme",
            fieldType: FieldType.Dropdown,
            dropdownOptions: [
              { value: "Light", label: "Light" },
              { value: "Dark", label: "Dark", color: new Color("#4f46e5") },
              { value: "System", label: "System" },
            ],
          },
          {
            field: { defaultBarColor: true },
            title: "Bar color",
            fieldType: FieldType.Color,
          },
          {
            field: { labels: { name: true, color: true } },
            title: "Labels",
            fieldType: FieldType.Element,
            getElement: (item) => {
              return <LabelsElement labels={item.labels || []} />;
            },
          },
          {
            field: { downtimeMonitorStatuses: { name: true, color: true } },
            title: "Downtime statuses",
            fieldType: FieldType.EntityArray,
          },
          { field: { pageTitle: true }, title: "Page title" },
          {
            field: { copyrightText: true },
            title: "Copyright text",
            placeholder: "No copyright text yet.",
          },
        ],
      })}
      {galleryCard({
        testId: "compact",
        title: "Compact style",
        modelId: GALLERY.compact,
        columns: 1,
        style: DetailStyle.Compact,
        isEditable: false,
        fields: [
          { field: { name: true }, title: "Name" },
          { field: { description: true }, title: "Description" },
          {
            field: { labels: { name: true, color: true } },
            title: "Labels",
            fieldType: FieldType.Element,
            getElement: (item) => {
              return <LabelsElement labels={item.labels || []} />;
            },
          },
        ],
      })}
      <div data-testid="gallery-sections">
        <AdvancedPageSection description="Two detail cards drawn as sections of one card.">
          <CardModelDetail
            name="Visibility"
            cardProps={{ title: "Visibility" }}
            isEditable={true}
            formFields={[
              {
                field: { isPublicStatusPage: true },
                title: "Public",
                fieldType: FormFieldSchemaType.Toggle,
              },
            ]}
            modelDetailProps={{
              modelType: StatusPage,
              id: "detail-section-a",
              modelId: new ObjectID(GALLERY.sectionA),
              showDetailsInNumberOfColumns: 2,
              fields: [
                { field: { name: true }, title: "Name" },
                {
                  field: { isPublicStatusPage: true },
                  title: "Public",
                  fieldType: FieldType.Boolean,
                },
              ],
            }}
          />
          <CardModelDetail
            name="History"
            cardProps={{ title: "History" }}
            isEditable={true}
            formFields={[
              {
                field: { showIncidentHistoryInDays: true },
                title: "Incident history (days)",
                fieldType: FormFieldSchemaType.Number,
              },
            ]}
            modelDetailProps={{
              modelType: StatusPage,
              id: "detail-section-b",
              modelId: new ObjectID(GALLERY.sectionB),
              fields: [
                {
                  field: { showIncidentHistoryInDays: true },
                  title: "Incident history (days)",
                  fieldType: FieldType.Number,
                },
                {
                  field: { showAnnouncementHistoryInDays: true },
                  title: "Announcement history (days)",
                  fieldType: FieldType.Number,
                },
              ],
            }}
          />
        </AdvancedPageSection>
      </div>
    </div>
  );
}

/*
 * The card rows gallery (/dashboard/<project>/card-rows): rows of cards of
 * different heights drawn with CardGrid, inside the production Page beside a
 * side menu, so each grid has the room a product page's has at each window
 * width. Two wide cards, three narrow ones, five (a last row of two), three
 * wide ones (a last card alone), a card with nothing to list, and a detail
 * card beside a long list.
 */
const CARD_ROWS_PATH = `/dashboard/${PROJECT_ID}/card-rows`;

function rankedRows(count, label) {
  return (
    <ul className="space-y-2.5" data-testid="card-rows-list">
      {Array.from({ length: count }, (_unused, index) => {
        return (
          <li key={index} className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-gray-800">
              {label} {index + 1}
            </span>
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {(count - index) * 3}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function rowCard(title, count, label) {
  return (
    <Card
      title={title}
      description={`${count} ${count === 1 ? "row" : "rows"} of ${label}.`}
    >
      {rankedRows(count, label)}
    </Card>
  );
}

function CardRows() {
  return (
    <Page
      title="Card rows"
      breadcrumbLinks={[
        { title: "Project", to: new Route(`/dashboard/${PROJECT_ID}`) },
        { title: "Card rows", to: new Route(CARD_ROWS_PATH) },
      ]}
      sideMenu={
        <SideMenu
          items={[
            {
              link: { title: "Card rows", to: new Route(CARD_ROWS_PATH) },
              icon: IconProp.Squares,
            },
            {
              link: {
                title: "Detail cards",
                to: new Route(`/dashboard/${PROJECT_ID}/detail-cards`),
              },
              icon: IconProp.List,
            },
          ]}
        />
      }
    >
      <div className="space-y-5">
        <CardGrid columns={2} dataTestId="rows-two-wide">
          {rowCard("Riskiest hosts", 8, "host")}
          {rowCard("Top rules", 2, "rule")}
        </CardGrid>
        <CardGrid columns={3} cardWidth="narrow" dataTestId="rows-three-narrow">
          {rowCard("Two tactics", 2, "tactic")}
          {rowCard("Eight priorities", 8, "priority")}
          {rowCard("Four verdicts", 4, "verdict")}
        </CardGrid>
        <CardGrid columns={3} cardWidth="narrow" dataTestId="rows-five-narrow">
          {rowCard("One", 1, "item")}
          {rowCard("Two", 2, "item")}
          {rowCard("Three", 3, "item")}
          {rowCard("Four", 4, "item")}
          {rowCard("Five", 5, "item")}
        </CardGrid>
        <CardGrid columns={2} dataTestId="rows-three-wide">
          {rowCard("Producers", 6, "service")}
          {rowCard("Consumers", 1, "service")}
          {rowCard("Brokers", 3, "broker")}
        </CardGrid>
        <CardGrid columns={2} dataTestId="rows-nothing">
          {rowCard("Riskiest entities", 6, "entity")}
          <Card title="Top detections" description="The last 14 days.">
            <p
              data-testid="rows-nothing-sentence"
              className={`${CARD_GRID_CENTERED_STATE_CLASS_NAME} py-6 text-sm text-gray-500`}
            >
              Nothing was detected in the last 14 days.
            </p>
          </Card>
        </CardGrid>
        <CardGrid columns={2} dataTestId="rows-detail">
          {galleryCard({
            testId: "rows-detail-card",
            title: "A detail card",
            description: "A CardModelDetail in a cell.",
            modelId: GALLERY.two,
            columns: 1,
            fields: [
              { field: { name: true }, title: "Name" },
              { field: { pageTitle: true }, title: "Page title" },
            ],
          })}
          {rowCard("Beside it", 9, "row")}
        </CardGrid>
      </div>
    </Page>
  );
}

function CardRowsShell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return props.children;
}

function Fixture() {
  return (
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/card-rows"
        element={
          <CardRowsShell>
            <CardRows />
          </CardRowsShell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/user-settings/profile"
        element={
          <Shell>
            <UserProfilePage {...PAGE_PROPS} />
          </Shell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/settings/project"
        element={
          <Shell>
            <ProjectSettingsPage {...PAGE_PROPS} />
          </Shell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/status-pages/:id"
        element={
          <Shell>
            <StatusPageOverviewPage {...PAGE_PROPS} />
          </Shell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/teams/:id"
        element={
          <Shell>
            <TeamPage {...PAGE_PROPS} />
          </Shell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/detail-cards"
        element={
          <Shell>
            <Gallery />
          </Shell>
        }
      />
    </Routes>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
