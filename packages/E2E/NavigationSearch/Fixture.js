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
import { useDashboardNavigationItems } from "../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import en from "../../App/FeatureSet/Dashboard/src/Locales/en.json";

await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

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
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());
  const {
    moreMenuItems,
    moreMenuCategoriesOpenByDefault,
    moreMenuCategoryIcons,
  } = useDashboardNavigationItems();

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
          // And the icons of the categories' rows.
          categoryIcons={moreMenuCategoryIcons}
          onClose={() => setIsOpen(false)}
          showCommandKShortcutHint={false}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
