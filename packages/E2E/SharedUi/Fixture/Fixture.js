/*
 * Offline fixture for the shared buttons, dialogs and cards: Button and its
 * styles, MoreMenu's own trigger, Modal's first focus, the Duplicate, Reset
 * and Delete cards and their dialogs, CollapsibleSection and SideMenuSection,
 * the pills (Pill, BooleanValue, DropdownValueBadge), the stat tiles
 * (InfoCard), the multi-selects' chips, a single pick open and locked, the
 * team avatars, and the radios and checkboxes (ChoiceRows, Checkbox).
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced; every component is the production one from this
 * branch, and the network device's Connectivity tools are the real
 * DeviceDiagnostics.
 *
 * One page, /dashboard/<project>/shared-ui, steered by the query string:
 *   - section=buttons|dialogs|sections|pills|avatars|choices|rules|charts|states|skeletons|keyboard
 *     which part to draw (all but charts, states, skeletons and keyboard when left out)
 *   - read=<ms>      how long the edit dialog's record read takes (600)
 *   - lang=de|ja|fa|zh-CN|ru|fr   the Dashboard's words in that language
 *   - zoomed=1       (charts) the page is zoomed, so the hints name the way back
 *   - layout=side-menu   beside a real side menu, as a record's pages are
 *   - theme=dark     (read by server.js) the Dashboard's dark mode
 *
 * Every read is recorded on window.__fixture.reads, every write on
 * window.__fixture.updates, and every read the fixture does not model on
 * window.__fixture.unmodelled (the suite fails on any).
 */
import "Common/UI/Styles/Theme.css";
import React, { useState } from "react";
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
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { initReactI18next } from "react-i18next";
import DeviceDiagnostics from "../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnostics";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import StatTilesSkeleton from "Common/UI/Components/Skeleton/StatTilesSkeleton";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import SharedPage from "Common/UI/Components/Page/Page";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import ChoiceRows from "Common/UI/Components/ChoiceRows/ChoiceRows";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Detail from "Common/UI/Components/Detail/Detail";
import Dropdown from "Common/UI/Components/Dropdown/Dropdown";
import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import LabelPill from "Common/UI/Components/Label/Label";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import PeopleAvatar from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import RuleCriteriaBuilder from "Common/UI/Components/RuleCriteria/RuleCriteriaBuilder";
import { RULE_CRITERIA_SCHEMA_VERSION } from "Common/Types/Rules/RuleCriteria";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import FieldType from "Common/UI/Components/Types/FieldType";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import Label from "Common/Models/DatabaseModels/Label";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Color from "Common/Types/Color";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import ChartGroup, {
  ChartType,
} from "Common/UI/Components/Charts/ChartGroup/ChartGroup";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import { XAxisAggregateType } from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import { YAxisPrecision } from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ValueFormatter from "Common/Utils/ValueFormatter";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import NotificationBell from "Common/UI/Components/HeaderAlert/NotificationBell/NotificationBell";
import { NotificationBellSection } from "Common/UI/Components/HeaderAlert/NotificationBell/NotificationItem";
import { HeaderAlertType } from "Common/UI/Components/HeaderAlert/HeaderAlert";
import Steps from "Common/UI/Components/Forms/Steps/Steps";
import TableRow from "Common/UI/Components/Table/TableRow";
import CSVFileUpload from "Common/UI/Components/CSVFileUpload/CSVFileUpload";
import TrafficConversationDiagram from "../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/TrafficConversationDiagram";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FilterViewer from "Common/UI/Components/Filters/FilterViewer";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const WORKFLOW_ID = "40000000-0000-4000-8000-000000000001";
const PROBE_ID = "41000000-0000-4000-8000-000000000001";
const API_KEY_ID = "42000000-0000-4000-8000-000000000001";
const DEVICE_ID = "43000000-0000-4000-8000-000000000001";

const params = new URLSearchParams(window.location.search);
const section = params.get("section") || "all";
const readDelay = Number(params.get("read") || 600);
const layout = params.get("layout") || "";
const language = ["de", "ja", "fa", "zh-CN", "ru", "fr"].includes(
  params.get("lang"),
)
  ? params.get("lang")
  : "en";

window.__fixture = {
  reads: [],
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

function makeWorkflow() {
  const workflow = new Workflow();
  workflow._id = WORKFLOW_ID;
  workflow.projectId = new ObjectID(PROJECT_ID);
  workflow.name = "Notify on-call";
  return workflow;
}

function makeProbe() {
  const probe = new Probe();
  probe._id = PROBE_ID;
  probe.projectId = new ObjectID(PROJECT_ID);
  probe.name = "Frankfurt";
  probe.description = "The EU probe";
  probe.shouldAutoEnableProbeOnNewMonitors = true;
  return probe;
}

function makeDevice() {
  const device = new NetworkDevice();
  device._id = DEVICE_ID;
  device.projectId = new ObjectID(PROJECT_ID);
  device.hostname = "core-switch-01.acme.example";
  device.probeId = new ObjectID(PROBE_ID);
  device.probe = makeProbe();
  return device;
}

const RECORDS = {
  Workflow: () => {
    return [makeWorkflow()];
  },
  Probe: () => {
    return [makeProbe()];
  },
  NetworkDevice: () => {
    return [makeDevice()];
  },
};

// The owner of the project: every action may be taken.
const heldPermissions = [Permission.ProjectOwner];

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
  window.__fixture.reads.push({ kind: "getItem", tableName, id });
  // The edit dialog's read is the slow one: its form draws when it lands.
  await waitFor(tableName === "Probe" ? readDelay : 40);
  const rows = RECORDS[tableName] ? RECORDS[tableName]() : null;
  if (!rows) {
    window.__fixture.unmodelled.push(`getItem ${tableName}`);
    return null;
  }
  return rows.find((record) => idOf(record._id) === id) || null;
};

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  window.__fixture.reads.push({ kind: "getList", tableName });
  await waitFor(40);
  // Duplicate looks up the names already taken, to number the copy's.
  if (tableName === "Workflow") {
    return { data: [makeWorkflow()], count: 1, skip: 0, limit: 10 };
  }
  window.__fixture.unmodelled.push(`getList ${tableName}`);
  return { data: [], count: 0, skip: 0, limit: 10 };
};

