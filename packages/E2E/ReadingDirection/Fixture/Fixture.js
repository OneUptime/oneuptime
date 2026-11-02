/*
 * Offline fixture for the reading direction: the shared components a
 * right-to-left page changes, drawn in the Dashboard's words for the
 * language asked for. <html lang> and <html dir> are set by the production
 * helper (Common/UI/Utils/PageLanguage) from the i18next instance, as every
 * frontend's i18n set-up does; dates follow the language as they do there
 * (Common/UI/Utils/DateDisplayLanguage).
 *
 * One page, /reading-direction, steered by the query string:
 *   - lang=en|de|fa|ko   the language (and so the direction) of the page
 *   - theme=dark         (read by server.js) the Dashboard's dark mode
 *   - dialog=open        a dialog over the page
 *   - drawer=open        a side panel (SideOver) over the page
 *   - width=<px>         how wide the overflowing table's card is (560)
 *
 * The components are the production ones: the switch (Toggle), the status
 * dot (StatusBubble), a table whose Actions column sticks at its end
 * (Table), a dialog (Modal), a side panel (SideOver), notes in the
 * Markdown viewer and editor, a
 * folded More fields line (FoldedSection), a side menu section, the
 * breadcrumbs, the product bar (NavBar: Home and Products, and a product
 * that is open), pagination, a keyboard shortcut, code, dates, and Korean
 * words in a box too narrow for them.
 *
 * And what a page says back and what it cuts short: a field's error and a
 * form's (Input, Alert) with an English answer from the server; a table of
 * people (the Dashboard's UserElement) and of long plain values cut short
 * to their column; a folded products menu category (NavBarCategoryToggle);
 * a sentence that puts a time after a name in Latin letters
 * (TranslatedSentence); a field whose popup opens from its start edge
 * (ColorPicker); a React Flow canvas with a node and a line; and a note
 * whose diagrams have labels in English and in Persian. A note's editor
 * with an English error, and a narrow month whose English and Persian
 * events are cut short to their blocks (Calendar).
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
import { initReactI18next } from "react-i18next";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Breadcrumbs from "Common/UI/Components/Breadcrumbs/Breadcrumbs";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Detail from "Common/UI/Components/Detail/Detail";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import ColorPicker from "Common/UI/Components/Forms/Fields/ColorPicker";
import NavBarCategoryToggle from "Common/UI/Components/Navbar/NavBarCategoryToggle";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ReactFlow, { Controls } from "reactflow";
import "reactflow/dist/style.css";
import Icon from "Common/UI/Components/Icon/Icon";
import KeyboardShortcut, {
  KeyboardKey,
} from "Common/UI/Components/KeyboardShortcut/KeyboardShortcut";
import MarkdownEditor from "Common/UI/Components/Markdown.tsx/MarkdownEditor";
import Calendar from "Common/UI/Components/Calendar/Calendar";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Modal from "Common/UI/Components/Modal/Modal";
import NavBar from "Common/UI/Components/Navbar/NavBar";
import Pagination from "Common/UI/Components/Pagination/Pagination";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import SideOver from "Common/UI/Components/SideOver/SideOver";
import StatusBubble from "Common/UI/Components/StatusBubble/StatusBubble";
import Table from "Common/UI/Components/Table/Table";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import KO from "../../../App/FeatureSet/Dashboard/src/Locales/ko.json";
import UserElement from "../../../App/FeatureSet/Dashboard/src/Components/User/User";

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa", "ko"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const isDialogOpen = params.get("dialog") === "open";
const isDrawerOpen = params.get("drawer") === "open";
/*
 * The table's card: 800px, 48rem or wider, where a table too wide for it
 * scrolls sideways - in a narrower one it is drawn as cards (TableFit).
 */
const tableWidth = Number(params.get("width") || 800);

// The production helpers, handed the page's i18next instance before it starts.
followLanguageForPage(i18next);
followLanguageForDates(i18next);

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    fa: { translation: FA },
    ko: { translation: KO },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

// One moment for every date the page writes.
const WRITTEN_AT = new Date("2026-10-26T15:07:00.000Z");

