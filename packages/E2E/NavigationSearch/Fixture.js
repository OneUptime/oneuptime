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
import DashboardCommandPalette from "../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import DashboardNavbar from "../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import HiddenProductsWithData from "../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/HiddenProductsWithData";
import ProductsSettings from "../../App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProductsSettings";
import { useDashboardNavigationItems } from "../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import en from "../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import fa from "../../App/FeatureSet/Dashboard/src/Locales/fa.json";

/*
 * English, or the Dashboard's German (?lang=de) or Persian (?lang=fa, read
 * from right to left). Read once: links navigate without the query.
 */
const requestedLanguage = new URLSearchParams(window.location.search).get(
  "lang",
);
const language = ["de", "fa"].includes(requestedLanguage)
  ? requestedLanguage
  : "en";

await i18n.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
    fa: { translation: fa },
  },
  interpolation: { escapeValue: false },
});
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

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
