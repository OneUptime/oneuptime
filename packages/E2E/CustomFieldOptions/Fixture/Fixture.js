import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { DragDropContext, Draggable, Droppable } from "react-beautiful-dnd";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import Modal from "Common/UI/Components/Modal/Modal";
import "Common/UI/Styles/Theme.css";

/*
 * Scenarios, chosen with ?scenario=:
 *
 *   edit    (default) the Edit form of an incident custom field "Facility",
 *           in the real Modal: three options (two colored), with how many
 *           incidents hold each value - and one value, "Old Site", that is
 *           no longer an option.
 *   create  a new field's options: the plain list, nothing to rename.
 *   nested  the editor inside a list that is itself dragged, as a form's
 *           question is on the form builder.
 *
 * ?usage=none edits without counts (they could not be read), ?copied=1 says
 * an incident field copies this one, ?theme=dark turns the dark theme on.
 * The options as they would be saved are written to [data-testid=submitted],
 * the renames that would go with the save to [data-testid=renames], and the
 * order of the nested scenario's questions to [data-testid=questions].
 */

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") || "edit";

const SAVED_OPTIONS = JSON.stringify([
  { value: "Facility A", color: "#ef4444" },
  { value: "Facility B" },
  { value: "Facility C", color: "#16a34a" },
]);

const USAGE = {
  values: [
    { value: "Facility A", count: 12 },
    { value: "Facility B", count: 4 },
    { value: "Old Site", count: 3 },
  ],
  copiedBy:
    params.get("copied") === "1"
      ? [{ resource: "Incident", fieldName: "Facility" }]
      : [],
};

function Output({ value, renames }) {
  return (
    <div className="space-y-2">
      <pre
        data-testid="submitted"
        className="whitespace-pre-wrap break-all text-xs"
      >
        {value}
      </pre>
      <pre data-testid="renames" className="whitespace-pre-wrap text-xs">
        {JSON.stringify(renames)}
      </pre>
    </div>
  );
}

function EditDialog() {
  const [value, setValue] = useState(SAVED_OPTIONS);
  const [renames, setRenames] = useState([]);
  const [isOpen, setIsOpen] = useState(true);

  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-700">
      <p data-testid="dialog-state" className="text-xs">
        {isOpen ? "open" : "closed"}
      </p>
      <Output value={value} renames={renames} />
      {isOpen ? (
        <Modal
          title="Edit Incident Custom Field"
          submitButtonText="Save Changes"
          onClose={() => {
            setIsOpen(false);
          }}
          onSubmit={() => {}}
        >
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">
              Dropdown Options
            </p>
            <p className="text-sm text-gray-500">
              Add the options that should appear in the dropdown and
              optionally choose a color for each value. Drag an option by its
              handle to change where it is listed.
            </p>
            <DropdownOptionsInput
              initialValue={SAVED_OPTIONS}
              onChange={setValue}
              onRenamesChange={setRenames}
              usage={params.get("usage") === "none" ? null : USAGE}
              recordName={{ singular: "Incident", plural: "Incidents" }}
            />
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </main>
  );
}

function CreateDialog() {
  const [value, setValue] = useState("");

  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-700">
      <p data-testid="dialog-state" className="text-xs">
        open
      </p>
      <Output value={value} renames={[]} />
      <Modal
        title="Create Incident Custom Field"
        submitButtonText="Create Incident Custom Field"
        onClose={() => {}}
        onSubmit={() => {}}
      >
        <DropdownOptionsInput initialValue="" onChange={setValue} />
      </Modal>
    </main>
  );
}

function NestedList() {
  const [questions, setQuestions] = useState(["Where?", "Since when?"]);
  const [value, setValue] = useState(SAVED_OPTIONS);
  const [renames, setRenames] = useState([]);

  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-700">
      <p data-testid="dialog-state" className="text-xs">
        open
      </p>
      <Output value={value} renames={renames} />
      <pre data-testid="questions" className="text-xs">
        {JSON.stringify(questions)}
      </pre>
      <DragDropContext
        onDragEnd={(result) => {
          if (!result.destination) {
            return;
          }

          const next = [...questions];
          const [moved] = next.splice(result.source.index, 1);
          next.splice(result.destination.index, 0, moved);
          setQuestions(next);
        }}
      >
        <Droppable droppableId="questions">
          {(provided) => {
            return (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="space-y-4"
              >
                {questions.map((question, index) => {
                  return (
                    <Draggable
                      key={question}
                      draggableId={question}
                      index={index}
                    >
                      {(draggable) => {
                        return (
                          <section
                            ref={draggable.innerRef}
                            {...draggable.draggableProps}
                            data-testid={`question-${index}`}
                            className="rounded-xl border border-gray-200 bg-white p-4"
                          >
                            <div className="mb-3 flex items-center gap-2">
                              <span
                                {...draggable.dragHandleProps}
                                data-testid={`question-handle-${index}`}
                                className="cursor-grab rounded bg-gray-100 px-2 text-xs"
                              >
                                Move question
                              </span>
                              <span className="text-sm font-medium">
                                {question}
                              </span>
                            </div>
                            {question === "Where?" ? (
                              <DropdownOptionsInput
                                initialValue={SAVED_OPTIONS}
                                onChange={setValue}
                                onRenamesChange={setRenames}
                              />
                            ) : (
                              <></>
                            )}
                          </section>
                        );
                      }}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            );
          }}
        </Droppable>
      </DragDropContext>
    </main>
  );
}

function Fixture() {
  if (scenario === "create") {
    return <CreateDialog />;
  }

  if (scenario === "nested") {
    return <NestedList />;
  }

  return <EditDialog />;
}

createRoot(document.getElementById("root")).render(<Fixture />);
