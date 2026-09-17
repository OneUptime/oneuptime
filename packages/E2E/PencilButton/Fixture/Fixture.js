import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import "Common/UI/Styles/Theme.css";

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

const variants = Object.keys(ButtonStyleType).filter(
  (name) =>
    Number.isNaN(Number(name)) && !["ICON", "ICON_LIGHT"].includes(name),
);

function Fixture() {
  const [clicks, setClicks] = useState(0);
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 text-gray-700">
      <section
        data-testid="project-card"
        className="rounded-xl border border-gray-200 bg-white"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 p-6">
          <h1 className="text-xl font-semibold">Project details</h1>
          <Button
            title="Edit Project"
            icon={IconProp.Pencil}
            dataTestId="edit-project"
            onClick={() => setClicks((count) => count + 1)}
          />
        </div>
        <p className="p-6 text-sm text-gray-500">Production workspace</p>
      </section>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {variants.map((name) => (
          <div
            key={name}
            className="rounded-lg border border-gray-200 bg-white p-3"
          >
            <h2 className="mb-3 text-xs text-gray-500">{name}</h2>
            <Button
              title="Edit"
              icon={IconProp.Edit}
              buttonStyle={ButtonStyleType[name]}
              dataTestId={`variant-${name}`}
            />
          </div>
        ))}
        {["NORMAL", "OUTLINE"].flatMap((name) =>
          Object.keys(ButtonSize).map((size) => (
            <div
              key={`${name}-${size}`}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <h2 className="mb-3 text-xs text-gray-500">
                {name} · {size}
              </h2>
              <Button
                title="Edit"
                icon={IconProp.Pencil}
                buttonStyle={ButtonStyleType[name]}
                buttonSize={ButtonSize[size]}
                dataTestId={`size-${name}-${size}`}
              />
            </div>
          )),
        )}
      </section>
      <section className="flex flex-wrap items-center gap-6 rounded-lg border border-gray-200 bg-white p-4">
        {["ICON", "ICON_LIGHT"].map((name) => (
          <Button
            key={name}
            icon={IconProp.Edit}
            ariaLabel={`Edit ${name}`}
            buttonStyle={ButtonStyleType[name]}
            dataTestId={`icon-${name}`}
            onClick={() => setClicks((count) => count + 1)}
          />
        ))}
        {[SizeProp.Regular, SizeProp.Five, SizeProp.Large].map((size) => (
          <Icon
            key={size}
            icon={IconProp.Pencil}
            className="text-indigo-600"
            size={size}
            data-testid={`standalone-${size}`}
          />
        ))}
        <Button title="Disabled edit" icon={IconProp.Pencil} disabled />
      </section>
      <p role="status">Edits requested: {clicks}</p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);
