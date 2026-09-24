import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "../../../UI/Components/Dropdown/Dropdown";
import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { createFilter } from "react-select";
import { describe, expect } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
describe("Dropdown", () => {
  const options: DropdownOption[] = [
    { value: "1", label: "1" },
    { value: "2", label: "2" },
  ];

  test("renders with required props only", () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown).toBeInTheDocument();
  });

  test("renders with all props", () => {
    const { getByRole } = render(
      <Dropdown
        onClick={() => {}}
        onChange={() => {}}
        onFocus={() => {}}
        onBlur={() => {}}
        options={options}
        initialValue={{ value: "1", label: "1" }}
        value={{ value: "1", label: "1" }}
        placeholder="placeholder"
        className="class-name"
        tabIndex={1}
        error="error"
        isMultiSelect={true}
      />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown).toBeInTheDocument();
  });

  test("sets options", async () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });

    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  test("renders the menu portal above modal surfaces", async () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    await screen.findByText("1");

    const menuPortal: HTMLElement | null = document.querySelector<HTMLElement>(
      ".ou-select__menu-portal",
    );

    expect(menuPortal).toBeInTheDocument();
    expect(menuPortal).toHaveStyle({ zIndex: "60" });
  });

  test("renders placeholder", async () => {
    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        placeholder="placeholder"
      />,
    );

    expect(getByText("placeholder")).toBeInTheDocument();
  });

  test("sets initialValue", async () => {
    const { getByText, queryByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        initialValue={{ value: "1", label: "1" }}
      />,
    );

    expect(getByText("1")).toBeInTheDocument();
    expect(queryByText("2")).toBeNull();
  });

  test("sets initialValue array for multi select", () => {
    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        initialValue={[
          { value: "1", label: "1" },
          { value: "2", label: "2" },
        ]}
        isMultiSelect={true}
      />,
    );

    expect(getByText("1")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();
  });

  test("sets value", async () => {
    const { getByText, queryByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={{ value: "1", label: "1" }}
      />,
    );

    expect(getByText("1")).toBeInTheDocument();
    expect(queryByText("2")).toBeNull();
  });

  test("should display value prop in the dropdown", () => {
    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={{ value: "2", label: "2" }}
      />,
    );

    expect(getByText("2")).toBeInTheDocument();
  });

  test("should handle multiselect with multiple values", () => {
    const multiOptions: Array<DropdownOption> = [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
      { value: "c", label: "Option C" },
    ];

    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={multiOptions}
        isMultiSelect={true}
        value={[
          { value: "a", label: "Option A" },
          { value: "b", label: "Option B" },
        ]}
      />,
    );

    expect(getByText("Option A")).toBeInTheDocument();
    expect(getByText("Option B")).toBeInTheDocument();
  });

  test("should display placeholder when no value is selected", () => {
    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        placeholder="Select an option"
      />,
    );

    expect(getByText("Select an option")).toBeInTheDocument();
  });

  test("sets className", () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} className="class-name" />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown.closest(".class-name")).toBeInTheDocument();
  });

  test("sets default className", () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown.closest("div")?.classList.length).toBeGreaterThan(0);
  });

  test("sets tabIndex", () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} tabIndex={1} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown.tabIndex).toBe(1);
  });

  test("displays error", () => {
    const { getByText } = render(
      <Dropdown onChange={() => {}} options={options} error="error" />,
    );

    expect(getByText("error")).toBeInTheDocument();
  });

  test("sets isMultiSelect", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole, getByText } = render(
      <Dropdown onChange={onChange} options={options} isMultiSelect={true} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("1"));

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("2"));

    expect(getByText("1")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();
  });

  test("calls onChange when option is selected", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onChange={onChange} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("1"));

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("1");
  });

  test("calls onChange when option is selected for multi select", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onChange={onChange} options={options} isMultiSelect={true} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("1"));

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("2"));

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(["1"]);
    expect(onChange).toHaveBeenCalledWith(["1", "2"]);
  });

  test("calls onClick", () => {
    const onClick: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onClick={onClick} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.click(dropdown);

    expect(onClick).toHaveBeenCalled();
  });

  test("calls onFocus", () => {
    const onFocus: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onFocus={onFocus} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.focus(dropdown);

    expect(onFocus).toHaveBeenCalled();
  });

  test("calls onBlur", () => {
    const onBlur: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onBlur={onBlur} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.blur(dropdown);

    expect(onBlur).toHaveBeenCalled();
  });
});