const ENGLISH_NOTE = [
  "Customers cannot pay. Started at 09:12.",
  "",
  "- Payments gateway timeouts",
  "- Retry storm from the mobile app",
].join("\n");

const PERSIAN_NOTE = [
  "زمان پاسخ جستجو بیش از ۳ ثانیه است.",
  "",
  "The search cluster lost one node at 10:05.",
].join("\n");

/*
 * What an incident's feed writes when it is created: its title (here in
 * Persian), its description, and the product's own English lines and list.
 */
const FEED_NOTE = [
  "**کندی در جستجوی محصولات**:",
  "",
  "The search cluster lost one node at 10:05.",
  "",
  "**Resources Affected**:",
  "",
  "- [Checkout API](/reading-direction)",
  "- [Payments gateway](/reading-direction)",
].join("\n");

// A Persian list with one item in English.
const MIXED_LIST_NOTE = [
  "- پایگاه داده اصلی را بررسی کنید",
  "- صف پیام‌ها را خالی کنید",
  "- Restart the checkout service.",
].join("\n");

/*
 * Korean words as a narrow metric tile's title would draw them, on every
 * page: page load time, throughput, error rate, response time. Korean puts
 * spaces between its words; a browser breaks it between any two syllables
 * unless the page says it is Korean (Theme.css, html:lang(ko)).
 */
const KOREAN_WORDS = "페이지 로드 시간 처리량 오류율 응답 시간";

// A Persian sentence that starts with an English word.
const PERSIAN_FROM_AN_ENGLISH_WORD_NOTE =
  "`kubectl` را روی کلاستر پرداخت دوباره اجرا کنید.";

const ROWS = [
  {
    _id: "row-1",
    name: "Checkout API",
    kind: "Website",
    region: "eu-west-1, eu-central-1",
    owner: "Payments team",
    description: "Watches the checkout endpoint every minute.",
    createdAt: "2026-03-04T09:30:00.000Z",
    checks: 43200,
    lastCheckedAt: "2026-10-16T05:34:00.000Z",
  },
  {
    _id: "row-2",
    name: "پنل مدیریت فروشگاه",
    kind: "API",
    region: "me-central-1",
    owner: "Store team",
    description: "Watches the store's admin panel.",
    createdAt: "2026-05-11T14:05:00.000Z",
    checks: 1440,
    lastCheckedAt: "2026-10-16T05:30:00.000Z",
  },
];

/*
 * A feed's owner and its last poll's summary: an English name and an
 * English sentence, each longer than its column, which cuts them short.
 * The owners have no id, so each is drawn with the blank picture the
 * fixture serves rather than one from a server it does not have.
 */
const FEED_ROWS = [
  {
    _id: "row-feed-1",
    owner: {
      name: "José Ignacio Negro de la Vega Fernández de Córdoba",
      email: "jose.ignacio.negro@acme-commerce.example",
    },
    summary:
      "Polled 4,812 indicators from the AlienVault OTX pulse feed; 12 were new and 3 were revoked.",
  },
  {
    _id: "row-feed-2",
    owner: {
      name: "سارا احمدی",
      email: "sara@acme-commerce.example",
    },
    summary: "Up to date.",
  },
];

const FEED_COLUMNS = [
  {
    title: "Owner",
    type: FieldType.Text,
    key: "owner",
    getElement: (row) => {
      return <UserElement user={row.owner} />;
    },
  },
  { title: "Last Poll Summary", type: FieldType.Text, key: "summary" },
];

/*
 * A month's events, each longer than its day in a narrow calendar: an
 * English title and a Persian one, cut short to their blocks.
 */
const CALENDAR_EVENTS = [
  {
    id: 1,
    title: "Database upgrade for the payments cluster",
    start: new Date("2026-10-14T09:00:00.000Z"),
    end: new Date("2026-10-14T11:00:00.000Z"),
    color: "#6366f1",
  },
  {
    id: 2,
    title: "به‌روزرسانی سرور پایگاه داده پرداخت",
    start: new Date("2026-10-15T09:00:00.000Z"),
    end: new Date("2026-10-15T11:00:00.000Z"),
    color: "#059669",
  },
  // A title short enough for its day: it starts where the page's lines do.
  {
    id: 3,
    title: "ارتقا",
    start: new Date("2026-10-21T09:00:00.000Z"),
    end: new Date("2026-10-21T10:00:00.000Z"),
    color: "#d97706",
  },
];

