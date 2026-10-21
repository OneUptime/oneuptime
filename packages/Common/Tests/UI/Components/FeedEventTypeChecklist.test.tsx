import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import IconProp from "../../../Types/Icon/IconProp";
import FeedEventTypeChecklist, {
  FEED_EVENT_TYPE_SEARCH_THRESHOLD,
} from "../../../UI/Components/Feed/FeedEventTypeChecklist";
import { FeedEventTypeOption } from "../../../UI/Components/Feed/FeedOptions";

/*
 * The checklist of a feed's event type filter - what the filter dialog that
 * the feed's ⋯ menu opens is made of. It is controlled: the dialog holds the
 * ticks until they are applied, so most behaviour is driven through a small
 * harness that holds them in state, while exact payloads are asserted
 * against a bare onChange mock.
 */

type OnChangeMock = ReturnType<
  typeof jest.fn<(eventTypes: Array<string>) => void>
>;

const UNFILTERED_SUMMARY: string =
  "Showing every event type. Tick one or more to narrow the feed.";

// Three entries, in checklist order; the last one has no icon.
const EVENT_TYPE_OPTIONS: Array<FeedEventTypeOption> = [
  {
    value: "IncidentCreated",
    label: "Incident Created",
    icon: IconProp.Alert,
  },
  {
    value: "IncidentStateChanged",
    label: "Incident State Changed",
    icon: IconProp.Edit,
  },
  {
    value: "OwnerUserAdded",
    label: "User Added as Owner",
  },
];

// Long enough to earn the search box.
const LONG_EVENT_TYPE_OPTIONS: Array<FeedEventTypeOption> = [
  { value: "AlertAcknowledged", label: "Alert Acknowledged" },
  { value: "AlertCreated", label: "Alert Created" },
  { value: "AlertResolved", label: "Alert Resolved" },
  { value: "IncidentCreated", label: "Incident Created" },
  { value: "IncidentResolved", label: "Incident Resolved" },
  { value: "MonitorStatusChanged", label: "Monitor Status Changed" },
  { value: "OwnerNotificationSent", label: "Owner Notification Sent" },
  {
    value: "SubscriberNotificationSent",
    label: "Subscriber Notification Sent",
  },
  { value: "OwnerTeamAdded", label: "Team Added as Owner" },
  { value: "OwnerUserAdded", label: "User Added as Owner" },
];

interface HarnessProps {
  eventTypeOptions: Array<FeedEventTypeOption>;
  initialSelection?: Array<string> | undefined;
  onChange?: ((eventTypes: Array<string>) => void) | undefined;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const [selection, setSelection] = React.useState<Array<string>>(
    props.initialSelection || [],
  );

  return (
    <FeedEventTypeChecklist
      eventTypeOptions={props.eventTypeOptions}
      selectedEventTypes={selection}
      onChange={(eventTypes: Array<string>): void => {
        props.onChange?.(eventTypes);
        setSelection(eventTypes);
      }}
    />
  );
};

const createOnChange: () => OnChangeMock = (): OnChangeMock => {
  return jest.fn<(eventTypes: Array<string>) => void>();
};

const getCheckbox: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  return screen.getByRole("checkbox", { name });
};

const getCheckboxLabels: () => Array<string> = (): Array<string> => {
  return screen.queryAllByRole("checkbox").map((checkbox: HTMLElement) => {
    return checkbox.closest("label")?.textContent || "";
  });
};

const getSummary: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("feed-options-event-type-summary");
};

const getSearchInput: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Search event types" });
};

const getSearchResults: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("feed-options-search-results");
};

const queryShowAll: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByRole("button", { name: "Show all" });
};

const getLastCall: (onChange: OnChangeMock) => Array<string> | undefined = (
  onChange: OnChangeMock,
): Array<string> | undefined => {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
};

afterEach(() => {
  cleanup();
});

