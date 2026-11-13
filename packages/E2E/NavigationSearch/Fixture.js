import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import NavBarMenuModal from "Common/UI/Components/Navbar/NavBarMenuModal";
import Navigation from "Common/UI/Utils/Navigation";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import DashboardCommandPalette from "../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import DashboardNavbar from "../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import HiddenProductsWithData from "../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/HiddenProductsWithData";
import ProductsSettings from "../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProductsSettings";
import { useDashboardNavigationItems } from "../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import ar from "../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import de from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import en from "../../App/FeatureSet/Dashboard/src/Locales/en.json";
import {
  HeaderFixture,
  headerLanguage,
  installHeaderFixture,
  isHeaderMode,
} from "./HeaderFixture";

/*
 * The header page reads ?lang= its own way (HeaderFixture.js: en, de or ar).
 * Every other page is English, or the Dashboard's German (?lang=de) or
 * Arabic (?lang=ar, read from right to left). Read once: links navigate
 * without the query.
 */
const requestedLanguage = new URLSearchParams(window.location.search).get(
  "lang",
);
const language = isHeaderMode
  ? headerLanguage
  : ["de", "ar"].includes(requestedLanguage)
    ? requestedLanguage
    : "en";

await i18n.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
    ar: { translation: ar },
  },
  interpolation: { escapeValue: false },
});
/*
 * Dates in the reader's language ("vor 2 Stunden"), as the Dashboard's
 * Utils/i18n.ts sets them: the pages here are drawn in German and Arabic
 * too, and a date beside their words is never English in the product.
 */
followLanguageForDates(i18n);

// Dates in the reader's language ("vor 2 Stunden"), as Utils/i18n.ts sets them.
followLanguageForDates(i18n);

// <html lang dir> follow the reader's language: Arabic reads right to left.
followLanguageForPage(i18n);

if (isHeaderMode) {
  installHeaderFixture();
}

// The production catalog, filtering, keyboard handling and links run unchanged.
// A synthetic project URL supplies route context without an account or database.
function Fixture() {
  const [isOpen, setIsOpen] = useState(true);
  const location = useLocation();
  // Keep this mode when production links navigate without the fixture query.
  const [showNavbar] = useState(
    () => new URLSearchParams(location.search).get("navbar") === "true",
  );
  // The Dashboard's Search (Cmd/Ctrl+K), on its own: ?palette=true.
  const [showPalette] = useState(
    () => new URLSearchParams(location.search).get("palette") === "true",
  );
  /*
   * Project Settings > Products, under Home's card for hidden products that
   * have data (issue #6814): ?products=true.
   */
  const [showProducts] = useState(
    () => new URLSearchParams(location.search).get("products") === "true",
  );
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());
  const { moreMenuItems, moreMenuCategoriesOpenByDefault } =
    useDashboardNavigationItems();

  // The header and nav bar of every page: ?header=true (HeaderFixture.js).
  if (isHeaderMode) {
    return <HeaderFixture pathname={location.pathname} />;
  }

  if (showProducts) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <p data-testid="current-route">{location.pathname}</p>
        <HiddenProductsWithData />
        <ProductsSettings />
      </main>
    );
  }

  if (showPalette) {
    return (
      <main className="p-6">
        <p data-testid="current-route">{location.pathname}</p>
        <p data-testid="current-search">{location.search}</p>
        <DashboardCommandPalette />
      </main>
    );
  }

  if (showNavbar) {
    const projectPath = location.pathname.split("/").slice(0, 3).join("/");

    return (
      <main className="p-6">
        <header data-testid="dashboard-navbar">
          <DashboardNavbar show={true} />
        </header>
        <p data-testid="current-route">{location.pathname}</p>
        <Link
          to={`${projectPath}/on-call-duty/schedules/00000000-0000-4000-8000-000000000002/layers`}
        >
          Open schedule layers
        </Link>
      </main>
    );
  }

  return (
    <main className="p-6">
      <button type="button" onClick={() => setIsOpen(true)}>
        Open products
      </button>
      <p data-testid="current-route">{location.pathname}</p>
      {isOpen && (
        <NavBarMenuModal
          items={moreMenuItems}
          // As the Dashboard's NavBar passes it: Essentials, open every time.
          categoriesOpenByDefault={moreMenuCategoriesOpenByDefault}
          onClose={() => setIsOpen(false)}
          showCommandKShortcutHint={false}
        />
      )}
    </main>
  );
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Fixture />
  </BrowserRouter>,
);
