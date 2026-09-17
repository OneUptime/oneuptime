import DashboardVariablesModal from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariablesModal";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #3133, reproduced as the user described it: open Variables, type a
 * Name and a Label, click into Attribute Key, pick one of the suggested keys —
 * and watch the whole modal vanish back to the dashboard with the half-filled
 * variable gone.
 *
 * The defect was in Modal (a portalled suggestion read as a backdrop click);
 * the tests that pin the mechanism live in
 * Common/Tests/UI/Components/ModalPortalDismissal.test.tsx. What is asserted
 * here is the thing the reporter actually cared about: that this exact
 * sequence, through the real modal, ends with a saved variable.
 *
 * Every interaction presses with mousedown *and* click. Modal only dismisses
 * on a press that both starts and ends outside the panel, so a click-only test
 * cannot see this bug — which is how it survived a suite that already covered
 * the suggestion menu.
 */

const ATTRIBUTE_OPTIONS: Array<string> = [
  "cpu",
  "device",
  "deviceName",
  "direction",
  "interfaceIndex",
  "interfaceName",
  "k8s.cluster.name",
];

interface ModalCalls {
  saved: Array<Array<DashboardVariable>>;
  closed: number;
}

interface HarnessProps {
  initialVariables: Array<DashboardVariable>;
  calls: ModalCalls;
}

/*
 * Mirrors DashboardToolbar: the modal is mounted behind a boolean and both
 * onClose and onSave put it away. Keeping the modal permanently mounted would
 * be a materially weaker harness — the in-progress fields would survive a
 * spurious onClose that, in the real toolbar, unmounts them — so the tests
 * would go on passing while users kept losing their work.
 */
const VariablesModalHarness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const [isOpen, setIsOpen] = React.useState<boolean>(true);

  if (!isOpen) {
    return <div data-testid="dashboard-behind-the-modal" />;
  }

  return (
    <DashboardVariablesModal
      variables={props.initialVariables}
      telemetryAttributeOptions={ATTRIBUTE_OPTIONS}
      onSave={(saved: Array<DashboardVariable>) => {
        props.calls.saved.push(saved);
        setIsOpen(false);
      }}
      onClose={() => {
        props.calls.closed = props.calls.closed + 1;
        setIsOpen(false);
      }}
    />
  );
};

type RenderModalFunction = (
  variables?: Array<DashboardVariable> | undefined,
) => ModalCalls;

const renderModal: RenderModalFunction = (
  variables?: Array<DashboardVariable> | undefined,
): ModalCalls => {
  const calls: ModalCalls = { saved: [], closed: 0 };

  render(
    <VariablesModalHarness initialVariables={variables ?? []} calls={calls} />,
  );

  return calls;
};

/*
 * "you're redirected to the main Dashboard page": in the toolbar, closing the
 * modal is what puts the dashboard back in front of the user.
 */
type ExpectStillOpenFunction = () => void;

const expectStillOpen: ExpectStillOpenFunction = (): void => {
  expect(screen.getByTestId("modal")).toBeInTheDocument();
  expect(screen.queryByTestId("dashboard-behind-the-modal")).toBeNull();
};

/* A real pointer press: mousedown then click, the way a mouse delivers one. */
type PressFunction = (element: HTMLElement) => void;

const press: PressFunction = (element: HTMLElement): void => {
  fireEvent.mouseDown(element);
  fireEvent.click(element);
};

type AddVariableRowFunction = () => void;

const addVariableRow: AddVariableRowFunction = (): void => {
  press(screen.getByRole("button", { name: "Add Variable" }));
};

type GetFieldFunction = (placeholder: string) => HTMLElement;

const getField: GetFieldFunction = (placeholder: string): HTMLElement => {
  return screen.getByPlaceholderText(placeholder);
};

const NAME_PLACEHOLDER: string = "cluster";
const LABEL_PLACEHOLDER: string = "Cluster";
const ATTRIBUTE_KEY_PLACEHOLDER: string = "e.g. k8s.cluster.name";

type TypeIntoFunction = (placeholder: string, value: string) => void;

const typeInto: TypeIntoFunction = (
  placeholder: string,
  value: string,
): void => {
  fireEvent.change(getField(placeholder), { target: { value: value } });
};

type OpenAttributeSuggestionsFunction = () => Array<HTMLElement>;

const openAttributeSuggestions: OpenAttributeSuggestionsFunction =
  (): Array<HTMLElement> => {
    fireEvent.focus(getField(ATTRIBUTE_KEY_PLACEHOLDER));
    return screen.getAllByRole("option");
  };

type SaveFunction = () => void;

const save: SaveFunction = (): void => {
  press(screen.getByTestId("modal-footer-submit-button"));
};