ModelAPI.count = async () => {
  return 0;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.createOrUpdate = async (options) => {
  window.__fixture.updates.push({
    tableName: options.model.tableName,
    id: idOf(options.model._id),
  });
  return { data: options.model };
};

ModelAPI.updateById = async (options) => {
  window.__fixture.updates.push({
    tableName: new options.modelType().tableName,
    id: idOf(options.id),
  });
  return { data: options.data || {} };
};

ModelAPI.deleteItem = async (options) => {
  window.__fixture.updates.push({
    tableName: new options.modelType().tableName,
    id: idOf(options.id),
    deleted: true,
  });
  return {};
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
 * Russian and French are read from the server when asked for: each is
 * megabytes, and only the charts section draws them.
 */
const FETCHED_LOCALE =
  language === "ru" || language === "fr"
    ? await (await fetch(`/locales/${language}.json`)).json()
    : {};

/*
 * English, the fallback, is in the bundle; German, Japanese, Persian and
 * Chinese are each a chunk of its own, loaded only by a page drawn in that
 * language, as the Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts),
 * and built as the Dashboard ships them (server.js,
 * SuiteHelpers/FixtureLocalesBuild.js). Imported whole, they were parsed on
 * every page load of every test (#8366).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  ja: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/ja.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
  "zh-CN": () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/zh-CN.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    ...(await localeResources({
      language: language,
      english: EN,
      loaders: LOCALE_LOADERS,
    })),
    // Russian and French, served at /locales/ as a spec hands them.
    ru: { translation: FETCHED_LOCALE },
    fr: { translation: FETCHED_LOCALE },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Dates in the reader's language ("vor 2 Stunden"), as Utils/i18n.ts sets them.
followLanguageForDates(i18next);
document.documentElement.lang = language;
if (language === "fa") {
  document.documentElement.dir = "rtl";
}

const STYLES = Object.keys(ButtonStyleType).filter((key) => {
  return isNaN(Number(key));
});

function Buttons() {
  return (
    <div className="space-y-5" data-testid="section-buttons">
      <Card
        title="Every button style"
        description="Each style as it can be pressed, locked and busy."
      >
        <div className="space-y-3">
          {STYLES.map((name) => {
            const style = ButtonStyleType[name];
            return (
              <div
                key={name}
                className="flex flex-wrap items-center gap-3"
                data-testid={`style-row-${name}`}
              >
                <span className="w-56 font-mono text-xs text-gray-500">
                  {name}
                </span>
                <Button
                  title="Ping"
                  icon={IconProp.Refresh}
                  buttonStyle={style}
                  buttonSize={ButtonSize.Small}
                  dataTestId={`button-${name}`}
                  onClick={() => {}}
                />
                <Button
                  title="Ping"
                  icon={IconProp.Refresh}
                  buttonStyle={style}
                  buttonSize={ButtonSize.Small}
                  disabled={true}
                  dataTestId={`button-${name}-disabled`}
                />
                <Button
                  title="Ping"
                  buttonStyle={style}
                  buttonSize={ButtonSize.Small}
                  isLoading={true}
                  dataTestId={`button-${name}-loading`}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Locked with a reason"
        description="A locked button or switch says why when it is tapped, clicked or pointed at."
        buttons={[
          {
            title: "Reset API Key",
            icon: IconProp.Reload,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: true,
            tooltip: "Your role cannot change API keys.",
            onClick: () => {},
          },
          {
            title: "Refresh",
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.OUTLINE,
            onClick: () => {},
          },
        ]}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            title="Turn monitoring on"
            buttonStyle={ButtonStyleType.NORMAL}
            disabled={true}
            tooltip="Your role cannot change this monitor."
            dataTestId="locked-with-reason"
          />
          <MoreMenu
            menuIcon={IconProp.EllipsisHorizontal}
            text=""
            ariaLabel="Row options"
            dataTestId="bare-more-menu"
          >
            {[<MoreMenuItem key="a" text="Copy ID" onClick={() => {}} />]}
          </MoreMenu>
          <MoreMenu
            menuIcon={IconProp.Refresh}
            text="1m"
            ariaLabel="Auto-refresh"
            dataTestId="worded-more-menu"
          >
            {[<MoreMenuItem key="b" text="Every minute" onClick={() => {}} />]}
          </MoreMenu>
        </div>
        {/*
         * A switch somebody may not change, its reason behind the help icon
         * after its title (ModelSwitchRow draws a locked one so), and a
         * switch whose help icon says what it does.
         */}
        <div className="mt-5 space-y-4" data-testid="switches-with-help">
          <Toggle
            title="Show on status page"
            value={true}
            disabled={true}
            tooltip="You need one of these permissions: Project Owner, Project Admin."
            dataTestId="locked-switch"
            onChange={() => {}}
          />
          <Toggle
            title="When filters match, create an alert"
            value={false}
            tooltip="Alerts notify the team but are not shown on the status page."
            dataTestId="help-switch"
            onChange={() => {}}
          />
        </div>
      </Card>

      {/*
       * A button that is only its icon - a phone's menu toggle, a rule's
       * trash can - and buttons whose caller locks them for as long as
       * they work (disabled and isLoading on one flag).
       */}
      <Card
        title="Icons alone, and busy buttons"
        description="An icon in the middle of its button, and a button at work."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            icon={IconProp.Bars3}
            buttonStyle={ButtonStyleType.OUTLINE}
            className="p-2"
            dataTestId="icon-only-toggle"
            onClick={() => {}}
          />
          <Button
            title=""
            ariaLabel="Remove attribute filter 1"
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId="icon-only-trash"
            onClick={() => {}}
          />
          <Button
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId="icon-only-danger-trash"
            onClick={() => {}}
          />
          <Button
            title="Test connection"
            buttonStyle={ButtonStyleType.NORMAL}
            disabled={true}
            isLoading={true}
            dataTestId="busy-locked"
          />
          <Button
            title="Save"
            buttonStyle={ButtonStyleType.PRIMARY}
            disabled={true}
            isLoading={true}
            dataTestId="busy-locked-primary"
          />
          <Button
            title="Save"
            buttonStyle={ButtonStyleType.PRIMARY}
            disabled={true}
            dataTestId="locked-primary"
          />
        </div>
      </Card>

      <Card
        title="Connectivity tools"
        description="Ping or traceroute this device from its probe, and see its recent round-trip time."
      >
        <DeviceDiagnostics networkDeviceId={new ObjectID(DEVICE_ID)} />
      </Card>
    </div>
  );
}

