import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import YamlEditor from "Common/UI/Components/CodeEditor/YamlEditor";
import Modal from "Common/UI/Components/Modal/Modal";
import CodeType from "Common/Types/Code/CodeType";
import "Common/UI/Styles/Theme.css";

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

const params = new URLSearchParams(window.location.search);

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

const LONG_JSON = JSON.stringify(
  Array.from({ length: 60 }, (_, index) => {
    return {
      id: index,
      name: `Monitor ${index}`,
      url: `https://status.example.com/api/v1/monitors/${index}/checks?window=30d&include=${"latency,".repeat(12)}`,
      enabled: index % 2 === 0,
    };
  }),
  null,
  2,
);

const SIGMA_RULE = `title: Failed logon burst
logsource:
  category: authentication
detection:
  selection:
    className: Authentication
    status: failure
  condition: selection
level: high
`;

const MONITOR_EXAMPLE = `
// Objects available in the context of the script are:
// - page: OneUptime's secure Playwright-compatible Page facade
await page.goto('https://playwright.dev/');

const startTime = Date.now();
await page.waitForSelector('h1');
oneuptime.captureMetric('page.load.time', Date.now() - startTime);

return {
    data: 'Hello World'
};
`;

function Scenario(props) {
  const { testId, title, type, initial, yaml, description, ...editorProps } =
    props;
  const [value, setValue] = useState(initial || "");
  const [blurs, setBlurs] = useState(0);
  const [changes, setChanges] = useState(0);
  const Editor = yaml ? YamlEditor : CodeEditor;

  return (
    <section
      data-testid={testId}
      className="space-y-2 rounded-xl border border-gray-200 bg-white p-5"
    >
      <h2
        id={`${testId}-label`}
        className="text-sm font-semibold text-gray-900"
      >
        {title}
      </h2>
      {description && <p className="text-sm text-gray-500">{description}</p>}
      <Editor
        type={type}
        value={value}
        ariaLabelledby={`${testId}-label`}
        dataTestId={`${testId}-editor`}
        onChange={(next) => {
          setValue(next);
          setChanges((count) => count + 1);
        }}
        onBlur={() => setBlurs((count) => count + 1)}
        {...editorProps}
      />
      <div className="flex gap-4 text-xs text-gray-400">
        <span>
          changes <output data-testid={`${testId}-changes`}>{changes}</output>
        </span>
        <span>
          blurs <output data-testid={`${testId}-blurs`}>{blurs}</output>
        </span>
      </div>
      <textarea hidden readOnly data-testid={`${testId}-value`} value={value} />
    </section>
  );
}

function ModalScenario() {
  const [open, setOpen] = useState(false);
  const [closes, setCloses] = useState(0);
  const [value, setValue] = useState('{\n  "channel": "#alerts"\n}');

  return (
    <section
      data-testid="modal"
      className="space-y-2 rounded-xl border border-gray-200 bg-white p-5"
    >
      <button
        type="button"
        data-testid="open-modal"
        className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
        onClick={() => setOpen(true)}
      >
        Open settings
      </button>
      <span className="ml-3 text-xs text-gray-400">
        closes <output data-testid="modal-closes">{closes}</output>
      </span>
      {open && (
        <Modal
          title="Notification settings"
          description="Configure where notifications are sent."
          onClose={() => {
            setOpen(false);
            setCloses((count) => count + 1);
          }}
          onSubmit={() => setOpen(false)}
        >
          <div className="space-y-2">
            <label
              id="modal-editor-label"
              className="block text-sm font-medium text-gray-700"
            >
              Channel config
            </label>
            <CodeEditor
              type={CodeType.JSON}
              value={value}
              onChange={setValue}
              ariaLabelledby="modal-editor-label"
              dataTestId="modal-editor"
            />
          </div>
        </Modal>
      )}
    </section>
  );
}

function Fixture() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 text-gray-700">
      <label className="block text-sm text-gray-600">
        Before
        <input
          data-testid="before"
          className="ml-2 rounded border border-gray-300 px-2 py-1"
        />
      </label>

      <Scenario
        testId="json"
        title="Request body"
        type={CodeType.JSON}
        initial={'{\n  "name": "api",\n  "retries": 3\n}'}
      />

      <label className="block text-sm text-gray-600">
        After
        <input
          data-testid="after"
          className="ml-2 rounded border border-gray-300 px-2 py-1"
        />
      </label>

      <Scenario
        testId="empty-json"
        title="Headers"
        type={CodeType.JSON}
        placeholder='{ "Authorization": "Bearer ..." }'
      />

      <Scenario
        testId="sigma"
        title="Sigma rule"
        yaml={true}
        initial={SIGMA_RULE}
      />

      <Scenario
        testId="javascript"
        title="Synthetic monitor script"
        type={CodeType.JavaScript}
        example={MONITOR_EXAMPLE}
        minLines={12}
      />

      <Scenario
        testId="long"
        title="Imported monitors"
        type={CodeType.JSON}
        initial={LONG_JSON}
      />

      <Scenario
        testId="sql"
        title="Query"
        type={CodeType.SQL}
        height="12rem"
        initial={
          "SELECT name, engine, total_rows\nFROM system.tables\nWHERE database = currentDatabase()\nORDER BY total_bytes DESC\nLIMIT 50;"
        }
      />

      <Scenario
        testId="bash"
        title="Bash script"
        type={CodeType.Bash}
        initial={
          '#!/bin/bash\nset -euo pipefail\nfor host in web-1 web-2; do\n  echo "checking $host"\ndone\n'
        }
      />

      <Scenario
        testId="readonly"
        title="Generated config"
        type={CodeType.JSON}
        readOnly={true}
        initial={'{\n  "generated": true\n}'}
      />

      <Scenario
        testId="markdown"
        title="Notes"
        type={CodeType.Markdown}
        initial={
          "# Runbook notes\n\nThis paragraph is long enough that it has to wrap onto a second visual line inside the editor, which is where a wrapped layer and its textarea could disagree."
        }
      />

      <Scenario
        testId="error"
        title="Allowed origins"
        type={CodeType.JSON}
        initial={'["https://app.example.com"'}
        error="Allowed Origins is not valid JSON."
      />

      <Scenario
        testId="edge"
        title="Console input"
        type={CodeType.Text}
        initial={
          "\nstarts after a blank line\n\tthen a tab\n  <b>markup</b> & entities stay text\nends with a line break\n"
        }
      />

      <ModalScenario />
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);