/*
 * Aliases let an option answer to values other than its own: the retired
 * spellings of a timezone ("Singapore" for Asia/Singapore). The timezone
 * picker offers only current names, but stored values are never rewritten, so
 * a record saved as "Singapore" still holds it. Without aliases such a record
 * showed the placeholder, and in a multi-select it was not shown as a chip at
 * all — so the next add or remove emitted only the visible chips and silently
 * dropped it (the subscriber-timezones data loss).
 */
describe("Dropdown option aliases", () => {
  const singapore: DropdownOption = {
    value: "Asia/Singapore",
    label: "GMT+8 Asia/Singapore",
    aliases: ["Singapore"],
  };
  const tokyo: DropdownOption = {
    value: "Asia/Tokyo",
    label: "GMT+9 Asia/Tokyo",
    aliases: ["Japan"],
  };
  const kolkata: DropdownOption = {
    value: "Asia/Kolkata",
    label: "GMT+5:30 Asia/Kolkata",
    aliases: ["Asia/Calcutta"],
  };
  const timezoneOptions: Array<DropdownOption> = [singapore, tokyo, kolkata];

  type StoredValue = DropdownValue | Array<DropdownValue>;

  /*
   * FormField hands Dropdown the raw stored value — a string, or an array of
   * strings for a multi-select — through an `any`, although `value` is typed
   * as options. Cast the same way so these tests take the path a form takes.
   */
  const asStoredValue: (
    value: StoredValue,
  ) => DropdownOption | Array<DropdownOption> = (
    value: StoredValue,
  ): DropdownOption | Array<DropdownOption> => {
    return value as unknown as DropdownOption | Array<DropdownOption>;
  };

  const getSelectedLabel: () => string | null = (): string | null => {
    const singleValue: HTMLElement | null = document.querySelector<HTMLElement>(
      ".ou-select__single-value",
    );

    return singleValue ? singleValue.textContent : null;
  };

  const getPlaceholder: () => string | null = (): string | null => {
    const placeholder: HTMLElement | null = document.querySelector<HTMLElement>(
      ".ou-select__placeholder",
    );

    return placeholder ? placeholder.textContent : null;
  };

  const getChipLabels: () => Array<string> = (): Array<string> => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".ou-select__multi-value__label"),
    ).map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
  };

  const openMenu: () => void = (): void => {
    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
  };

  const getMenuOptions: () => Array<HTMLElement> = (): Array<HTMLElement> => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".ou-select__option"),
    );
  };

  const getMenuOptionLabels: () => Array<string> = (): Array<string> => {
    return getMenuOptions().map((option: HTMLElement): string => {
      return option.textContent || "";
    });
  };

  /*
   * With the menu open a selected option's label is on screen twice — in the
   * control and in the menu — so pick the menu entry, not the first text match.
   */
  const chooseMenuOption: (label: string) => void = (label: string): void => {
    openMenu();

    const option: HTMLElement | undefined = getMenuOptions().find(
      (element: HTMLElement): boolean => {
        return element.textContent === label;
      },
    );

    expect(option).toBeDefined();
    fireEvent.click(option as HTMLElement);
  };

  const removeChip: (label: string) => void = (label: string): void => {
    fireEvent.click(screen.getByRole("button", { name: `Remove ${label}` }));
  };

  /*
   * Holds the raw stored value and hands it back on every change, the way
   * BasicForm and FormField do, so a sequence of edits sees what a real form
   * would pass down after each one.
   */
  interface StatefulDropdownProps {
    initialStoredValue: StoredValue;
    options: Array<DropdownOption | DropdownOptionGroup>;
    isMultiSelect: boolean;
    onChange: MockFunction;
  }

  const StatefulDropdown: (props: StatefulDropdownProps) => ReactElement = (
    props: StatefulDropdownProps,
  ): ReactElement => {
    const [storedValue, setStoredValue] = useState<StoredValue | null>(
      props.initialStoredValue,
    );

    return (
      <Dropdown
        options={props.options}
        isMultiSelect={props.isMultiSelect}
        value={storedValue === null ? undefined : asStoredValue(storedValue)}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          setStoredValue(value);
          props.onChange(value);
        }}
      />
    );
  };

  describe("single select", () => {
    test("shows the option a stored alias belongs to", () => {
      render(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          placeholder="Select a timezone"
          value={asStoredValue("Singapore")}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+8 Asia/Singapore");
      expect(getPlaceholder()).toBeNull();
    });

    test("still shows an option for its own value", () => {
      render(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue("Asia/Tokyo")}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+9 Asia/Tokyo");
    });

    test("an option's own value wins over another option's alias, whichever is listed first", () => {
      /*
       * "Asia/Calcutta" is both the own value of one option and an alias of
       * another. Aliases are only a fallback, so listing an alias can never
       * change what an existing value selects — in either order.
       */
      const ownValueOption: DropdownOption = {
        value: "Asia/Calcutta",
        label: "Calcutta (own value)",
      };
      const aliasHolder: DropdownOption = {
        value: "Asia/Kolkata",
        label: "Kolkata (alias holder)",
        aliases: ["Asia/Calcutta"],
      };
      const orders: Array<Array<DropdownOption>> = [
        [aliasHolder, ownValueOption],
        [ownValueOption, aliasHolder],
      ];

      for (const order of orders) {
        const { unmount }: RenderResult = render(
          <Dropdown
            onChange={() => {}}
            options={order}
            value={asStoredValue("Asia/Calcutta")}
          />,
        );

        expect(getSelectedLabel()).toBe("Calcutta (own value)");

        unmount();
      }
    });

    test("options without aliases match only their own value, as before", () => {
      const plainOptions: Array<DropdownOption> = [
        { value: "Asia/Singapore", label: "GMT+8 Asia/Singapore" },
        // An empty list must behave exactly like no list.
        { value: "Asia/Tokyo", label: "GMT+9 Asia/Tokyo", aliases: [] },
      ];

      const { rerender }: RenderResult = render(
        <Dropdown
          onChange={() => {}}
          options={plainOptions}
          placeholder="Select a timezone"
          value={asStoredValue("Asia/Tokyo")}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+9 Asia/Tokyo");

      rerender(
        <Dropdown
          onChange={() => {}}
          options={plainOptions}
          placeholder="Select a timezone"
          value={asStoredValue("Singapore")}
        />,
      );

      expect(getSelectedLabel()).toBeNull();
      expect(getPlaceholder()).toBe("Select a timezone");
    });

    test("a value that is neither an option's value nor an alias shows the placeholder", () => {
      render(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          placeholder="Select a timezone"
          value={asStoredValue("Mars/Olympus_Mons")}
        />,
      );

      expect(getSelectedLabel()).toBeNull();
      expect(getPlaceholder()).toBe("Select a timezone");
    });

    test("resolves an alias of an option inside a group", () => {
      const groupedOptions: Array<DropdownOptionGroup> = [
        { label: "Asia", options: [singapore, tokyo] },
        { label: "India", options: [kolkata] },
      ];

      render(
        <Dropdown
          onChange={() => {}}
          options={groupedOptions}
          value={asStoredValue("Asia/Calcutta")}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+5:30 Asia/Kolkata");
    });

    test("resolves an alias passed as the initial value", () => {
      render(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          initialValue={asStoredValue("Japan")}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+9 Asia/Tokyo");
    });

    test("resolves the alias once options arrive after the value", () => {
      // Options fetched asynchronously land after the stored value.
      const { rerender }: RenderResult = render(
        <Dropdown
          onChange={() => {}}
          options={[]}
          placeholder="Select a timezone"
          value={asStoredValue("Singapore")}
        />,
      );

      expect(getPlaceholder()).toBe("Select a timezone");

      rerender(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          placeholder="Select a timezone"
          value={asStoredValue("Singapore")}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+8 Asia/Singapore");
    });

    test("follows a controlled value from one alias to another", () => {
      const { rerender }: RenderResult = render(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue("Singapore")}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+8 Asia/Singapore");

      rerender(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue("Japan")}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+9 Asia/Tokyo");
    });

    test("marks the alias-matched option as the selected one in the menu", () => {
      render(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue("Singapore")}
        />,
      );

      openMenu();

      const selectedOptions: Array<HTMLElement> = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".ou-select__option--is-selected",
        ),
      );

      expect(
        selectedOptions.map((option: HTMLElement): string => {
          return option.textContent || "";
        }),
      ).toEqual(["GMT+8 Asia/Singapore"]);
    });

    test("never lists an alias as a menu entry of its own", () => {
      render(
        <Dropdown
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue("Singapore")}
        />,
      );

      openMenu();

      expect(getMenuOptionLabels()).toEqual([
        "GMT+8 Asia/Singapore",
        "GMT+9 Asia/Tokyo",
        "GMT+5:30 Asia/Kolkata",
      ]);
    });

    test("choosing a different option emits that option's value", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          onChange={onChange}
          options={timezoneOptions}
          value={asStoredValue("Singapore")}
        />,
      );

      chooseMenuOption("GMT+9 Asia/Tokyo");

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
      expect(getSelectedLabel()).toBe("GMT+9 Asia/Tokyo");
    });

    test("re-choosing the alias-matched option emits its current value, never the alias", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          onChange={onChange}
          options={timezoneOptions}
          value={asStoredValue("Singapore")}
        />,
      );

      chooseMenuOption("GMT+8 Asia/Singapore");

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("Asia/Singapore");
      expect(onChange).not.toHaveBeenCalledWith("Singapore");
      expect(getSelectedLabel()).toBe("GMT+8 Asia/Singapore");
    });

    test("clearing an alias-matched value emits null", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          onChange={onChange}
          options={timezoneOptions}
          placeholder="Select a timezone"
          value={asStoredValue("Singapore")}
        />,
      );

      const clearIndicator: HTMLElement | null =
        document.querySelector<HTMLElement>(".ou-select__clear-indicator");

      expect(clearIndicator).not.toBeNull();
      // react-select clears on a primary-button mousedown, not on click.
      fireEvent.mouseDown(clearIndicator as HTMLElement, { button: 0 });

      expect(onChange).toHaveBeenCalledWith(null);
      expect(getPlaceholder()).toBe("Select a timezone");
    });

    test("keeps showing the chosen option once the form feeds its emitted value back", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <StatefulDropdown
          initialStoredValue="Asia/Calcutta"
          options={timezoneOptions}
          isMultiSelect={false}
          onChange={onChange}
        />,
      );

      expect(getSelectedLabel()).toBe("GMT+5:30 Asia/Kolkata");

      chooseMenuOption("GMT+8 Asia/Singapore");

      expect(onChange).toHaveBeenLastCalledWith("Asia/Singapore");
      expect(getSelectedLabel()).toBe("GMT+8 Asia/Singapore");
    });
  });

  describe("multi select", () => {
    test("shows one chip per stored value, each in its current label", () => {
      render(
        <Dropdown
          isMultiSelect={true}
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue(["Singapore", "Asia/Tokyo"])}
        />,
      );

      expect(getChipLabels()).toEqual([
        "GMT+8 Asia/Singapore",
        "GMT+9 Asia/Tokyo",
      ]);
    });

    test("shows one chip for an alias and its own value together", () => {
      const storedValues: Array<Array<DropdownValue>> = [
        ["Singapore", "Asia/Singapore"],
        ["Asia/Singapore", "Singapore"],
        ["Singapore", "Singapore"],
      ];

      for (const storedValue of storedValues) {
        const { unmount }: RenderResult = render(
          <Dropdown
            isMultiSelect={true}
            onChange={() => {}}
            options={timezoneOptions}
            value={asStoredValue(storedValue)}
          />,
        );

        expect(getChipLabels()).toEqual(["GMT+8 Asia/Singapore"]);

        unmount();
      }
    });

    test("keeps the stored order, placing a merged chip where it first appears", () => {
      render(
        <Dropdown
          isMultiSelect={true}
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue(["Japan", "Asia/Calcutta", "Asia/Tokyo"])}
        />,
      );

      expect(getChipLabels()).toEqual([
        "GMT+9 Asia/Tokyo",
        "GMT+5:30 Asia/Kolkata",
      ]);
    });

    test("leaves out only a stored value that matches no option or alias", () => {
      render(
        <Dropdown
          isMultiSelect={true}
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue(["Mars/Olympus_Mons", "Singapore"])}
        />,
      );

      expect(getChipLabels()).toEqual(["GMT+8 Asia/Singapore"]);
    });

    test("does not offer an alias-matched option again, so it cannot be added twice", () => {
      render(
        <Dropdown
          isMultiSelect={true}
          onChange={() => {}}
          options={timezoneOptions}
          value={asStoredValue(["Singapore"])}
        />,
      );

      openMenu();

      expect(getMenuOptionLabels()).toEqual([
        "GMT+9 Asia/Tokyo",
        "GMT+5:30 Asia/Kolkata",
      ]);
    });

    test("removing another chip keeps the alias-matched entry, as its current name", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          isMultiSelect={true}
          onChange={onChange}
          options={timezoneOptions}
          value={asStoredValue(["Singapore", "Asia/Tokyo"])}
        />,
      );

      removeChip("GMT+9 Asia/Tokyo");

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(["Asia/Singapore"]);
      expect(getChipLabels()).toEqual(["GMT+8 Asia/Singapore"]);
    });

    test("removing the alias-matched chip removes that entry", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          isMultiSelect={true}
          onChange={onChange}
          options={timezoneOptions}
          value={asStoredValue(["Singapore", "Asia/Tokyo"])}
        />,
      );

      removeChip("GMT+8 Asia/Singapore");

      expect(onChange).toHaveBeenCalledWith(["Asia/Tokyo"]);
      expect(getChipLabels()).toEqual(["GMT+9 Asia/Tokyo"]);
    });

    test("adding a chip keeps the alias-matched entry, as its current name", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          isMultiSelect={true}
          onChange={onChange}
          options={timezoneOptions}
          value={asStoredValue(["Singapore"])}
        />,
      );

      chooseMenuOption("GMT+9 Asia/Tokyo");

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(["Asia/Singapore", "Asia/Tokyo"]);
      expect(getChipLabels()).toEqual([
        "GMT+8 Asia/Singapore",
        "GMT+9 Asia/Tokyo",
      ]);
    });

    test("an alias stored beside its own value collapses to one current name on the next edit", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          isMultiSelect={true}
          onChange={onChange}
          options={timezoneOptions}
          value={asStoredValue(["Singapore", "Asia/Singapore", "Asia/Tokyo"])}
        />,
      );

      removeChip("GMT+9 Asia/Tokyo");

      expect(onChange).toHaveBeenCalledWith(["Asia/Singapore"]);
    });

    test("a sequence of edits never loses an alias-matched entry", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <StatefulDropdown
          initialStoredValue={["Singapore", "Japan"]}
          options={timezoneOptions}
          isMultiSelect={true}
          onChange={onChange}
        />,
      );

      expect(getChipLabels()).toEqual([
        "GMT+8 Asia/Singapore",
        "GMT+9 Asia/Tokyo",
      ]);

      chooseMenuOption("GMT+5:30 Asia/Kolkata");

      expect(onChange).toHaveBeenLastCalledWith([
        "Asia/Singapore",
        "Asia/Tokyo",
        "Asia/Kolkata",
      ]);

      removeChip("GMT+9 Asia/Tokyo");

      expect(onChange).toHaveBeenLastCalledWith([
        "Asia/Singapore",
        "Asia/Kolkata",
      ]);
      expect(getChipLabels()).toEqual([
        "GMT+8 Asia/Singapore",
        "GMT+5:30 Asia/Kolkata",
      ]);
    });
  });
});

