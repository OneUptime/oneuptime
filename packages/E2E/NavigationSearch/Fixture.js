import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import NavBarMenuModal from "Common/UI/Components/Navbar/NavBarMenuModal";
import Navigation from "Common/UI/Utils/Navigation";
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
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());
  const { moreMenuItems } = useDashboardNavigationItems();

  return (
    <main className="p-6">
      <button type="button" onClick={() => setIsOpen(true)}>
        Open products
      </button>
      <p data-testid="current-route">{location.pathname}</p>
      {isOpen && (
        <NavBarMenuModal
          items={moreMenuItems}
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