// A time after a name in Latin letters, in the page's own words.
const READ_FROM_TIME = {
  en: "4 minutes ago",
  de: "vor 4 Minuten",
  fa: "۴ دقیقه پیش",
};

// A node and the line out of it, at fixed places on the canvas.
const FLOW_NODES = [
  {
    id: "payments",
    position: { x: 40, y: 30 },
    data: {
      label: language === "fa" ? "درگاه پرداخت." : "Payments gateway.",
    },
  },
  // A workflow step's description, from the step catalogue: English.
  {
    id: "checkout",
    position: { x: 300, y: 140 },
    data: { label: "Charges the card." },
  },
];

const FLOW_EDGES = [
  { id: "payments-checkout", source: "payments", target: "checkout" },
];

const COLUMNS = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Monitor Type", type: FieldType.Text, key: "kind" },
  { title: "Description", type: FieldType.Text, key: "description" },
  { title: "Regions", type: FieldType.Text, key: "region" },
  { title: "Owners", type: FieldType.Text, key: "owner" },
  /*
   * Values a table never cuts short - two dates and a count - so the rows
   * run past their 800px card even given way, and scroll under the stuck
   * Actions column.
   */
  { title: "Created", type: FieldType.Date, key: "createdAt" },
  { title: "Checks", type: FieldType.Number, key: "checks" },
  { title: "Last Checked", type: FieldType.DateTime, key: "lastCheckedAt" },
  // A row's View: the column that sticks at the table's end.
  { title: "Actions", type: FieldType.Actions },
];

function Section(props) {
  return (
    <section className="mb-6" data-testid={`section-${props.name}`}>
      {props.children}
    </section>
  );
}