/*
 * Searching. The picker offers only current timezone names, so a person who
 * knows their zone as "Calcutta" or "US/Eastern" has to be able to type that
 * and still find it: Dropdown's filter searches an option's aliases as well as
 * its label and value. An option without aliases must be searched exactly as
 * react-select's own default filter searched it before — every other dropdown
 * in the product depends on that.
 */
describe("Dropdown search", () => {
  // What react-select hands a filter for each option (its FilterOptionOption, which it does not export).
  interface FilterCandidate {
    readonly label: string;
    readonly value: string;
    readonly data: DropdownOption;
  }

  type SearchFilter = (option: FilterCandidate, rawInput: string) => boolean;

  // The filter react-select applies when a Select is given no filterOption.
  const reactSelectDefaultFilter: SearchFilter = createFilter<DropdownOption>();

  const plainOptions: Array<DropdownOption> = [
    { value: "prod-eu", label: "Production (Europe)" },
    { value: "staging", label: "Staging" },
    { value: 42, label: "Answer" },
    { value: "cafe-monitor", label: "Café Monitor" },
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
  ];

  const singapore: DropdownOption = {
    value: "Asia/Singapore",
    label: "GMT+8 Asia/Singapore",
    aliases: ["Singapore"],
  };
  const tokyo: DropdownOption = {
    value: "Asia/Tokyo",
    label: "GMT+9 Asia/Tokyo",
    aliases: ["Japan"],
  };
  const kolkata: DropdownOption = {
    value: "Asia/Kolkata",
    label: "GMT+5:30 Asia/Kolkata",
    aliases: ["Asia/Calcutta"],
  };
  const timezoneOptions: Array<DropdownOption> = [singapore, tokyo, kolkata];

  const asStoredValue: (
    value: DropdownValue | Array<DropdownValue>,
  ) => DropdownOption | Array<DropdownOption> = (
    value: DropdownValue | Array<DropdownValue>,
  ): DropdownOption | Array<DropdownOption> => {
    return value as unknown as DropdownOption | Array<DropdownOption>;
  };

  const typeSearch: (text: string) => void = (text: string): void => {
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: text },
    });
  };

  const pressEnter: () => void = (): void => {
    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "Enter",
      code: "Enter",
    });
  };

  const getMenuOptionLabels: () => Array<string> = (): Array<string> => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".ou-select__option"),
    ).map((option: HTMLElement): string => {
      return option.textContent || "";
    });
  };

  const hasNoOptionsNotice: () => boolean = (): boolean => {
    return (
      document.querySelector(".ou-select__menu-notice--no-options") !== null
    );
  };

  const getSelectedLabel: () => string | null = (): string | null => {
    const singleValue: HTMLElement | null = document.querySelector<HTMLElement>(
      ".ou-select__single-value",
    );

    return singleValue ? singleValue.textContent : null;
  };

  // What react-select's default filter would have listed for `input`.
  const labelsReactSelectWouldShow: (
    options: Array<DropdownOption>,
    input: string,
  ) => Array<string> = (
    options: Array<DropdownOption>,
    input: string,
  ): Array<string> => {
    return options
      .filter((option: DropdownOption): boolean => {
        return reactSelectDefaultFilter(
          {
            label: option.label,
            value: String(option.value),
            data: option,
          },
          input,
        );
      })
      .map((option: DropdownOption): string => {
        return option.label;
      });
  };

  describe("options without aliases", () => {
    test("list exactly what react-select's default filter listed, for every kind of input", () => {
      const inputs: Array<string> = [
        "prod",
        // Cleared again after a search: everything is listed.
        "",
        "PROD",
        "europe",
        "(europe)",
        // Matched through the value alone: no label contains it.
        "prod-eu",
        "cafe-mon",
        "42",
        "4",
        // Accents are ignored on both sides.
        "cafe",
        "café",
        "CAFÉ MONITOR",
        // The input is trimmed.
        "  staging  ",
        // The label and value are searched as one string, "label value".
        "option a a",
        "answer 42",
        "o",
        "zzz",
      ];

      render(<Dropdown onChange={() => {}} options={plainOptions} />);

      for (const input of inputs) {
        typeSearch(input);

        expect({ input: input, labels: getMenuOptionLabels() }).toEqual({
          input: input,
          labels: labelsReactSelectWouldShow(plainOptions, input),
        });
      }
    });

    test("match the label and the value, ignoring case, accents and padding", () => {
      render(<Dropdown onChange={() => {}} options={plainOptions} />);

      typeSearch("EUROPE");
      expect(getMenuOptionLabels()).toEqual(["Production (Europe)"]);

      typeSearch("prod-eu");
      expect(getMenuOptionLabels()).toEqual(["Production (Europe)"]);

      typeSearch("cafe");
      expect(getMenuOptionLabels()).toEqual(["Café Monitor"]);

      typeSearch("  staging ");
      expect(getMenuOptionLabels()).toEqual(["Staging"]);

      typeSearch("42");
      expect(getMenuOptionLabels()).toEqual(["Answer"]);
    });

    test("show the no-options notice when nothing matches", () => {
      render(<Dropdown onChange={() => {}} options={plainOptions} />);

      typeSearch("zzz");

      expect(getMenuOptionLabels()).toEqual([]);
      expect(hasNoOptionsNotice()).toBe(true);
    });

    test("an empty aliases list is searched exactly like no list", () => {
      const options: Array<DropdownOption> = [
        { value: "Asia/Tokyo", label: "GMT+9 Asia/Tokyo", aliases: [] },
        { value: "Asia/Singapore", label: "GMT+8 Asia/Singapore" },
      ];

      render(<Dropdown onChange={() => {}} options={options} />);

      for (const input of ["tokyo", "asia", "gmt+8", "japan"]) {
        typeSearch(input);

        expect({ input: input, labels: getMenuOptionLabels() }).toEqual({
          input: input,
          labels: labelsReactSelectWouldShow(options, input),
        });
      }
    });
  });

  describe("options with aliases", () => {
    test.each([
      ["Calcutta", "GMT+5:30 Asia/Kolkata"],
      ["calcutta", "GMT+5:30 Asia/Kolkata"],
      ["CALCUTTA", "GMT+5:30 Asia/Kolkata"],
      ["asia/calcutta", "GMT+5:30 Asia/Kolkata"],
      ["  calcutta  ", "GMT+5:30 Asia/Kolkata"],
      ["Japan", "GMT+9 Asia/Tokyo"],
      ["jApAn", "GMT+9 Asia/Tokyo"],
      ["singapore", "GMT+8 Asia/Singapore"],
    ])(
      "typing the alias %j finds %s",
      (input: string, expectedLabel: string) => {
        render(<Dropdown onChange={() => {}} options={timezoneOptions} />);

        typeSearch(input);

        expect(getMenuOptionLabels()).toEqual([expectedLabel]);
      },
    );

    test("an alias match is listed under the option's label, never the alias", () => {
      render(<Dropdown onChange={() => {}} options={timezoneOptions} />);

      typeSearch("japan");

      expect(getMenuOptionLabels()).toEqual(["GMT+9 Asia/Tokyo"]);
      expect(screen.queryByText("Japan")).toBeNull();
    });

    test("the label and value are still searched as before", () => {
      render(<Dropdown onChange={() => {}} options={timezoneOptions} />);

      typeSearch("asia");
      expect(getMenuOptionLabels()).toEqual([
        "GMT+8 Asia/Singapore",
        "GMT+9 Asia/Tokyo",
        "GMT+5:30 Asia/Kolkata",
      ]);

      typeSearch("gmt+9");
      expect(getMenuOptionLabels()).toEqual(["GMT+9 Asia/Tokyo"]);

      typeSearch("kolkata");
      expect(getMenuOptionLabels()).toEqual(["GMT+5:30 Asia/Kolkata"]);
    });

    test("an input matching one option's alias and another's label lists both, in order", () => {
      const calcuttaOffice: DropdownOption = {
        value: "office-7",
        label: "Calcutta Office",
      };

      render(
        <Dropdown
          onChange={() => {}}
          options={[kolkata, singapore, calcuttaOffice]}
        />,
      );

      typeSearch("calcutta");

      expect(getMenuOptionLabels()).toEqual([
        "GMT+5:30 Asia/Kolkata",
        "Calcutta Office",
      ]);
    });

    test("an alias that matches nothing typed does not widen the search", () => {
      render(<Dropdown onChange={() => {}} options={timezoneOptions} />);

      typeSearch("olympus");

      expect(getMenuOptionLabels()).toEqual([]);
      expect(hasNoOptionsNotice()).toBe(true);
    });

    test("numeric aliases are searched too", () => {
      const options: Array<DropdownOption> = [
        { value: "http", label: "HTTP", aliases: [80] },
        { value: "https", label: "HTTPS", aliases: [443] },
      ];

      render(<Dropdown onChange={() => {}} options={options} />);

      typeSearch("443");

      expect(getMenuOptionLabels()).toEqual(["HTTPS"]);
    });

    test("aliases of options inside groups are searched", () => {
      const groupedOptions: Array<DropdownOptionGroup> = [
        { label: "Asia", options: [singapore, tokyo] },
        { label: "India", options: [kolkata] },
      ];

      render(<Dropdown onChange={() => {}} options={groupedOptions} />);

      typeSearch("calcutta");

      expect(getMenuOptionLabels()).toEqual(["GMT+5:30 Asia/Kolkata"]);
    });

    test("choosing an option found by its alias emits the option's value, never the alias", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(<Dropdown onChange={onChange} options={timezoneOptions} />);

      typeSearch("Calcutta");
      pressEnter();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("Asia/Kolkata");
      expect(onChange).not.toHaveBeenCalledWith("Asia/Calcutta");
      expect(getSelectedLabel()).toBe("GMT+5:30 Asia/Kolkata");
    });

    test("multi select: an option already chosen through its alias is not offered again by that alias", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Dropdown
          isMultiSelect={true}
          onChange={onChange}
          options={timezoneOptions}
          value={asStoredValue(["Singapore"])}
        />,
      );

      typeSearch("singapore");
      expect(getMenuOptionLabels()).toEqual([]);

      typeSearch("japan");
      expect(getMenuOptionLabels()).toEqual(["GMT+9 Asia/Tokyo"]);

      pressEnter();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(["Asia/Singapore", "Asia/Tokyo"]);
    });
  });
});
