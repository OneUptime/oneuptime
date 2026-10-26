/*
 * Offline fixture for the reading direction: the shared components a
 * right-to-left page changes, drawn in the Dashboard's words for the
 * language asked for. <html lang> and <html dir> are set by the production
 * helper (Common/UI/Utils/PageLanguage) from the i18next instance, as every
 * frontend's i18n set-up does; dates follow the language as they do there
 * (Common/UI/Utils/DateDisplayLanguage).
 *
 * One page, /reading-direction, steered by the query string:
 *   - lang=en|de|fa      the language (and so the direction) of the page
 *   - theme=dark         (read by server.js) the Dashboard's dark mode
 *   - dialog=open        a dialog over the page
 *   - width=<px>         how wide the overflowing table's card is (560)
 *
 * The components are the production ones: the switch (Toggle), the status
 * dot (StatusBubble), a table whose Actions column sticks at its end
 * (Table), a dialog (Modal), notes in the Markdown viewer and editor, a
 * folded More fields line (FoldedSection), a side menu section, the
 * breadcrumbs, pagination, a keyboard shortcut, code, and dates.
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
import Breadcrumbs from "Common/UI/Components/Breadcrumbs/Breadcrumbs";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import Icon from "Common/UI/Components/Icon/Icon";
import KeyboardShortcut, {
  KeyboardKey,
} from "Common/UI/Components/KeyboardShortcut/KeyboardShortcut";
import MarkdownEditor from "Common/UI/Components/Markdown.tsx/MarkdownEditor";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Modal from "Common/UI/Components/Modal/Modal";
import Pagination from "Common/UI/Components/Pagination/Pagination";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
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

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const isDialogOpen = params.get("dialog") === "open";
const tableWidth = Number(params.get("width") || 560);

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

const ROWS = [
  {
    _id: "row-1",
    name: "Checkout API",
    kind: "Website",
    region: "eu-west-1, eu-central-1",
    owner: "Payments team",
    description: "Watches the checkout endpoint every minute.",
  },
  {
    _id: "row-2",
    name: "پنل مدیریت فروشگاه",
    kind: "API",
    region: "me-central-1",
    owner: "Store team",
    description: "Watches the store's admin panel.",
  },
];

const COLUMNS = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Monitor Type", type: FieldType.Text, key: "kind" },
  { title: "Description", type: FieldType.Text, key: "description" },
  { title: "Regions", type: FieldType.Text, key: "region" },
  { title: "Owners", type: FieldType.Text, key: "owner" },
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

  return (
    <main className="mx-auto max-w-5xl p-6">
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
            <span data-testid="spacing-text">{language === "fa" ? "متن" : "Text"}</span>
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

      <Section name="markdown">
        <div className="grid gap-4 bg-white p-4">
          <div data-testid="note-english">
            <MarkdownViewer text={ENGLISH_NOTE} />
          </div>
          <div data-testid="note-persian">
            <MarkdownViewer text={PERSIAN_NOTE} />
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