describe("FeedEventTypeChecklist", () => {
  describe("the list", () => {
    test("renders one labelled checkbox per option, in checklist order, inside a group named Event types", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      /*
       * The group, not the list, carries the name: a screen reader
       * announces a group's name as focus enters it from any checkbox.
       */
      const group: HTMLElement = screen.getByRole("group", {
        name: "Event types",
      });
      const list: HTMLElement = within(group).getByRole("list");

      expect(within(list).getAllByRole("checkbox")).toHaveLength(3);
      expect(getCheckboxLabels()).toEqual([
        "Incident Created",
        "Incident State Changed",
        "User Added as Owner",
      ]);

      for (const option of EVENT_TYPE_OPTIONS) {
        expect(getCheckbox(option.label)).not.toBeChecked();
        expect(
          screen.getByTestId(`feed-options-event-type-${option.value}`),
        ).toBe(getCheckbox(option.label));
      }

      expect(getSummary()).toHaveTextContent(UNFILTERED_SUMMARY);
      // Ticking a box re-words this line; it is read out when it does.
      expect(getSummary()).toHaveAttribute("aria-live", "polite");
      expect(queryShowAll()).not.toBeInTheDocument();
    });

    test("lays the checklist out in two columns from sm up, one on a phone", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      expect(screen.getByTestId("feed-options-event-types")).toHaveClass(
        "grid",
        "grid-cols-1",
        "sm:grid-cols-2",
      );
    });

    test("sorts the options by label, whatever order they come in", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={[...EVENT_TYPE_OPTIONS].reverse()}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      expect(getCheckboxLabels()).toEqual([
        "Incident Created",
        "Incident State Changed",
        "User Added as Owner",
      ]);
    });

    test("checks exactly the event types it is given", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={["IncidentStateChanged"]}
          onChange={createOnChange()}
        />,
      );

      expect(getCheckbox("Incident Created")).not.toBeChecked();
      expect(getCheckbox("Incident State Changed")).toBeChecked();
      expect(getCheckbox("User Added as Owner")).not.toBeChecked();
      expect(getSummary()).toHaveTextContent("Showing 1 of 3 event types.");
    });

    test("counts only ticks the checklist can show", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={["Gone", "IncidentCreated"]}
          onChange={createOnChange()}
        />,
      );

      expect(getSummary()).toHaveTextContent("Showing 1 of 3 event types.");
    });

    test("renders an option's icon and leaves an option without one plain", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      const withIcon: HTMLElement | null =
        getCheckbox("Incident Created").closest("label");
      const withoutIcon: HTMLElement | null = getCheckbox(
        "User Added as Owner",
      ).closest("label");

      expect(withIcon!.querySelector("svg")).not.toBeNull();
      expect(withoutIcon!.querySelector("svg")).toBeNull();
      // The icon is decoration: the checkbox is named by its label alone.
      expect(getCheckbox("Incident Created")).toHaveAccessibleName(
        "Incident Created",
      );
    });

    test("shows the no-event-types message for a feed with an empty checklist", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={[]}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      expect(
        screen.getByText("This feed has no event types to filter by."),
      ).toBeVisible();
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(
        screen.queryByRole("textbox", { name: "Search event types" }),
      ).not.toBeInTheDocument();
      expect(getSummary()).toHaveTextContent(UNFILTERED_SUMMARY);
    });
  });

  describe("ticking", () => {
    test("adds a ticked event type", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={onChange}
        />,
      );

      fireEvent.click(getCheckbox("User Added as Owner"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(["OwnerUserAdded"]);
    });

    test("puts a newly ticked event type in checklist order, not click order", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={["OwnerUserAdded"]}
          onChange={onChange}
        />,
      );

      fireEvent.click(getCheckbox("Incident Created"));

      expect(onChange).toHaveBeenCalledWith([
        "IncidentCreated",
        "OwnerUserAdded",
      ]);
    });

    test("removes an unticked event type", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={["IncidentCreated", "IncidentStateChanged"]}
          onChange={onChange}
        />,
      );

      fireEvent.click(getCheckbox("Incident Created"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(["IncidentStateChanged"]);
    });

    /*
     * The selection can name an event type the checklist no longer offers. A
     * toggle reports only what the checklist has, so the stale type never
     * reaches the API.
     */
    test.each<[string, string, Array<string>]>([
      ["ticking", "User Added as Owner", ["IncidentCreated", "OwnerUserAdded"]],
      ["unticking", "Incident Created", []],
    ])(
      "drops an event type missing from the checklist when %s another",
      (
        _label: string,
        checkboxName: string,
        expectedEventTypes: Array<string>,
      ) => {
        const onChange: OnChangeMock = createOnChange();

        render(
          <FeedEventTypeChecklist
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            selectedEventTypes={["Gone", "IncidentCreated"]}
            onChange={onChange}
          />,
        );

        fireEvent.click(getCheckbox(checkboxName));

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(expectedEventTypes);
      },
    );

    test("ticks, counts and unticks through the controlled round trip", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} onChange={onChange} />,
      );

      // Ticked last-first; every payload still follows the checklist.
      fireEvent.click(getCheckbox("User Added as Owner"));
      expect(getLastCall(onChange)).toEqual(["OwnerUserAdded"]);
      expect(getSummary()).toHaveTextContent("Showing 1 of 3 event types.");

      fireEvent.click(getCheckbox("Incident Created"));
      expect(getLastCall(onChange)).toEqual([
        "IncidentCreated",
        "OwnerUserAdded",
      ]);
      expect(getSummary()).toHaveTextContent("Showing 2 of 3 event types.");

      fireEvent.click(getCheckbox("Incident State Changed"));
      expect(getLastCall(onChange)).toEqual([
        "IncidentCreated",
        "IncidentStateChanged",
        "OwnerUserAdded",
      ]);
      expect(getSummary()).toHaveTextContent("Showing 3 of 3 event types.");

      fireEvent.click(getCheckbox("Incident Created"));
      fireEvent.click(getCheckbox("Incident State Changed"));
      fireEvent.click(getCheckbox("User Added as Owner"));
      expect(getLastCall(onChange)).toEqual([]);
      expect(getSummary()).toHaveTextContent(UNFILTERED_SUMMARY);
      expect(onChange).toHaveBeenCalledTimes(6);
    });
  });

  describe("Show all", () => {
    test("is offered only while something is ticked, and clears every tick", () => {
      const onChange: OnChangeMock = createOnChange();

      const { rerender } = render(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={["IncidentCreated", "OwnerUserAdded"]}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Show all" }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([]);

      rerender(
        <FeedEventTypeChecklist
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={onChange}
        />,
      );

      expect(queryShowAll()).not.toBeInTheDocument();
    });

    test("empties the checklist, then disappears and hands focus to the first box", () => {
      render(
        <Harness
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          initialSelection={["IncidentCreated", "IncidentStateChanged"]}
        />,
      );

      const showAll: HTMLElement = screen.getByRole("button", {
        name: "Show all",
      });

      act(() => {
        showAll.focus();
      });
      fireEvent.click(showAll);

      for (const option of EVENT_TYPE_OPTIONS) {
        expect(getCheckbox(option.label)).not.toBeChecked();
      }

      expect(queryShowAll()).not.toBeInTheDocument();
      expect(getSummary()).toHaveTextContent(UNFILTERED_SUMMARY);
      // Not dropped on the page: a button that unmounts takes focus with it.
      expect(document.activeElement).not.toBe(document.body);
      expect(screen.getAllByRole("checkbox")[0]).toHaveFocus();
    });

    test("while the search hides every box, hands focus to the search box", () => {
      render(
        <Harness
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          initialSelection={["AlertCreated", "OwnerUserAdded"]}
        />,
      );

      fireEvent.change(getSearchInput(), { target: { value: "zzz" } });
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: "Show all" }));

      expect(queryShowAll()).not.toBeInTheDocument();
      expect(getSearchInput()).toHaveFocus();
    });
  });

  describe("search", () => {
    test("uses a threshold of eight event types", () => {
      expect(FEED_EVENT_TYPE_SEARCH_THRESHOLD).toBe(8);
    });

    test("is absent when the checklist is at the threshold", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS.slice(
            0,
            FEED_EVENT_TYPE_SEARCH_THRESHOLD,
          )}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      expect(screen.getAllByRole("checkbox")).toHaveLength(
        FEED_EVENT_TYPE_SEARCH_THRESHOLD,
      );
      expect(
        screen.queryByRole("textbox", { name: "Search event types" }),
      ).not.toBeInTheDocument();
    });

    test("appears once the checklist is longer than the threshold", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS.slice(
            0,
            FEED_EVENT_TYPE_SEARCH_THRESHOLD + 1,
          )}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      const search: HTMLElement = getSearchInput();

      expect(search).toHaveValue("");
      expect(search).toHaveAttribute("placeholder", "Search event types");
      expect(screen.getAllByRole("checkbox")).toHaveLength(
        FEED_EVENT_TYPE_SEARCH_THRESHOLD + 1,
      );
    });

    test.each<[string, Array<string>]>([
      ["INCIDENT", ["Incident Created", "Incident Resolved"]],
      ["incident", ["Incident Created", "Incident Resolved"]],
      [
        "notification",
        ["Owner Notification Sent", "Subscriber Notification Sent"],
      ],
      ["as owner", ["Team Added as Owner", "User Added as Owner"]],
      ["  resolved  ", ["Alert Resolved", "Incident Resolved"]],
      ["ACKNOW", ["Alert Acknowledged"]],
    ])(
      "filters the checklist to labels containing %p, ignoring case",
      (term: string, expectedLabels: Array<string>) => {
        render(
          <FeedEventTypeChecklist
            eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
            selectedEventTypes={[]}
            onChange={createOnChange()}
          />,
        );

        fireEvent.change(getSearchInput(), { target: { value: term } });

        expect(getSearchInput()).toHaveValue(term);
        expect(getCheckboxLabels()).toEqual(expectedLabels);
      },
    );

    test("restores the whole checklist when the search is cleared", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      fireEvent.change(getSearchInput(), { target: { value: "alert" } });
      expect(getCheckboxLabels()).toHaveLength(3);

      fireEvent.change(getSearchInput(), { target: { value: "   " } });
      expect(getCheckboxLabels()).toHaveLength(LONG_EVENT_TYPE_OPTIONS.length);

      fireEvent.change(getSearchInput(), { target: { value: "" } });
      expect(getCheckboxLabels()).toEqual(
        LONG_EVENT_TYPE_OPTIONS.map((option: FeedEventTypeOption) => {
          return option.label;
        }),
      );
    });

    test("matches labels, not raw event type values", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      fireEvent.change(getSearchInput(), { target: { value: "OwnerUser" } });

      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    test("says so when nothing matches", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      fireEvent.change(getSearchInput(), { target: { value: "  zzz  " } });

      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(screen.getByText('No event types match "zzz".')).toBeVisible();
      expect(
        screen.queryByText("This feed has no event types to filter by."),
      ).not.toBeInTheDocument();
    });

    /*
     * The filtered list changes silently under the search box, so the number
     * of matches is spoken from a live region. It is mounted empty with the
     * search box: a region that appears together with its first text is
     * often not announced at all.
     */
    test("announces the number of matches, and nothing while there is no search", () => {
      render(
        <FeedEventTypeChecklist
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          selectedEventTypes={[]}
          onChange={createOnChange()}
        />,
      );

      const results: HTMLElement = getSearchResults();

      expect(results).toHaveAttribute("aria-live", "polite");
      expect(results.textContent).toBe("");

      fireEvent.change(getSearchInput(), { target: { value: "incident" } });

      expect(getCheckboxLabels()).toHaveLength(2);
      expect(getSearchResults()).toBe(results);
      expect(results).toHaveTextContent(/^Matching event types: 2$/);

      fireEvent.change(getSearchInput(), { target: { value: "   " } });
      expect(results.textContent).toBe("");

      fireEvent.change(getSearchInput(), { target: { value: "zzz" } });
      expect(results).toHaveTextContent(/^Matching event types: 0$/);
    });

    test("ticks a search result without dropping a ticked event type the search hides", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <Harness
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          initialSelection={["OwnerUserAdded"]}
          onChange={onChange}
        />,
      );

      fireEvent.change(getSearchInput(), { target: { value: "incident" } });
      fireEvent.click(getCheckbox("Incident Resolved"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        "IncidentResolved",
        "OwnerUserAdded",
      ]);
      // The search stays put so the reader can keep ticking results.
      expect(getSearchInput()).toHaveValue("incident");
      expect(getCheckbox("Incident Resolved")).toBeChecked();
      expect(getSummary()).toHaveTextContent(
        `Showing 2 of ${LONG_EVENT_TYPE_OPTIONS.length} event types.`,
      );
    });
  });

  /*
   * A real i18next instance, handed down through I18nextProvider rather than
   * installed globally, so the other tests in this file stay English.
   */
  describe("in German", () => {
    const german: i18n = createInstance();

    /*
     * Two event labels whose German order differs from the English one.
     * "Incident State Changed" is left out on purpose: a label with no
     * translation yet stays in English, and is sorted among the German ones.
     */
    const GERMAN_TRANSLATIONS: Record<string, string> = {
      "Event types": "Ereignistypen",
      "Show all": "Alle anzeigen",
      "Search event types": "Ereignistypen suchen",
      "Matching event types: {{count}}": "Passende Ereignistypen: {{count}}",
      "Showing every event type. Tick one or more to narrow the feed.":
        "Alle Ereignistypen werden angezeigt. Haken Sie einen oder mehrere an, um den Feed einzugrenzen.",
      "Showing {{selected}} of {{total}} event types.":
        "{{selected}} von {{total}} Ereignistypen werden angezeigt.",
      "Incident Created": "Vorfall erstellt",
      "User Added as Owner": "Benutzer als Eigentümer hinzugefügt",
    };

    beforeAll(async () => {
      await german.init({
        lng: "de",
        resources: { de: { translation: GERMAN_TRANSLATIONS } },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });
    });

    const renderInGerman: (ui: React.ReactElement) => RenderResult = (
      ui: React.ReactElement,
    ): RenderResult => {
      return render(<I18nextProvider i18n={german}>{ui}</I18nextProvider>);
    };

    test("names the group and words the summary in German", () => {
      renderInGerman(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      expect(
        screen.getByRole("group", { name: "Ereignistypen" }),
      ).toBeInTheDocument();
      expect(getSummary()).toHaveTextContent(
        "Alle Ereignistypen werden angezeigt.",
      );

      fireEvent.click(getCheckbox("Vorfall erstellt"));

      expect(getSummary()).toHaveTextContent(
        /^1 von 3 Ereignistypen werden angezeigt\.$/,
      );
      expect(
        screen.getByRole("button", { name: "Alle anzeigen" }),
      ).toBeVisible();
    });

    test("orders the checklist by the German labels, while payloads keep the feed's own order", () => {
      const onChange: OnChangeMock = createOnChange();

      renderInGerman(
        <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} onChange={onChange} />,
      );

      // In English this list reads Incident Created, Incident State Changed, User Added as Owner.
      expect(getCheckboxLabels()).toEqual([
        "Benutzer als Eigentümer hinzugefügt",
        "Incident State Changed",
        "Vorfall erstellt",
      ]);

      fireEvent.click(getCheckbox("Benutzer als Eigentümer hinzugefügt"));
      fireEvent.click(getCheckbox("Vorfall erstellt"));

      expect(getLastCall(onChange)).toEqual([
        "IncidentCreated",
        "OwnerUserAdded",
      ]);
    });

    test("searches the German labels the reader sees, not the English ones behind them", () => {
      renderInGerman(<Harness eventTypeOptions={LONG_EVENT_TYPE_OPTIONS} />);

      const search: HTMLElement = screen.getByRole("textbox", {
        name: "Ereignistypen suchen",
      });

      fireEvent.change(search, { target: { value: "EIGENTÜMER" } });

      expect(getCheckboxLabels()).toEqual([
        "Benutzer als Eigentümer hinzugefügt",
      ]);
      expect(getSearchResults()).toHaveTextContent(
        /^Passende Ereignistypen: 1$/,
      );

      // Its English label no longer matches; the untranslated rows still do.
      fireEvent.change(search, { target: { value: "as owner" } });

      expect(getCheckboxLabels()).toEqual(["Team Added as Owner"]);
    });
  });
});