describe("Dashboard Variables modal", () => {
  afterEach(() => {
    cleanup();
  });

  describe("the reported journey: name, label, then pick an attribute key", () => {
    test("picking a suggested attribute key fills the field and keeps the modal open", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "cluster");
      typeInto(LABEL_PLACEHOLDER, "Cluster");

      const options: Array<HTMLElement> = openAttributeSuggestions();

      expect(
        options.map((option: HTMLElement) => {
          return option.textContent;
        }),
      ).toEqual(ATTRIBUTE_OPTIONS);

      press(
        screen.getByRole("option", {
          name: "deviceName",
        }),
      );

      // The whole report in three assertions.
      expect(calls.closed).toBe(0);
      expectStillOpen();
      expect(getField(ATTRIBUTE_KEY_PLACEHOLDER)).toHaveValue("deviceName");
    });

    test("the name and label typed before the pick survive it", () => {
      renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "cluster");
      typeInto(LABEL_PLACEHOLDER, "Cluster");

      press(openAttributeSuggestions()[0]!);

      /*
       * The reporter's actual loss: the modal unmounted, so the two fields they
       * had already filled in went with it.
       */
      expectStillOpen();
      expect(getField(NAME_PLACEHOLDER)).toHaveValue("cluster");
      expect(getField(LABEL_PLACEHOLDER)).toHaveValue("Cluster");
    });

    test("the user can keep configuring after the pick and then save", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "cluster");
      typeInto(LABEL_PLACEHOLDER, "Cluster");
      press(
        openAttributeSuggestions().find((option: HTMLElement) => {
          return option.textContent === "k8s.cluster.name";
        })!,
      );

      /*
       * "allowing the user to continue configuring (Default value, Allow
       * multi-select) and then explicitly save/close" — the expected behaviour,
       * verbatim from the issue.
       */
      expectStillOpen();

      typeInto("(none)", "prod");
      press(screen.getByRole("checkbox"));

      save();

      expect(calls.saved).toHaveLength(1);

      const saved: Array<DashboardVariable> = calls.saved[0]!;

      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        name: "cluster",
        label: "Cluster",
        attributeKey: "k8s.cluster.name",
        defaultValue: "prod",
        isMultiSelect: true,
        type: DashboardVariableType.TelemetryAttribute,
      });
    });

    test("typing a partial key narrows the suggestions and picking one still holds the modal", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "iface");
      typeInto(ATTRIBUTE_KEY_PLACEHOLDER, "interface");

      const options: Array<HTMLElement> = screen.getAllByRole("option");

      expect(
        options.map((option: HTMLElement) => {
          return option.textContent;
        }),
      ).toEqual(["interfaceIndex", "interfaceName"]);

      press(options[1]!);

      expect(calls.closed).toBe(0);
      expectStillOpen();
      expect(getField(ATTRIBUTE_KEY_PLACEHOLDER)).toHaveValue("interfaceName");

      save();

      expect(calls.saved[0]![0]).toMatchObject({
        name: "iface",
        attributeKey: "interfaceName",
      });
    });

    test("changing one's mind about the attribute key never closes the modal", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "cluster");

      press(openAttributeSuggestions()[0]!);
      expect(getField(ATTRIBUTE_KEY_PLACEHOLDER)).toHaveValue("cpu");

      typeInto(ATTRIBUTE_KEY_PLACEHOLDER, "device");
      press(screen.getByRole("option", { name: "deviceName" }));

      expect(calls.closed).toBe(0);
      expectStillOpen();
      expect(getField(ATTRIBUTE_KEY_PLACEHOLDER)).toHaveValue("deviceName");
    });
  });

  describe("several variables in one sitting", () => {
    test("each row's attribute key is picked independently and all of them save", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "cluster");

      const firstAttributeKeyField: HTMLElement = getField(
        ATTRIBUTE_KEY_PLACEHOLDER,
      );

      fireEvent.focus(firstAttributeKeyField);
      press(screen.getByRole("option", { name: "k8s.cluster.name" }));

      addVariableRow();

      const nameFields: Array<HTMLElement> =
        screen.getAllByPlaceholderText(NAME_PLACEHOLDER);
      const attributeKeyFields: Array<HTMLElement> =
        screen.getAllByPlaceholderText(ATTRIBUTE_KEY_PLACEHOLDER);

      expect(nameFields).toHaveLength(2);

      fireEvent.change(nameFields[1]!, { target: { value: "iface" } });
      fireEvent.change(attributeKeyFields[1]!, {
        target: { value: "interfaceName" },
      });
      press(screen.getByRole("option", { name: "interfaceName" }));

      expect(calls.closed).toBe(0);
      expectStillOpen();

      save();

      const saved: Array<DashboardVariable> = calls.saved[0]!;

      expect(saved).toHaveLength(2);
      expect(saved[0]).toMatchObject({
        name: "cluster",
        attributeKey: "k8s.cluster.name",
      });
      expect(saved[1]).toMatchObject({
        name: "iface",
        attributeKey: "interfaceName",
      });
      // Distinct ids, or the dashboard would treat them as one variable.
      expect(saved[0]!.id).not.toBe(saved[1]!.id);
    });

    test("picking a key for a second row leaves the first row's key alone", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "cluster");
      press(openAttributeSuggestions()[0]!);

      addVariableRow();

      const nameFields: Array<HTMLElement> =
        screen.getAllByPlaceholderText(NAME_PLACEHOLDER);
      const attributeKeyFields: Array<HTMLElement> =
        screen.getAllByPlaceholderText(ATTRIBUTE_KEY_PLACEHOLDER);

      fireEvent.change(nameFields[1]!, { target: { value: "iface" } });
      fireEvent.focus(attributeKeyFields[1]!);
      press(screen.getByRole("option", { name: "direction" }));

      expect(attributeKeyFields[0]).toHaveValue("cpu");
      expect(attributeKeyFields[1]).toHaveValue("direction");
      expect(calls.closed).toBe(0);
      expectStillOpen();
    });
  });

  describe("editing variables that already exist", () => {
    const EXISTING: Array<DashboardVariable> = [
      {
        id: "variable-1",
        name: "cluster",
        label: "Cluster",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "cpu",
      },
    ];

    test("replacing an existing attribute key keeps the modal open and saves the new key", () => {
      const calls: ModalCalls = renderModal(EXISTING);

      expect(getField(ATTRIBUTE_KEY_PLACEHOLDER)).toHaveValue("cpu");

      typeInto(ATTRIBUTE_KEY_PLACEHOLDER, "device");
      press(screen.getByRole("option", { name: "device" }));

      expect(calls.closed).toBe(0);
      expectStillOpen();

      save();

      expect(calls.saved[0]![0]).toMatchObject({
        id: "variable-1",
        name: "cluster",
        attributeKey: "device",
      });
    });

    test("the caller's variables are never mutated in place", () => {
      const calls: ModalCalls = renderModal(EXISTING);

      typeInto(ATTRIBUTE_KEY_PLACEHOLDER, "deviceName");
      press(screen.getByRole("option", { name: "deviceName" }));
      expectStillOpen();
      save();

      /*
       * The modal copies its props into state; if it edited the caller's
       * objects instead, cancelling would still have applied the change.
       */
      expect(EXISTING[0]!.attributeKey).toBe("cpu");
      expect(calls.saved[0]![0]).not.toBe(EXISTING[0]);
    });
  });

  describe("the modal's own dismissal still works", () => {
    test("Cancel closes without saving", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "cluster");
      press(openAttributeSuggestions()[0]!);

      press(screen.getByTestId("modal-footer-close-button"));

      expect(calls.closed).toBe(1);
      expect(calls.saved).toHaveLength(0);
      expect(
        screen.getByTestId("dashboard-behind-the-modal"),
      ).toBeInTheDocument();
    });

    test("the header close button closes without saving", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      press(openAttributeSuggestions()[0]!);

      press(screen.getByTestId("close-button"));

      expect(calls.closed).toBe(1);
      expect(calls.saved).toHaveLength(0);
      expect(
        screen.getByTestId("dashboard-behind-the-modal"),
      ).toBeInTheDocument();
    });

    test("a press on the backdrop still closes the modal", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      press(openAttributeSuggestions()[0]!);

      // The layer the panel is centred in, which is what a user actually hits.
      press(screen.getByTestId("modal").parentElement!);

      expect(calls.closed).toBe(1);
      expect(calls.saved).toHaveLength(0);
      expect(
        screen.getByTestId("dashboard-behind-the-modal"),
      ).toBeInTheDocument();
    });
  });

  describe("name validation is unaffected by the fix", () => {
    test("a row with an invalid name blocks saving but not the attribute pick", () => {
      renderModal();

      addVariableRow();
      typeInto(NAME_PLACEHOLDER, "9 bad name");
      press(openAttributeSuggestions()[0]!);

      // The pick still lands; only the save is held back.
      expectStillOpen();
      expect(getField(ATTRIBUTE_KEY_PLACEHOLDER)).toHaveValue("cpu");
      expect(
        screen.getByText("Letters, digits and underscore only"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    });

    test("fixing the name after the pick re-enables saving", () => {
      const calls: ModalCalls = renderModal();

      addVariableRow();
      press(openAttributeSuggestions()[0]!);

      expectStillOpen();
      expect(screen.getByText("Required")).toBeInTheDocument();
      expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

      typeInto(NAME_PLACEHOLDER, "cluster");

      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).not.toBeDisabled();

      save();

      expect(calls.saved[0]![0]).toMatchObject({
        name: "cluster",
        attributeKey: "cpu",
      });
    });
  });
});