function Page() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const [isOn, setIsOn] = useState(true);
  const [dialog, setDialog] = useState(isDialogOpen);
  const [drawer, setDrawer] = useState(isDrawerOpen);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Section name="product-bar">
        {/*
         * The bar every page of the Dashboard opens with: Home, then the
         * products menu - once with no product open, once with this page's
         * product open.
         */}
        <div className="bg-white px-4" data-testid="product-bar-home-only">
          <NavBar
            items={[
              {
                id: "home-nav-bar-item",
                title: "Home",
                icon: IconProp.Home,
                route: new Route("/home"),
                exact: true,
              },
            ]}
            moreMenuItems={[
              {
                title: "Incidents",
                description: "Respond to what is going wrong.",
                route: new Route("/incidents"),
                icon: IconProp.Alert,
                category: "Essentials",
              },
            ]}
          />
        </div>
        <div className="bg-white px-4" data-testid="product-bar-product-open">
          <NavBar
            items={[
              {
                id: "home-nav-bar-item",
                title: "Home",
                icon: IconProp.Home,
                route: new Route("/home"),
                exact: true,
              },
            ]}
            moreMenuItems={[
              {
                title: "Monitors",
                description: "Watch what matters.",
                route: new Route("/reading-direction"),
                activeRoute: new Route("/reading-direction"),
                icon: IconProp.AltGlobe,
                category: "Essentials",
              },
            ]}
          />
        </div>
      </Section>

      <Section name="breadcrumbs">
        <Breadcrumbs
          links={[
            { title: "Project", to: new Route("/reading-direction") },
            { title: "Monitors", to: new Route("/reading-direction") },
            { title: "Checkout API", to: new Route("/reading-direction") },
          ]}
        />
      </Section>

      <Section name="spacing">
        {/*
         * A plain left and right utility: the box's margin and padding at
         * the start and the end of the line, and a mark pinned to its end.
         */}
        <div className="relative w-80 border border-gray-200 bg-white">
          <div
            className="ml-6 mr-2 pl-4 pr-1 text-left"
            data-testid="spacing-box"
          >
            <span data-testid="spacing-text">
              {language === "fa" ? "متن" : "Text"}
            </span>
          </div>
          <span
            className="absolute right-0 top-0 h-2 w-2 bg-indigo-600"
            data-testid="spacing-end-mark"
          ></span>
        </div>
      </Section>

      <Section name="toggles">
        <div className="space-y-3 bg-white p-4">
          <Toggle
            title="Enabled"
            value={isOn}
            onChange={setIsOn}
            dataTestId="toggle-on"
          />
          <Toggle
            title="Notify the team"
            value={false}
            onChange={() => {}}
            dataTestId="toggle-off"
          />
        </div>
      </Section>

      <Section name="status">
        <div className="w-60 bg-white p-4" data-testid="status-box">
          <StatusBubble
            text="Operational"
            color={new Color("#10b981")}
            shouldAnimate={false}
          />
        </div>
      </Section>

      <Section name="table">
        <div style={{ width: `${tableWidth}px` }}>
          <Card title="Monitors" description="Every monitor in this project.">
            <Table
              id="reading-direction-table"
              data={ROWS}
              columns={COLUMNS}
              singularLabel="Monitor"
              pluralLabel="Monitors"
              currentPageNumber={1}
              totalItemsCount={ROWS.length}
              itemsOnPage={10}
              onNavigateToPage={() => {}}
              error=""
              isLoading={false}
              sortOrder={SortOrder.Ascending}
              sortBy={null}
              onSortChanged={() => {}}
              actionButtons={[
                {
                  title: "View",
                  icon: IconProp.ChevronRight,
                  buttonStyleType: ButtonStyleType.NORMAL,
                  onClick: (_item, onComplete) => {
                    onComplete();
                  },
                },
              ]}
            />
          </Card>
        </div>
      </Section>

      {/*
       * What a page says back: a field's error and a form's, an English
       * answer from the server, and a check in the page's own words.
       */}
      <Section name="errors">
        <div className="w-full max-w-md space-y-4 bg-white p-4">
          <div data-testid="error-server-field">
            <Input
              initialValue="SAVE50"
              onChange={() => {}}
              error="Promo code is invalid."
            />
          </div>
          <div data-testid="error-check-field">
            <Input onChange={() => {}} error="Description is required" />
          </div>
          <div data-testid="error-form">
            <Alert type={AlertType.DANGER} title="Promo code is invalid." />
          </div>
          <div data-testid="error-note-field">
            <MarkdownEditor
              initialValue="Customers cannot pay."
              onChange={() => {}}
              error="Notes cannot be empty."
            />
          </div>
        </div>
      </Section>

      {/*
       * A table of people and plain values, each longer than its column,
       * cut short at the column's edge.
       */}
      <Section name="people">
        <div style={{ width: `${tableWidth}px` }}>
          <Card title="Threat Intel Feeds">
            <Table
              id="reading-direction-people"
              data={FEED_ROWS}
              columns={FEED_COLUMNS}
              singularLabel="Feed"
              pluralLabel="Feeds"
              currentPageNumber={1}
              totalItemsCount={FEED_ROWS.length}
              itemsOnPage={10}
              onNavigateToPage={() => {}}
              error=""
              isLoading={false}
              sortOrder={SortOrder.Ascending}
              sortBy={null}
              onSortChanged={() => {}}
            />
          </Card>
        </div>
      </Section>

      {/* A folded category of the products menu: what it holds, listed. */}
      <Section name="products-menu">
        <div className="w-96 max-w-full bg-white p-2">
          <NavBarCategoryToggle
            title={i18next.t("Infrastructure")}
            itemTitles={["Incidents", "Alerts", "Monitors"].map((title) => {
              return i18next.t(title);
            })}
            isOpen={false}
            onToggle={() => {}}
          />
        </div>
      </Section>

      {/* A sentence that puts a time after a name in Latin letters. */}
      <Section name="sentence">
        <p
          className="w-[36rem] max-w-full bg-white p-2 text-sm text-gray-700"
          data-testid="sentence-meraki"
        >
          <TranslatedSentence
            template="Read from the Meraki dashboard ({{name}}), {{time}}."
            slots={{}}
            values={{ name: "Acme Retail", time: READ_FROM_TIME[language] }}
          />
        </p>
      </Section>

      {/* A field whose popup opens from its start edge. */}
      <Section name="popup">
        <div className="w-72 max-w-full bg-white p-4">
          <ColorPicker
            onChange={() => {}}
            initialValue="#6366f1"
            layout="compact"
            dataTestId="popup-color"
            ariaLabel="Color"
          />
        </div>
      </Section>

      {/* A React Flow canvas: a node, and the line out of it. */}
      <Section name="canvas">
        <div
          className="bg-white"
          data-testid="canvas"
          style={{ width: `${Math.min(600, tableWidth)}px`, height: "240px" }}
        >
          <ReactFlow
            nodes={FLOW_NODES}
            edges={FLOW_EDGES}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </Section>

      {/* A month's events in a narrow calendar, cut short to their blocks. */}
      <Section name="calendar">
        <div
          className="bg-white"
          style={{ width: `${Math.min(390, tableWidth)}px` }}
        >
          <Calendar
            events={CALENDAR_EVENTS}
            defaultDate={WRITTEN_AT}
            defaultCalendarView="month"
            views={["month"]}
            onRangeChange={() => {}}
          />
        </div>
      </Section>

      <Section name="markdown">
        <div className="grid gap-4 bg-white p-4">
          <div data-testid="note-english">
            <MarkdownViewer text={ENGLISH_NOTE} />
          </div>
          <div data-testid="note-persian">
            <MarkdownViewer text={PERSIAN_NOTE} />
          </div>
          <div data-testid="note-feed">
            <MarkdownViewer text={FEED_NOTE} />
          </div>
          <div data-testid="note-mixed-list">
            <MarkdownViewer text={MIXED_LIST_NOTE} />
          </div>
          <div data-testid="note-persian-from-english">
            <MarkdownViewer text={PERSIAN_FROM_AN_ENGLISH_WORD_NOTE} />
          </div>
          <div data-testid="note-diagram">
            <MarkdownViewer
              text={[
                "Where a payment goes:",
                "",
                "```mermaid",
                "graph LR",
                "  A[Checkout API] --> B[درگاه پرداخت]",
                "  B --> C[Bank]",
                "```",
                "",
                "```mermaid",
                "sequenceDiagram",
                "  Checkout->>Gateway: Charge the card",
                "  Gateway-->>Checkout: پرداخت انجام شد.",
                "```",
              ].join("\n")}
            />
          </div>
          <div data-testid="editor-empty">
            <MarkdownEditor
              initialValue=""
              placeholder="Write a note"
              onChange={() => {}}
            />
          </div>
          <div data-testid="editor-english">
            <MarkdownEditor initialValue={ENGLISH_NOTE} onChange={() => {}} />
          </div>
        </div>
      </Section>

      {/*
       * Values someone wrote, shown on the page (Detail, as a record's card
       * draws them), and typed into fields.
       */}
      <Section name="written">
        <div className="w-full max-w-sm bg-white p-4">
          <Detail
            item={{
              description: "Watches the checkout endpoint every minute.",
              notes: "پایش نقطه پرداخت.",
            }}
            fields={[
              {
                key: "description",
                title: "Description",
                fieldType: FieldType.Text,
              },
              { key: "notes", title: "Notes", fieldType: FieldType.Text },
            ]}
            showRecordLine={false}
          />
          <div data-testid="field-english">
            <Input
              initialValue="Watches the checkout endpoint."
              onChange={() => {}}
            />
          </div>
          <div data-testid="field-empty">
            <Input placeholder="Monitor name" onChange={() => {}} />
          </div>
          <div data-testid="textarea-english">
            <TextArea
              initialValue="Rolled back the deploy."
              onChange={() => {}}
            />
          </div>
        </div>
      </Section>

      <Section name="folded">
        <div className="bg-white p-4">
          <FoldedSection
            title="More fields"
            items={[
              { key: "description", title: "Description", isSet: false },
              { key: "labels", title: "Labels", isSet: false },
            ]}
          >
            <p>Hidden fields</p>
          </FoldedSection>
        </div>
      </Section>

      <Section name="menu">
        <div className="w-64">
          <SideMenu>
            <SideMenuSection title="Monitors" defaultCollapsed={false}>
              <SideMenuItem
                link={{
                  title: "All Monitors",
                  to: new Route("/reading-direction"),
                }}
                icon={IconProp.List}
              />
            </SideMenuSection>
            <SideMenuSection title="Advanced" defaultCollapsed={true}>
              <SideMenuItem
                link={{
                  title: "Settings",
                  to: new Route("/reading-direction/settings"),
                }}
                icon={IconProp.Settings}
              />
            </SideMenuSection>
          </SideMenu>
        </div>
      </Section>

      <Section name="pagination">
        <div className="bg-white">
          <Pagination
            currentPageNumber={2}
            totalItemsCount={45}
            itemsOnPage={10}
            onNavigateToPage={() => {}}
            isLoading={false}
            isError={false}
            singularLabel="Monitor"
            pluralLabel="Monitors"
            dataTestId="reading-direction-pagination"
          />
        </div>
      </Section>

      <Section name="shortcut">
        <KeyboardShortcut keys={[KeyboardKey.Control, "K"]} />
      </Section>

      <Section name="arrows">
        <div className="flex gap-4" data-testid="arrows">
          <span data-testid="arrow-next">
            <Icon icon={IconProp.ArrowRight} className="h-5 w-5" />
          </span>
          <span data-testid="arrow-fixed">
            <Icon
              icon={IconProp.ArrowRight}
              className="h-5 w-5"
              isMirroredRightToLeft={false}
            />
          </span>
          <span data-testid="arrow-up">
            <Icon icon={IconProp.ArrowUp} className="h-5 w-5" />
          </span>
          {/* A chart's or a timeline's box: left to right in every language. */}
          <span dir="ltr" data-testid="arrow-in-ltr-box">
            <Icon icon={IconProp.ArrowRight} className="h-5 w-5" />
          </span>
        </div>
      </Section>

      <Section name="code">
        <div className="bg-white p-4">
          <pre data-testid="code-block">kubectl get pods -n checkout</pre>
          <p data-testid="code-sentence">
            {language === "fa" ? "متغیر " : "The variable "}
            <code data-testid="code-inline">{"{{alertname}}"}</code>
            {language === "fa" ? " را بنویسید." : " is written as is."}
          </p>
        </div>
      </Section>

      <Section name="korean-words">
        <div className="bg-white p-2" style={{ width: "72px" }}>
          <p className="text-sm text-gray-900" data-testid="korean-words">
            {KOREAN_WORDS}
          </p>
        </div>
      </Section>

      <Section name="dates">
        <p data-testid="date-text">
          {OneUptimeDate.getDateAsLocalFormattedString(WRITTEN_AT, true)}
        </p>
      </Section>

      {dialog && (
        <Modal
          title="Create Label"
          description="Labels group monitors, incidents and more."
          submitButtonText="Create Label"
          onSubmit={() => {
            setDialog(false);
          }}
          onClose={() => {
            setDialog(false);
          }}
        >
          <p data-testid="dialog-text">
            {language === "fa"
              ? "یک برچسب بسازید."
              : "Give the label a name and a colour."}
          </p>
        </Modal>
      )}

      {drawer && (
        <SideOver
          title="Edit Monitor"
          description="Change what this monitor watches."
          submitButtonText="Save"
          onSubmit={() => {
            setDrawer(false);
          }}
          onClose={() => {
            setDrawer(false);
          }}
        >
          <p data-testid="drawer-text">
            {language === "fa"
              ? "این مانیتور را ویرایش کنید."
              : "Change the monitor's name."}
          </p>
        </SideOver>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute path="*" element={<Page />} />
    </Routes>
  </BrowserRouter>,
);