function Dialogs() {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="space-y-5" data-testid="section-dialogs">
      <Card
        title="Probes"
        description="Where your monitors check from."
        buttons={[
          {
            title: "Edit Probe",
            icon: IconProp.Edit,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setIsEditing(true);
            },
          },
        ]}
      >
        <p className="text-sm text-gray-600">Frankfurt - The EU probe</p>
      </Card>

      {isEditing ? (
        <ModelFormModal
          title="Edit Probe"
          modelType={Probe}
          modelIdToEdit={new ObjectID(PROBE_ID)}
          submitButtonText="Save Changes"
          onClose={() => {
            setIsEditing(false);
          }}
          onSuccess={() => {
            setIsEditing(false);
          }}
          formProps={{
            id: "edit-probe",
            modelType: Probe,
            formType: FormType.Update,
            /*
             * It starts on a switch, which no autoFocus reaches: the first
             * focus has to wait for the read and move here itself.
             */
            fields: [
              {
                field: { shouldAutoEnableProbeOnNewMonitors: true },
                title: "Add to new monitors",
                fieldType: FormFieldSchemaType.Toggle,
                required: false,
              },
              {
                field: { name: true },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Probe name",
              },
              {
                field: { description: true },
                title: "Description",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
                placeholder: "What this probe is for",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * As a workflow's Settings page draws it: the copy opens in the
       * workflows list's route once it is made (navigateToOnSuccess).
       */}
      <DuplicateModel
        modelType={Workflow}
        modelId={new ObjectID(WORKFLOW_ID)}
        navigateToOnSuccess={new Route(`/dashboard/${PROJECT_ID}/workflows`)}
        fieldsToDuplicate={{ name: true }}
        fieldsToChange={[
          {
            field: { name: true },
            title: "New Workflow Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Workflow name",
          },
        ]}
      />

      <ResetObjectID
        modelType={ApiKey}
        fieldName="apiKey"
        title="Reset API Key"
        description="Reset the API Key to a new value."
        modelId={new ObjectID(API_KEY_ID)}
      />

      <ModelDelete
        modelType={Workflow}
        modelId={new ObjectID(WORKFLOW_ID)}
        onDeleteSuccess={() => {}}
      />
    </div>
  );
}

function TallBody() {
  return (
    <div
      data-testid="collapsible-tall-body"
      className="flex h-[6400px] flex-col justify-between rounded-md border border-dashed border-gray-300 p-3 text-sm text-gray-600"
    >
      <span>The top of a long section.</span>
      <button
        type="button"
        className="self-start rounded-md border border-gray-300 px-3 py-1 text-sm"
        data-testid="collapsible-end"
      >
        The end of a long section
      </button>
    </div>
  );
}

const MENU_ROWS = Array.from({ length: 90 }, (_value, index) => {
  return `Custom page ${index + 1}`;
});

function Sections() {
  return (
    <div className="space-y-5" data-testid="section-sections">
      <Card title="A long section" description="Folded until it is opened.">
        <CollapsibleSection title="Advanced Options" defaultCollapsed={true}>
          <TallBody />
        </CollapsibleSection>
      </Card>

      <aside
        className="w-64 rounded-xl border border-gray-200 bg-white p-2"
        data-testid="tall-side-menu"
      >
        <SideMenuSection title="Pages" defaultCollapsed={true}>
          {MENU_ROWS.map((row, index) => {
            return (
              <a
                key={row}
                href="#"
                className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                data-testid={
                  index === MENU_ROWS.length - 1 ? "side-menu-last" : undefined
                }
              >
                {row}
              </a>
            );
          })}
        </SideMenuSection>
      </aside>
    </div>
  );
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
  label("20000000-0000-4000-8000-000000000002", "EU", "#10b981"),
];

const SEVERITY_OPTIONS = [
  { value: "high", label: "High", color: new Color("#f97316") },
  { value: "low", label: "Low", color: new Color("#3b82f6") },
];

const PROBE_OPTIONS = [
  {
    value: "sg",
    label: "Singapore (ap-southeast-1) - Global probe",
  },
  {
    value: "fra",
    label: "Frankfurt (eu-central-1) - Global probe",
  },
  {
    value: "nv",
    label: "N. Virginia (us-east-1) - Global probe",
  },
];

// A single pick's lengths, shortest first, then Never.
const KEEP_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 0, label: "Never" },
];

function Pills() {
  const [picked, setPicked] = useState(["sg", "fra", "nv"]);
  const [kept, setKept] = useState(30);

  return (
    <div className="space-y-5" data-testid="section-pills">
      <Card title="One pill" description="A label, a yes/no and a choice.">
        <Detail
          item={{
            labels: LABELS,
            isPublic: true,
            isIndexed: false,
            severity: "high",
            region: "eu-central-1",
          }}
          showDetailsInNumberOfColumns={2}
          fields={[
            {
              key: "labels",
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: () => {
                return (
                  <span data-testid="pill-row-label">
                    <span className="inline-flex flex-wrap gap-2">
                      {LABELS.map((item) => {
                        return (
                          <span key={item.name}>
                            <LabelPill label={item} />
                          </span>
                        );
                      })}
                    </span>
                  </span>
                );
              },
            },
            { key: "isPublic", title: "Public", fieldType: FieldType.Boolean },
            {
              key: "isIndexed",
              title: "Indexed",
              fieldType: FieldType.Boolean,
            },
            {
              key: "severity",
              title: "Severity",
              fieldType: FieldType.Dropdown,
              dropdownOptions: SEVERITY_OPTIONS,
            },
            {
              key: "region",
              title: "Region",
              fieldType: FieldType.Dropdown,
              dropdownOptions: [],
            },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <InfoCard
          title="Ready"
          value="3 of 3"
          tooltip="Pods that passed their readiness check and receive traffic."
        />
        <InfoCard title="Restarts" value="0" />
        <InfoCard title="Uptime" value="99.98%" />
      </div>

      <Card
        title="Probes to Watch"
        description="The probes this monitor watches."
      >
        <div className="max-w-sm" data-testid="multi-select">
          <Dropdown
            ariaLabel="Probes"
            isMultiSelect={true}
            options={PROBE_OPTIONS}
            value={PROBE_OPTIONS.filter((option) => {
              return picked.includes(option.value);
            })}
            onChange={(value) => {
              setPicked(value || []);
            }}
          />
        </div>
        <div className="mt-4 max-w-sm" data-testid="entity-multi-select">
          <EntityDropdown
            ariaLabel="Teams"
            isMultiSelect={true}
            options={PROBE_OPTIONS}
            value={picked}
            onChange={(value) => {
              setPicked(value || []);
            }}
          />
        </div>
      </Card>

      {/*
       * One pick that can be changed and one that is locked, for what the
       * browser paints them (the UI review of #6389 found a locked one drawn
       * as white as an open one).
       */}
      <Card
        title="Keep Results For"
        description="How long this monitor's check results are kept."
      >
        <div className="grid max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
          <div data-testid="single-select">
            <Dropdown
              ariaLabel="Keep results for"
              options={KEEP_OPTIONS}
              value={KEEP_OPTIONS.find((option) => {
                return option.value === kept;
              })}
              isClearable={false}
              onChange={(value) => {
                setKept(value);
              }}
            />
          </div>
          <div data-testid="single-select-locked">
            <Dropdown
              ariaLabel="Keep results for, locked"
              options={KEEP_OPTIONS}
              value={KEEP_OPTIONS[1]}
              isClearable={false}
              disabled={true}
              onChange={() => {}}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

const PEOPLE = [
  { kind: PeoplePickerKind.User, name: "Ada Lovelace" },
  { kind: PeoplePickerKind.Team, name: "SRE" },
  { kind: PeoplePickerKind.Team, name: "Payments On-Call" },
  { kind: PeoplePickerKind.Team, name: "Platform" },
  { kind: PeoplePickerKind.Team, name: "Database Reliability" },
  { kind: PeoplePickerKind.Team, name: "Mobile" },
];

function Avatars() {
  return (
    <div className="space-y-5" data-testid="section-avatars">
      <Card title="Owners" description="People and teams who own this monitor.">
        <div className="flex flex-wrap items-center gap-4">
          {PEOPLE.map((person, index) => {
            return (
              <span
                key={person.name}
                className="inline-flex items-center gap-2"
                data-testid={`avatar-${index}`}
                data-kind={person.kind}
              >
                <PeopleAvatar item={person} size="md" />
                <span className="text-sm text-gray-700">{person.name}</span>
              </span>
            );
          })}
        </div>
        <div className="mt-4 flex -space-x-2" data-testid="avatar-stack">
          {PEOPLE.map((person) => {
            return <PeopleAvatar key={person.name} item={person} size="md" />;
          })}
        </div>
      </Card>
    </div>
  );
}

const THEME_CHOICES = [
  {
    value: "Light",
    title: "Light",
    description: "Every visitor sees the light page.",
    dataTestId: "choice-light",
  },
  {
    value: "Dark",
    title: "Dark",
    description: "Every visitor sees the dark page.",
    dataTestId: "choice-dark",
  },
  {
    value: "System",
    title: "Match each visitor's device",
    description: "Light or dark, as each visitor's device is set.",
    dataTestId: "choice-system",
  },
];

// A choice card's body, full bleed and ruled, as a Theme card draws it.
function RuledBody(props) {
  return <div className={useCardRuledBodyClassName()}>{props.children}</div>;
}

/*
 * The radios of a choice card (ChoiceRows) - one picked, then the same card
 * locked - and the checkboxes (Checkbox): ticked, not ticked, partly ticked
 * and locked, as forms and tables draw them.
 */
function Choices() {
  const [theme, setTheme] = useState("Dark");
  const [isTicked, setIsTicked] = useState(true);

  return (
    <div className="space-y-5" data-testid="section-choices">
      <Card title="Theme" description="How your status page looks to visitors.">
        <RuledBody>
          <ChoiceRows
            value={theme}
            options={THEME_CHOICES}
            onPick={(value) => {
              setTheme(value);
            }}
            ariaLabel="Status page theme"
            dataTestId="choice-rows"
          />
        </RuledBody>
      </Card>
      <Card title="Theme, locked" description="Somebody who may not edit it.">
        <RuledBody>
          <ChoiceRows
            value="Dark"
            options={THEME_CHOICES.map((choice) => {
              return { ...choice, dataTestId: `locked-${choice.dataTestId}` };
            })}
            onPick={() => {}}
            lockedReason="You do not have permission to edit this status page."
            ariaLabel="Locked status page theme"
            dataTestId="choice-rows-locked"
          />
        </RuledBody>
      </Card>
      <Card title="Notifications" description="Who hears about it.">
        <div className="space-y-3" data-testid="checkboxes">
          <Checkbox
            title="Notify subscribers"
            value={isTicked}
            onChange={(value) => {
              setIsTicked(value);
            }}
            dataTestId="checkbox-ticked"
          />
          <Checkbox
            title="Include resolved incidents"
            value={false}
            onChange={() => {}}
            dataTestId="checkbox-unticked"
          />
          <Checkbox
            title="Some monitors"
            value={false}
            isIndeterminate={true}
            onChange={() => {}}
            dataTestId="checkbox-partly"
          />
          <Checkbox
            title="Locked"
            value={true}
            disabled={true}
            onChange={() => {}}
            dataTestId="checkbox-locked"
          />
        </div>
      </Card>
    </div>
  );
}

/*
 * A rule's conditions (RuleCriteriaBuilder) at the widths a rule form gives
 * them: a phone's dialog, a dialog beside its steps, a dialog with no steps
 * and a page. Each row lays itself out by the room its list of conditions
 * has (RuleCriteriaRowLayout), not by the window. Two conditions, one with
 * the longest operator there is ("Does not match pattern").
 */
const RULE_FIELDS = [
  {
    field: { title: true },
    title: "Incident Title",
    fieldType: FormFieldSchemaType.Text,
  },
  {
    field: { labels: true },
    title: "Labels",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownOptions: [
      { label: "Production", value: "production" },
      { label: "Payments", value: "payments" },
    ],
  },
];

const RULE_CRITERIA = {
  schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
  filterCondition: FilterCondition.All,
  filters: [
    {
      field: "title",
      operator: "DoesNotMatchPattern",
      value: "^staging-",
    },
    {
      field: "labels",
      operator: "HasAnyOf",
      value: ["production"],
    },
  ],
};

/*
 * The widths rule forms give their builder. The list of conditions inside
 * is some 62px narrower (the indent under "Applies to" from 640px, and the
 * conditions' own frame): 314px, as on a 390px phone; 478px, as in a
 * dialog beside its steps; 658px, as in a dialog with none; 914px, a page.
 */
const RULE_WIDTHS = [
  { name: "phone", width: 376, caption: "As on a phone" },
  { name: "dialog", width: 540, caption: "As in a dialog beside its steps" },
  {
    name: "wide-dialog",
    width: 720,
    caption: "As in a dialog with no steps",
  },
  { name: "page", width: 976, caption: "As on a page" },
];

function RuleConditions(props) {
  const [criteria, setCriteria] = useState(RULE_CRITERIA);

  return (
    <div
      className="w-full space-y-2"
      style={{ maxWidth: props.width }}
      data-testid={`rules-${props.name}`}
    >
      <p className="text-xs font-medium text-gray-500">{props.caption}</p>
      <RuleCriteriaBuilder
        fields={RULE_FIELDS}
        value={criteria}
        onChange={setCriteria}
        subject="Incidents"
      />
    </div>
  );
}

function Rules() {
  return (
    <div className="space-y-5" data-testid="section-rules">
      {RULE_WIDTHS.map((each) => {
        return (
          <RuleConditions
            key={each.name}
            name={each.name}
            width={each.width}
            caption={each.caption}
          />
        );
      })}
    </div>
  );
}

/*
 * Metric charts as a page of them draws them (#8048, #8049): the
 * Kubernetes Control Plane's etcd and API server charts in a ChartGroup's
 * cards and in its card-less stack, on a zoomable page, with a request
 * rate whose ticks run to 1.85K req/s. The page hands each chart its words
 * in the reader's language, as the pages do.
 */
const CHART_START = new Date("2026-11-15T11:00:00.000Z");
const CHART_END = new Date("2026-11-15T12:00:00.000Z");

function chartSeries(name, valueAt) {
  return {
    seriesName: name,
    data: Array.from({ length: 60 }, (_, minute) => {
      return {
        x: new Date(CHART_START.getTime() + minute * 60000),
        y: valueAt(minute),
      };
    }),
  };
}

function Charts() {
  const translator = useTranslator();
  const zoomed = params.get("zoomed") === "1";
  const words = (text) => {
    return translator.translateText(text) || text;
  };
  const chart = (id, title, legend, unit, valueAt) => {
    return {
      id: id,
      title: words(title),
      description: words("Size of the etcd database on disk."),
      type: ChartType.LINE,
      metricInfo: { metricName: id, aggregationType: "Avg", unit: unit },
      onOpenInExplorer: () => {},
      props: {
        data: [chartSeries(words(legend), valueAt)],
        xAxis: {
          legend: "",
          options: {
            type: XAxisType.Time,
            min: CHART_START,
            max: CHART_END,
            aggregateType: XAxisAggregateType.Average,
          },
        },
        yAxis: {
          legend: unit,
          options: {
            type: YAxisType.Number,
            min: 0,
            max: "auto",
            precision: YAxisPrecision.NoDecimals,
            formatter: (value) => {
              return ValueFormatter.formatValue(value, unit, {
                language: language,
              });
            },
          },
        },
        curve: ChartCurve.MONOTONE,
        sync: true,
      },
    };
  };
  const charts = [
    chart(
      "etcd_mvcc_db_total_size_in_bytes",
      "Database Size",
      "Size",
      "By",
      (minute) => {
        return 52000000 + minute * 90000;
      },
    ),
    chart(
      "apiserver_request_total",
      "Request Rate",
      "Requests",
      "req/s",
      (minute) => {
        return 900 + Math.round(950 * Math.abs(Math.sin(minute / 9)));
      },
    ),
    chart("etcd_debugging_mvcc_keys_total", "Total Keys", "Keys", "", () => {
      return 1840;
    }),
  ];

  return (
    <TimeRangeZoomProvider
      zoom={{
        isZoomed: zoomed,
        rangeBeforeZoom: zoomed ? { range: "Past 1 Hour" } : null,
        timeRange: { range: "Past 1 Hour" },
        zoomToTimeRange: () => {},
        resetZoom: () => {},
      }}
    >
      <div className="space-y-8" data-testid="section-charts">
        <div data-testid="chart-cards">
          <ChartGroup charts={charts} />
        </div>
        <div
          className="rounded-lg border border-gray-200 bg-white"
          data-testid="chart-stack"
        >
          <ChartGroup charts={charts} hideCard={true} />
        </div>
      </div>
    </TimeRangeZoomProvider>
  );
}

/*
 * The controls #9136 made work from the keyboard and under a finger: two
 * rows of tabs on one page whose names hold spaces, the header's
 * notification bell, a form's steps with one finished, and attribute
 * filter chips that must wrap on a phone. What each is pressed with lands
 * on [data-testid=keyboard-log].
 */
const BELL_ITEMS = [
  {
    id: "active-incidents",
    icon: IconProp.Alert,
    title: "2 Active Incidents",
    count: 2,
    alertType: HeaderAlertType.ERROR,
  },
  {
    id: "on-call",
    icon: IconProp.Call,
    title: "You are on call",
    count: 1,
    alertType: HeaderAlertType.SUCCESS,
  },
  /*
   * "Finish setting up your notifications" (#7040), as the Dashboard's
   * header draws it: amber, under On-Call, why under its title, and Hide
   * beside it (its Hide is added where the bell is drawn, to log it).
   */
  {
    id: "notificationSetup",
    icon: IconProp.BellAlert,
    title: "Finish setting up your notifications",
    description: "Nothing can reach you yet.",
    count: 1,
    alertType: HeaderAlertType.WARNING,
    section: NotificationBellSection.OnCall,
    dismissTitle: "Hide for a week",
  },
];

const FORM_STEPS = [
  { id: "monitor-info", title: "Monitor Info" },
  { id: "criteria", title: "Criteria" },
  { id: "notifications", title: "Notifications" },
];

const ATTRIBUTE_FILTERS = [
  { key: "attributes", title: "Attributes", type: FieldType.JSON },
];

/*
 * #9222 and #9223: a table cell whose column explains its value
 * (tooltipText), and a network diagram's bands and addresses.
 */
const QUOTA_COLUMNS = [
  { key: "name", title: "Name", type: FieldType.Text },
  {
    key: "quota",
    title: "Quota",
    type: FieldType.Number,
    tooltipText: () => {
      return "Counted since the first of the month.";
    },
  },
];

const CONVERSATIONS = [
  {
    sourceIp: "10.0.0.5",
    destinationIp: "10.0.0.9",
    octets: 9000000,
    packets: 9000,
  },
  {
    sourceIp: "10.0.0.7",
    destinationIp: "8.8.8.8",
    octets: 3000000,
    packets: 3000,
  },
];

/*
 * A stepped edit dialog whose steps are all filled in, as Admin Dashboard >
 * Settings > Email > Edit SMTP Config is: Next on the first step, the save
 * on the last only, and the step list able to open any step (#9245).
 */
const MAIL_SERVER_STEPS = [
  { id: "server", title: "Server" },
  { id: "sender", title: "Sender" },
];

const MAIL_SERVER_FIELDS = [
  {
    field: { host: true },
    title: "Hostname",
    stepId: "server",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "smtp.server.com",
  },
  {
    field: { fromName: true },
    title: "From Name",
    stepId: "sender",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "Company, Inc.",
  },
];

function Keyboard() {
  const [log, setLog] = useState([]);
  const [stepId, setStepId] = useState("criteria");
  const [isEditingMailServer, setIsEditingMailServer] = useState(false);
  const say = (line) => {
    setLog((lines) => {
      return [...lines, line];
    });
  };

  return (
    <div className="space-y-5" data-testid="section-keyboard">
      <div className="flex justify-end" data-testid="bell-holder">
        <NotificationBell
          items={BELL_ITEMS.map((item) => {
            return item.dismissTitle
              ? {
                  ...item,
                  onDismiss: () => {
                    say(`bell-hide:${item.id}`);
                  },
                }
              : item;
          })}
          onItemClick={(item) => {
            say(`bell:${item.id}`);
          }}
        />
      </div>
      <Card title="Incident rules" description="Two rows of tabs on a page.">
        <Tabs
          label="Incident On-Call Rules"
          tabs={[
            {
              name: "Incident Rules",
              children: <p>Rules for incidents.</p>,
            },
            { name: "Episode Rules", children: <p>Rules for episodes.</p> },
          ]}
          onTabChange={() => {}}
        />
        <Tabs
          label="Notification Methods"
          tabs={[
            { name: "Email", children: <p>Email addresses.</p> },
            { name: "SMS", children: <p>Phone numbers.</p> },
          ]}
          onTabChange={() => {}}
        />
      </Card>
      <Card title="Create monitor" description="A form's steps.">
        <Steps
          steps={FORM_STEPS}
          currentFormStepId={stepId}
          formValues={{}}
          onClick={(step) => {
            setStepId(step.id);
            say(`step:${step.id}`);
          }}
        />
      </Card>
      <Card
        title="Mail server"
        description="A stepped edit dialog."
        buttons={[
          {
            title: "Edit SMTP Config",
            icon: IconProp.Edit,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setIsEditingMailServer(true);
            },
          },
        ]}
      >
        <p className="text-sm text-gray-600">smtp.example.com</p>
      </Card>
      {isEditingMailServer ? (
        <BasicFormModal
          title="Edit SMTP Config"
          submitButtonText="Save Changes"
          onClose={() => {
            setIsEditingMailServer(false);
          }}
          onSubmit={(values) => {
            say(`saved:${values.host}|${values.fromName}`);
            setIsEditingMailServer(false);
          }}
          formProps={{
            id: "edit-mail-server",
            steps: MAIL_SERVER_STEPS,
            allowAnyStepNavigation: true,
            initialValues: {
              host: "smtp.example.com",
              fromName: "Example Status",
            },
            fields: MAIL_SERVER_FIELDS,
          }}
        />
      ) : null}
      <Card title="Logs" description="Attribute filter chips.">
        <FilterViewer
          id="logs"
          filters={ATTRIBUTE_FILTERS}
          filterData={{
            attributes: {
              "service.name": "checkout",
              "k8s.pod.name": "checkout-7d9f8b6c5d-abcde-with-a-long-suffix",
              "host.name": "prod-eu-west-1-node-17",
              "deployment.environment": "production",
            },
          }}
          showFilterModal={false}
          pluralLabel="Logs"
        />
      </Card>
      <Card title="Usage" description="A cell whose column explains it.">
        <table data-testid="keyboard-table">
          <tbody>
            <TableRow
              item={{ _id: "1", name: "Ingest", quota: 42 }}
              columns={QUOTA_COLUMNS}
              isMobile={false}
            />
          </tbody>
        </table>
      </Card>
      <Card title="Conversations" description="Who talks to whom.">
        <TrafficConversationDiagram
          conversations={CONVERSATIONS}
          onSelectConversation={(source, destination) => {
            say(`conversation:${source}>${destination}`);
          }}
          onSelectSource={(address) => {
            say(`source:${address}`);
          }}
          onSelectDestination={(address) => {
            say(`destination:${address}`);
          }}
        />
      </Card>
      <Card title="Import subscribers" description="A CSV dropped or chosen.">
        <CSVFileUpload
          columns={[
            { key: "email", title: "Email", required: true },
            { key: "name", title: "Name", required: false },
          ]}
          onDataChanged={(rows) => {
            say(`csv:${rows.length}`);
          }}
        />
      </Card>
      <ol data-testid="keyboard-log">
        {log.map((line, index) => {
          return <li key={index}>{line}</li>;
        })}
      </ol>
    </div>
  );
}

/*
 * Empty and loading states (#9135): the same card empty, loading with the
 * shared bars, and a page's content area loading, so the suite can measure
 * that nothing jumps when content arrives and that an empty card's message
 * starts near its title on a phone.
 */
function States() {
  const probesDescription =
    "Probes check this monitor from different places in the world.";
  return (
    <div className="space-y-6" data-testid="section-states">
      <div data-testid="state-empty-card">
        <Card title="Probes" description={probesDescription}>
          <EmptyState
            id="state-empty-card-state"
            icon={IconProp.Globe}
            title="No probes yet"
            description="Add a probe to check this monitor from another place."
          />
        </Card>
      </div>
      <div data-testid="state-loading-card">
        <Card title="Probes" description={probesDescription}>
          <ComponentLoader />
        </Card>
      </div>
      <div data-testid="state-page-loader-card">
        <Card title="Probes" description={probesDescription}>
          <PageLoader isVisible={true} />
        </Card>
      </div>
      <div data-testid="state-empty-inline">
        <Card title="Steps" description="What the runbook does, in order.">
          <EmptyState
            id="state-empty-inline-state"
            size={EmptyStateSize.Inline}
            icon={IconProp.List}
            title="No steps yet"
            description="Add the first step this runbook runs."
          />
        </Card>
      </div>
      <div data-testid="state-page-loading">
        <SharedPage
          title="Monitor"
          breadcrumbLinks={[
            { title: "Project", to: new Route(PAGE) },
            { title: "Monitors", to: new Route(PAGE) },
          ]}
          isLoading={true}
        >
          <p>Never drawn while loading.</p>
        </SharedPage>
      </div>
      <div data-testid="state-empty-page">
        <EmptyState
          id="state-empty-page-state"
          size={EmptyStateSize.Page}
          icon={IconProp.Lock}
          title="Ask to join a project"
          description="Your administrator has turned off creating projects. Ask a project's owner to invite you."
        />
      </div>
    </div>
  );
}

/*
 * Content skeletons (#9220): each shared skeleton beside the content it
 * stands in for, in the same card, so the suite can measure that a card
 * opens at about the height it ends at, in both themes and on a phone.
 */
const SKELETON_ROWS = [
  ["api-gateway", "Running", "3 of 3", "2 hours ago"],
  ["checkout", "Running", "2 of 2", "5 hours ago"],
  ["payments", "Pending", "0 of 1", "1 minute ago"],
];

function Skeletons() {
  return (
    <div className="space-y-6" data-testid="section-skeletons">
      <div data-testid="skeleton-pair-tiles" className="space-y-4">
        <div
          data-testid="skeleton-loaded-tiles"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <InfoCard title="Pods" value="42" />
          <InfoCard title="Nodes" value="6" />
          <InfoCard title="Restarts" value="0" />
          <InfoCard title="Uptime" value="99.98%" />
        </div>
        <div data-testid="skeleton-loading-tiles">
          <StatTilesSkeleton count={4} />
        </div>
      </div>

      <div data-testid="skeleton-loaded-details">
        <Card title="Cluster" description="What the agent reported last.">
          <Detail
            item={{
              name: "production-eu",
              version: "1.31.2",
              provider: "EKS",
              region: "eu-central-1",
            }}
            showDetailsInNumberOfColumns={2}
            fields={[
              { key: "name", title: "Name", fieldType: FieldType.Text },
              { key: "version", title: "Version", fieldType: FieldType.Text },
              { key: "provider", title: "Provider", fieldType: FieldType.Text },
              { key: "region", title: "Region", fieldType: FieldType.Text },
            ]}
          />
        </Card>
      </div>
      <div data-testid="skeleton-loading-details">
        <Card title="Cluster" description="What the agent reported last.">
          <DetailListSkeleton fields={4} columns={2} />
        </Card>
      </div>

      <div data-testid="skeleton-loaded-table">
        <Card title="Deployments" description="What runs in this namespace.">
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="h-10 px-3 text-start font-medium">Name</th>
                  <th className="h-10 px-3 text-start font-medium">Status</th>
                  <th className="h-10 px-3 text-start font-medium">Ready</th>
                  <th className="h-10 px-3 text-start font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {SKELETON_ROWS.map((row) => {
                  return (
                    <tr key={row[0]} className="border-b border-gray-100">
                      {row.map((cell) => {
                        return (
                          <td key={cell} className="px-3 py-3 leading-6">
                            {cell}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <div data-testid="skeleton-loading-table">
        <Card title="Deployments" description="What runs in this namespace.">
          <TableSkeleton rows={3} columns={4} />
        </Card>
      </div>

      <div data-testid="skeleton-loading-chart">
        <Card title="CPU" description="Across every node, each minute.">
          <ChartSkeleton />
        </Card>
      </div>

      <div data-testid="skeleton-loaded-cards">
        <Card title="Integrations" description="Where alerts are sent.">
          <div className="space-y-3">
            {["Slack", "Microsoft Teams", "PagerDuty"].map((name) => {
              return (
                <div
                  key={name}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="flex h-6 items-center text-sm font-medium text-gray-900">
                    {name}
                  </div>
                  <p className="mt-2 text-sm leading-5 text-gray-500">
                    Sends each new incident.
                  </p>
                  <p className="mt-2 text-sm leading-5 text-gray-500">
                    Connected by Ada.
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div data-testid="skeleton-loading-cards">
        <Card title="Integrations" description="Where alerts are sent.">
          <CardListSkeleton count={3} lines={2} />
        </Card>
      </div>

      <div data-testid="skeleton-loading-page">
        <PageSkeleton shape="table" />
      </div>
    </div>
  );
}

const SECTIONS = {
  buttons: Buttons,
  dialogs: Dialogs,
  sections: Sections,
  pills: Pills,
  avatars: Avatars,
  choices: Choices,
  rules: Rules,
  // Only when asked for: the gallery of every part leaves them out.
  charts: Charts,
  keyboard: Keyboard,
  states: States,
  skeletons: Skeletons,
};

const ONLY_WHEN_ASKED_FOR = ["charts", "states", "skeletons", "keyboard"];

function Gallery() {
  const shown =
    section === "all"
      ? Object.keys(SECTIONS).filter((name) => {
          return !ONLY_WHEN_ASKED_FOR.includes(name);
        })
      : [section].filter(Boolean);

  return (
    <div className="space-y-8" data-testid="shared-ui-gallery">
      {shown.map((name) => {
        const Section = SECTIONS[name];
        return Section ? <Section key={name} /> : null;
      })}
    </div>
  );
}

const PAGE = `/dashboard/${PROJECT_ID}/shared-ui`;

/*
 * A record's pages as Page draws them with a side menu: the real SideMenu
 * beside the cards, in the same flex row and gaps, so the cards are
 * measured at the width they get on a laptop and a tablet.
 */
function WithSideMenu(props) {
  return (
    <div className="mx-auto max-w-full pb-10" data-testid="side-menu-layout">
      <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
        <SideMenu>
          <SideMenuSection title="Workflow">
            <SideMenuItem
              link={{ title: "Overview", to: new Route(PAGE) }}
              icon={IconProp.Info}
            />
            <SideMenuItem
              link={{ title: "Runs", to: new Route(`${PAGE}/runs`) }}
              icon={IconProp.List}
            />
          </SideMenuSection>
          <SideMenuSection title="Advanced">
            <SideMenuItem
              link={{ title: "Settings", to: new Route(`${PAGE}/settings`) }}
              icon={IconProp.Settings}
            />
            <SideMenuItem
              link={{
                title: "Delete Workflow",
                to: new Route(`${PAGE}/delete`),
              }}
              icon={IconProp.Trash}
              className="danger-on-hover"
            />
          </SideMenuSection>
        </SideMenu>
        <div className="space-y-6 flex-1 min-w-0">{props.children}</div>
      </div>
    </div>
  );
}

// What App.tsx does for every page: the router's hooks, handed to Navigation.
function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  if (layout === "side-menu") {
    return (
      <div className="mb-auto mt-5 h-max max-w-full px-4 sm:px-6 lg:px-8">
        <WithSideMenu>{props.children}</WithSideMenu>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {props.children}
    </div>
  );
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/shared-ui"
        element={
          <Shell>
            <Gallery />
          </Shell>
        }
      />
    </Routes>
  </BrowserRouter>,
);
