import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import Alert, {
  AlertSize,
  AlertType,
} from "../../Common/UI/Components/Alerts/Alert";
import Card from "../../Common/UI/Components/Card/Card";
import { ButtonStyleType } from "../../Common/UI/Components/Button/Button";
import Color from "../../Common/Types/Color";
import IconProp from "../../Common/Types/Icon/IconProp";

await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

const variants = [
  {
    id: "info",
    type: AlertType.INFO,
    strongTitle: "Keep your team in the loop",
    title:
      "Connect a notification channel to receive updates when an incident needs your attention.",
  },
  {
    id: "success",
    type: AlertType.SUCCESS,
    strongTitle: "You're all set",
    title:
      "Your notification settings have been saved. We'll let your team know when something changes.",
  },
  {
    id: "warning",
    type: AlertType.WARNING,
    strongTitle: "Your trial ends soon",
    title:
      "Choose a plan to keep your monitors running and retain access to your incident history.",
  },
  {
    id: "danger",
    type: AlertType.DANGER,
    strongTitle: "DANGER ZONE",
    title:
      "Deleting your project will delete it permanently and there is no way to recover.",
  },
];

function DangerZone() {
  return (
    <div data-testid="danger-zone-preview" className="space-y-5">
      <Alert
        dataTestId="project-delete-alert"
        type={AlertType.DANGER}
        strongTitle="DANGER ZONE"
        title="Deleting your project will delete it permanently and there is no way to recover."
      />
      <Card
        title="Delete Project"
        description="Are you sure you want to delete this project?"
        buttons={[
          {
            title: "Delete Project",
            icon: IconProp.Trash,
            buttonStyle: ButtonStyleType.DANGER,
            onClick: () => {},
          },
        ]}
      />
    </div>
  );
}

function Gallery() {
  const [showNotice, setShowNotice] = useState(true);
  return (
    <div data-testid="alert-gallery" className="space-y-8">
      <div className="space-y-3">
        {variants.map(({ id, ...props }) => (
          <Alert key={id} dataTestId={`variant-${id}`} {...props} />
        ))}
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Updates & status
        </h2>
        {showNotice && (
          <Alert
            dataTestId="gallery-dismissible"
            type={AlertType.INFO}
            title="A new version of the Kubernetes agent is available."
            textOnRight="Updated 2 minutes ago"
            onClose={() => setShowNotice(false)}
          />
        )}
        <Alert
          dataTestId="gallery-status"
          type={AlertType.SUCCESS}
          color={new Color("#15803d")}
          size={AlertSize.Large}
          title="All systems operational"
          textOnRight="Updated just now"
        />
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Project settings
        </h2>
        <DangerZone />
      </div>
    </div>
  );
}

function Regressions() {
  const [closeCount, setCloseCount] = useState(0);
  const [submitCount, setSubmitCount] = useState(0);
  const [parentCount, setParentCount] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const [linkCount, setLinkCount] = useState(0);
  const [buttonCount, setButtonCount] = useState(0);
  const [visible, setVisible] = useState(true);
  return (
    <div data-testid="regression-fixtures" className="space-y-5">
      <Gallery />
      {variants.map(({ id, ...props }) => (
        <Alert
          key={id}
          dataTestId={`interactive-${id}`}
          onClick={() => setActionCount((count) => count + 1)}
          onClose={() => {}}
          {...props}
        />
      ))}
      <Alert
        dataTestId="long-alert"
        type={AlertType.WARNING}
        strongTitle="Review your notification settings before continuing"
        title={
          <span data-testid="long-copy">
            Several services are affected by the current incident. Share this
            update with your team so they can coordinate the response across all
            regions and restore availability as quickly as possible. See{" "}
            <a className="underline" href="#incident-details">
              https://status.example.test/incidents/{"a".repeat(180)}
            </a>
          </span>
        }
        textOnRight="Updated 2 minutes ago"
        onClose={() => {}}
      />
      <Alert
        dataTestId="long-metadata-alert"
        title="Deployment details"
        textOnRight={`release-${"a".repeat(140)}`}
      />
      <Alert
        dataTestId="no-icon-alert"
        doNotShowIcon={true}
        title={
          <span data-testid="no-icon-copy">Settings have been saved.</span>
        }
      />
      <Alert
        dataTestId="custom-dark-alert"
        type={AlertType.SUCCESS}
        color={new Color("#166534")}
        size={AlertSize.Large}
        title={
          <span data-testid="custom-dark-copy">All systems operational</span>
        }
        textOnRight="Updated just now"
        onClose={() => {}}
      />
      <Alert
        dataTestId="custom-light-alert"
        color={new Color("#f0fdf4")}
        textClassName="text-gray-900"
        size={AlertSize.Large}
        title={
          <span data-testid="custom-light-copy">All systems operational</span>
        }
      />
      <Alert
        dataTestId="interactive-alert"
        strongTitle="Notification delivery needs attention"
        onClick={() => setActionCount((count) => count + 1)}
        title={
          <span>
            Read the{" "}
            <a
              href="#delivery-guide"
              className="underline"
              onClick={() => setLinkCount((count) => count + 1)}
            >
              delivery guide
            </a>{" "}
            or{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => setButtonCount((count) => count + 1)}
            >
              Retry delivery
            </button>
            .
          </span>
        }
      />
      <div
        data-testid="click-parent"
        onClick={() => setParentCount((count) => count + 1)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitCount((count) => count + 1);
          }}
        >
          {visible && (
            <Alert
              dataTestId="form-dismissible"
              title="The latest settings are ready to review."
              onClick={() => setActionCount((count) => count + 1)}
              onClose={() => {
                setCloseCount((count) => count + 1);
                setVisible(false);
              }}
            />
          )}
        </form>
      </div>
      <div
        className="text-xs text-gray-500"
        aria-label="Fixture event counters"
      >
        <output data-testid="close-count">{closeCount}</output> closes /{" "}
        <output data-testid="submit-count">{submitCount}</output> submits /{" "}
        <output data-testid="parent-count">{parentCount}</output> parent clicks
        / <output data-testid="action-count">{actionCount}</output> alert
        activations / <output data-testid="link-count">{linkCount}</output> link
        activations / <output data-testid="button-count">{buttonCount}</output>{" "}
        button activations
      </div>
    </div>
  );
}

function Fixture() {
  const view = new URLSearchParams(window.location.search).get("view");
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <header className="mb-7">
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">
          OneUptime · Component preview
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">
          {view === "danger" ? "Project settings" : "Shared alert banners"}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Production components shown with synthetic content.
        </p>
      </header>
      {view === "danger" ? (
        <DangerZone />
      ) : view === "regressions" ? (
        <Regressions />
      ) : (
        <Gallery />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);
