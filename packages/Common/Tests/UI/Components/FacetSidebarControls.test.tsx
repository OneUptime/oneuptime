import FacetSearchInput from "../../../UI/Components/TelemetryViewer/components/FacetSearchInput";
import FacetSectionHeader from "../../../UI/Components/TelemetryViewer/components/FacetSectionHeader";
import FacetShowMoreButton from "../../../UI/Components/TelemetryViewer/components/FacetShowMoreButton";
import HiddenFacetsFooter from "../../../UI/Components/TelemetryViewer/components/HiddenFacetsFooter";
import useFacetSearchExemptions, {
  FacetSearchExemptions,
  FacetSearchExemptionsOptions,
} from "../../../UI/Components/TelemetryViewer/useFacetSearchExemptions";
import useFacetSectionSearch, {
  FACET_SEARCH_DEBOUNCE_MS,
  FacetSectionSearch,
  FacetSectionSearchOptions,
} from "../../../UI/Components/TelemetryViewer/useFacetSectionSearch";
import { FacetData } from "../../../UI/Components/TelemetryViewer/types";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import {
  RenderHookResult,
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The building blocks both facet sidebars (Logs, and Telemetry for Traces /
 * Metrics / Exceptions) now share: the section header, the search box, the
 * "Show N more" toggle, the "N empty filters hidden" footer, and the two
 * hooks that own search text and decide which facets search keeps on
 * screen.
 */

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("FacetSearchInput", () => {
  function ControlledInput(props: {
    initial?: string;
    onChange?: (text: string) => void;
  }): ReactElement {
    const [value, setValue] = useState<string>(props.initial || "");
    return (
      <FacetSearchInput
        title="Docker Host"
        value={value}
        onChange={(text: string) => {
          setValue(text);
          props.onChange?.(text);
        }}
      />
    );
  }

  test("is named after the facet and keeps the lower-cased placeholder", () => {
    render(<ControlledInput />);

    const box: HTMLElement = screen.getByRole("textbox", {
      name: "Search Docker Host",
    });
    expect(box).toHaveAttribute("placeholder", "Search docker host...");
  });

  test("shows no clear button while empty", () => {
    render(<ControlledInput />);

    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  test("shows a clear button once there is text, which empties the box and refocuses it", () => {
    const onChange: MockFunction = getJestMockFunction();
    render(<ControlledInput onChange={onChange as any} />);

    const box: HTMLElement = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "prod" } });

    const clear: HTMLElement = screen.getByRole("button", {
      name: "Clear search",
    });
    fireEvent.click(clear);

    expect(box).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  test("a whitespace-only query can still be cleared", () => {
    render(<ControlledInput initial="  " />);

    expect(
      screen.getByRole("button", { name: "Clear search" }),
    ).toBeInTheDocument();
  });

  test("Escape clears a non-empty box and does not bubble", () => {
    const outerKeyDown: MockFunction = getJestMockFunction();
    render(
      <div onKeyDown={outerKeyDown as any}>
        <ControlledInput initial="prod" />
      </div>,
    );

    const box: HTMLElement = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Escape" });

    expect(box).toHaveValue("");
    expect(outerKeyDown).not.toHaveBeenCalled();
  });

  test("Escape on an empty box is left for the viewer to handle", () => {
    const outerKeyDown: MockFunction = getJestMockFunction();
    const onChange: MockFunction = getJestMockFunction();
    render(
      <div onKeyDown={outerKeyDown as any}>
        <ControlledInput onChange={onChange as any} />
      </div>,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(outerKeyDown).toHaveBeenCalledTimes(1);
  });

  test("other keys do not clear", () => {
    render(<ControlledInput initial="prod" />);

    const box: HTMLElement = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Enter" });

    expect(box).toHaveValue("prod");
  });

  test("renders a leading search icon", () => {
    const { container } = render(<ControlledInput />);

    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(1);
  });
});

describe("FacetSectionHeader", () => {
  function renderHeader(
    overrides: Partial<React.ComponentProps<typeof FacetSectionHeader>> = {},
  ): MockFunction {
    const onToggle: MockFunction = getJestMockFunction();
    render(
      <FacetSectionHeader
        title="Kubernetes Cluster"
        activeCount={0}
        isExpanded={true}
        onToggle={onToggle as any}
        {...overrides}
      />,
    );
    return onToggle;
  }

  test("is a button named by its title that reports aria-expanded", () => {
    renderHeader({ isExpanded: true, controlsId: "body-1" });

    const header: HTMLElement = screen.getByRole("button", {
      name: "Kubernetes Cluster",
    });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header).toHaveAttribute("aria-controls", "body-1");
  });

  test("a collapsed header reports aria-expanded=false and controls nothing", () => {
    renderHeader({ isExpanded: false, controlsId: "body-1" });

    const header: HTMLElement = screen.getByRole("button");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).not.toHaveAttribute("aria-controls");
  });

  test("clicking calls onToggle", () => {
    const onToggle: MockFunction = renderHeader();

    fireEvent.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test("one chevron turns with the section instead of swapping icons", () => {
    const { rerender } = render(
      <FacetSectionHeader
        title="Host"
        activeCount={0}
        isExpanded={true}
        onToggle={() => {}}
      />,
    );

    const chevron: HTMLElement = screen.getByTestId("facet-section-chevron");
    expect(chevron).toHaveClass("rotate-90");
    expect(chevron).toHaveClass("transition-transform");

    rerender(
      <FacetSectionHeader
        title="Host"
        activeCount={0}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByTestId("facet-section-chevron")).toBe(chevron);
    expect(chevron).not.toHaveClass("rotate-90");
  });

  test("renders the icon before the title when given", () => {
    renderHeader({ icon: IconProp.Kubernetes });

    const icon: HTMLElement = screen.getByTestId("facet-section-icon");
    expect(icon).toHaveAttribute("data-icon", IconProp.Kubernetes);
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(icon.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    const title: HTMLElement = screen.getByText("Kubernetes Cluster");
    expect(
      icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("renders no icon slot without an icon", () => {
    renderHeader();

    expect(screen.queryByTestId("facet-section-icon")).toBeNull();
  });

  test("shows the active count badge only when non-zero", () => {
    renderHeader({ activeCount: 2 });

    expect(
      within(screen.getByRole("button")).getByText("2"),
    ).toBeInTheDocument();

    cleanup();
    renderHeader({ activeCount: 0 });

    expect(
      screen.getByRole("button", { name: "Kubernetes Cluster" }),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("button")).queryByText("0")).toBeNull();
  });
});

describe("FacetShowMoreButton", () => {
  test("renders nothing when the list already fits", () => {
    const { container } = render(
      <FacetShowMoreButton
        hasMore={false}
        isShowingAll={false}
        hiddenCount={0}
        onToggle={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("reads 'Show N more' collapsed and 'Show less' expanded", () => {
    const onToggle: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <FacetShowMoreButton
        hasMore={true}
        isShowingAll={false}
        hiddenCount={7}
        onToggle={onToggle as any}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Show 7 more",
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <FacetShowMoreButton
        hasMore={true}
        isShowingAll={true}
        hiddenCount={7}
        onToggle={onToggle as any}
      />,
    );

    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
  });
});

describe("HiddenFacetsFooter", () => {
  test("renders nothing when nothing is hidden", () => {
    const { container } = render(
      <HiddenFacetsFooter
        hiddenCount={0}
        hiddenTitles={[]}
        isShowingHidden={false}
        onToggle={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("facet-sidebar-hidden-footer")).toBeNull();
  });

  test("a negative count is treated as nothing hidden", () => {
    const { container } = render(
      <HiddenFacetsFooter
        hiddenCount={-1}
        hiddenTitles={[]}
        isShowingHidden={false}
        onToggle={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("collapsed: icon, singular count and a Show button", () => {
    const onToggle: MockFunction = getJestMockFunction();
    render(
      <HiddenFacetsFooter
        hiddenCount={1}
        hiddenTitles={["Podman Host"]}
        isShowingHidden={false}
        onToggle={onToggle as any}
        controlsId="facet-list"
      />,
    );

    const footer: HTMLElement = screen.getByTestId(
      "facet-sidebar-hidden-footer",
    );
    expect(footer).toHaveTextContent("1 empty filter hidden");
    expect(footer).toHaveClass("border-t", "border-gray-100", "text-[11px]");
    expect(footer.querySelector("svg")).not.toBeNull();

    const show: HTMLElement = screen.getByRole("button", {
      name: "Show 1 empty filter",
    });
    expect(show).toHaveTextContent("Show");
    expect(show).toHaveAttribute("aria-expanded", "false");
    expect(show).toHaveAttribute("aria-controls", "facet-list");

    fireEvent.click(show);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test("collapsed: plural count with a tooltip naming the hidden facets", () => {
    render(
      <HiddenFacetsFooter
        hiddenCount={3}
        hiddenTitles={["Docker Host", "Podman Host", "Ceph Cluster"]}
        isShowingHidden={false}
        onToggle={() => {}}
      />,
    );

    const count: HTMLElement = screen.getByText("3 empty filters hidden");
    expect(count).toHaveAttribute(
      "title",
      "Docker Host, Podman Host, Ceph Cluster",
    );
    expect(count).toHaveAttribute("data-testid", "facet-sidebar-hidden-count");
    expect(
      screen.getByRole("button", { name: "Show 3 empty filters" }),
    ).toBeInTheDocument();
  });

  test("expanded: a single 'Hide empty filters' button", () => {
    const onToggle: MockFunction = getJestMockFunction();
    render(
      <HiddenFacetsFooter
        hiddenCount={3}
        hiddenTitles={["Docker Host", "Podman Host", "Ceph Cluster"]}
        isShowingHidden={true}
        onToggle={onToggle as any}
      />,
    );

    const hide: HTMLElement = screen.getByRole("button", {
      name: "Hide empty filters",
    });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(hide).toHaveAttribute(
      "title",
      "Docker Host, Podman Host, Ceph Cluster",
    );
    expect(screen.queryByText("3 empty filters hidden")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(hide);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("useFacetSectionSearch", () => {
  function renderSearch(
    initial: FacetSectionSearchOptions,
  ): RenderHookResult<FacetSectionSearch, FacetSectionSearchOptions> {
    return renderHook(
      (options: FacetSectionSearchOptions): FacetSectionSearch => {
        return useFacetSectionSearch(options);
      },
      { initialProps: initial },
    );
  }

  test("uncontrolled: keeps its own text", () => {
    const hook: RenderHookResult<
      FacetSectionSearch,
      FacetSectionSearchOptions
    > = renderSearch({ isSearchVisible: true });

    act(() => {
      hook.result.current.setSearchText("web");
    });

    expect(hook.result.current.searchText).toBe("web");
    expect(hook.result.current.activeSearchText).toBe("web");
  });

  test("uncontrolled: still reports edits to onSearchTextChange", () => {
    const onSearchTextChange: MockFunction = getJestMockFunction();
    const hook: RenderHookResult<
      FacetSectionSearch,
      FacetSectionSearchOptions
    > = renderSearch({
      isSearchVisible: true,
      onSearchTextChange: onSearchTextChange as any,
    });

    act(() => {
      hook.result.current.setSearchText("web");
    });

    expect(onSearchTextChange).toHaveBeenCalledWith("web");
    expect(hook.result.current.searchText).toBe("web");
  });

  test("controlled: shows the given text and only reports edits", () => {
    const onSearchTextChange: MockFunction = getJestMockFunction();
    const hook: RenderHookResult<
      FacetSectionSearch,
      FacetSectionSearchOptions
    > = renderSearch({
      isSearchVisible: true,
      searchText: "api",
      onSearchTextChange: onSearchTextChange as any,
    });

    expect(hook.result.current.searchText).toBe("api");

    act(() => {
      hook.result.current.setSearchText("apis");
    });

    expect(onSearchTextChange).toHaveBeenCalledWith("apis");
    expect(hook.result.current.searchText).toBe("api");

    hook.rerender({
      isSearchVisible: true,
      searchText: "apis",
      onSearchTextChange: onSearchTextChange as any,
    });

    expect(hook.result.current.searchText).toBe("apis");
  });

  test("controlled with an empty string is still controlled", () => {
    const hook: RenderHookResult<
      FacetSectionSearch,
      FacetSectionSearchOptions
    > = renderSearch({ isSearchVisible: true, searchText: "" });

    act(() => {
      hook.result.current.setSearchText("typed");
    });

    expect(hook.result.current.searchText).toBe("");
  });

  test("emits the trimmed text once, 300ms after the last edit", () => {
    jest.useFakeTimers();
    const onSearchChange: MockFunction = getJestMockFunction();
    const hook: RenderHookResult<
      FacetSectionSearch,
      FacetSectionSearchOptions
    > = renderSearch({
      isSearchVisible: true,
      onSearchChange: onSearchChange as any,
    });

    // Mount emits "" once, as it always has.
    act(() => {
      jest.advanceTimersByTime(FACET_SEARCH_DEBOUNCE_MS);
    });
    expect(onSearchChange.mock.calls).toEqual([[""]]);

    act(() => {
      hook.result.current.setSearchText("w");
    });
    act(() => {
      jest.advanceTimersByTime(FACET_SEARCH_DEBOUNCE_MS - 1);
    });
    act(() => {
      hook.result.current.setSearchText("  web  ");
    });
    act(() => {
      jest.advanceTimersByTime(FACET_SEARCH_DEBOUNCE_MS - 1);
    });

    expect(onSearchChange.mock.calls).toEqual([[""]]);

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(onSearchChange.mock.calls).toEqual([[""], ["web"]]);

    // Same trimmed text again: nothing new to send.
    act(() => {
      hook.result.current.setSearchText("web");
    });
    act(() => {
      jest.advanceTimersByTime(FACET_SEARCH_DEBOUNCE_MS * 2);
    });

    expect(onSearchChange.mock.calls).toEqual([[""], ["web"]]);
  });

  test("a stable handler is not re-armed by unrelated re-renders", () => {
    jest.useFakeTimers();
    const onSearchChange: MockFunction = getJestMockFunction();
    const options: FacetSectionSearchOptions = {
      isSearchVisible: true,
      onSearchChange: onSearchChange as any,
    };
    const hook: RenderHookResult<
      FacetSectionSearch,
      FacetSectionSearchOptions
    > = renderSearch(options);

    act(() => {
      jest.advanceTimersByTime(200);
    });
    hook.rerender({ ...options });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  test("a hidden search box stops filtering and clears its text", () => {
    const onSearchTextChange: MockFunction = getJestMockFunction();
    const hook: RenderHookResult<
      FacetSectionSearch,
      FacetSectionSearchOptions
    > = renderSearch({
      isSearchVisible: true,
      onSearchTextChange: onSearchTextChange as any,
    });

    act(() => {
      hook.result.current.setSearchText("Sev2");
    });
    expect(hook.result.current.activeSearchText).toBe("Sev2");

    hook.rerender({
      isSearchVisible: false,
      onSearchTextChange: onSearchTextChange as any,
    });

    expect(hook.result.current.activeSearchText).toBe("");
    expect(hook.result.current.searchText).toBe("");
    expect(onSearchTextChange).toHaveBeenLastCalledWith("");
  });

  test("a hidden box with no text is left alone", () => {
    const onSearchTextChange: MockFunction = getJestMockFunction();
    renderSearch({
      isSearchVisible: false,
      onSearchTextChange: onSearchTextChange as any,
    });

    expect(onSearchTextChange).not.toHaveBeenCalled();
  });
});

describe("useFacetSearchExemptions", () => {
  type HookResult = RenderHookResult<
    FacetSearchExemptions,
    FacetSearchExemptionsOptions
  >;

  function renderExemptions(initial: FacetSearchExemptionsOptions): HookResult {
    return renderHook(
      (options: FacetSearchExemptionsOptions): FacetSearchExemptions => {
        return useFacetSearchExemptions(options);
      },
      { initialProps: initial },
    );
  }

  const WITH_VALUES: FacetData = {
    hostId: [
      { value: "h1", count: 2 },
      { value: "h2", count: 0 },
    ],
  };

  test("starts with no search text and nothing exempt", () => {
    const hook: HookResult = renderExemptions({ facetData: {} });

    expect(hook.result.current.searchTextByKey).toEqual({});
    expect(hook.result.current.searchedAtArrivalByKey).toEqual({});
    expect(hook.result.current.searchExemptKeys.size).toBe(0);
  });

  test("text in a box exempts that facet only while it is there", () => {
    const hook: HookResult = renderExemptions({ facetData: WITH_VALUES });

    act(() => {
      hook.result.current.setSearchText("hostId", "web");
    });
    expect(hook.result.current.searchTextByKey).toEqual({ hostId: "web" });
    expect([...hook.result.current.searchExemptKeys]).toEqual(["hostId"]);

    act(() => {
      hook.result.current.setSearchText("hostId", "   ");
    });
    expect(hook.result.current.searchExemptKeys.size).toBe(0);
  });

  test("setting the same text keeps the same state object", () => {
    const hook: HookResult = renderExemptions({ facetData: WITH_VALUES });

    act(() => {
      hook.result.current.setSearchText("hostId", "web");
    });
    const before: Readonly<Record<string, string>> =
      hook.result.current.searchTextByKey;

    act(() => {
      hook.result.current.setSearchText("hostId", "web");
    });

    expect(hook.result.current.searchTextByKey).toBe(before);
  });

  test("no host callback means no server-search handler", () => {
    const hook: HookResult = renderExemptions({ facetData: WITH_VALUES });

    expect(
      hook.result.current.getSearchChangeHandler("hostId"),
    ).toBeUndefined();
  });

  test("handlers forward the key, are stable per key, and use the latest callback", () => {
    const first: MockFunction = getJestMockFunction();
    const second: MockFunction = getJestMockFunction();
    const hook: HookResult = renderExemptions({
      facetData: WITH_VALUES,
      onFacetSearchChange: first as any,
    });

    const hostHandler: ((text: string) => void) | undefined =
      hook.result.current.getSearchChangeHandler("hostId");
    const dockerHandler: ((text: string) => void) | undefined =
      hook.result.current.getSearchChangeHandler("dockerHostId");

    expect(hostHandler).toBeDefined();
    expect(dockerHandler).not.toBe(hostHandler);

    hook.rerender({
      facetData: WITH_VALUES,
      onFacetSearchChange: second as any,
    });

    expect(hook.result.current.getSearchChangeHandler("hostId")).toBe(
      hostHandler,
    );

    act(() => {
      hostHandler!("web");
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("hostId", "web");
  });

  test("the full search timeline keeps a no-match facet on screen until fresh data lands", () => {
    const onFacetSearchChange: MockFunction = getJestMockFunction();
    const hook: HookResult = renderExemptions({
      facetData: WITH_VALUES,
      onFacetSearchChange: onFacetSearchChange as any,
    });
    const handler: (text: string) => void =
      hook.result.current.getSearchChangeHandler("hostId")!;

    // 1. The user types.
    act(() => {
      hook.result.current.setSearchText("hostId", "zzz");
    });
    expect(hook.result.current.searchExemptKeys.has("hostId")).toBe(true);

    // 2. The debounce sends it.
    act(() => {
      handler("zzz");
    });
    expect(onFacetSearchChange).toHaveBeenCalledWith("hostId", "zzz");

    // 3. The server answers: nothing matches.
    const noMatch: FacetData = { hostId: [] };
    hook.rerender({
      facetData: noMatch,
      onFacetSearchChange: onFacetSearchChange as any,
    });
    expect(hook.result.current.searchedAtArrivalByKey).toEqual({
      hostId: "zzz",
    });
    expect(hook.result.current.searchExemptKeys.has("hostId")).toBe(true);

    // 4. The user clears the box: the empty answer is still on screen.
    act(() => {
      hook.result.current.setSearchText("hostId", "");
    });
    expect(hook.result.current.searchExemptKeys.has("hostId")).toBe(true);

    // 5. The debounce sends "" — the same response is still showing.
    act(() => {
      handler("");
    });
    hook.rerender({
      facetData: noMatch,
      onFacetSearchChange: onFacetSearchChange as any,
    });
    expect(hook.result.current.searchedAtArrivalByKey).toEqual({
      hostId: "zzz",
    });
    expect(hook.result.current.searchExemptKeys.has("hostId")).toBe(true);

    // 6. Fresh, unsearched data arrives: no longer exempt.
    hook.rerender({
      facetData: { ...WITH_VALUES },
      onFacetSearchChange: onFacetSearchChange as any,
    });
    expect(hook.result.current.searchedAtArrivalByKey).toEqual({});
    expect(hook.result.current.searchExemptKeys.size).toBe(0);
  });

  test("an empty answer to an unsearched request is not exempt", () => {
    const onFacetSearchChange: MockFunction = getJestMockFunction();
    const hook: HookResult = renderExemptions({
      facetData: WITH_VALUES,
      onFacetSearchChange: onFacetSearchChange as any,
    });
    const handler: (text: string) => void =
      hook.result.current.getSearchChangeHandler("hostId")!;

    act(() => {
      handler("zzz");
    });
    act(() => {
      handler("");
    });

    hook.rerender({
      facetData: { hostId: [] },
      onFacetSearchChange: onFacetSearchChange as any,
    });

    expect(hook.result.current.searchExemptKeys.size).toBe(0);
  });

  test("searches are tracked per facet", () => {
    const onFacetSearchChange: MockFunction = getJestMockFunction();
    const hook: HookResult = renderExemptions({
      facetData: {},
      onFacetSearchChange: onFacetSearchChange as any,
    });

    act(() => {
      hook.result.current.getSearchChangeHandler("dockerHostId")!("  box ");
    });

    hook.rerender({
      facetData: { hostId: [], dockerHostId: [] },
      onFacetSearchChange: onFacetSearchChange as any,
    });

    expect(hook.result.current.searchedAtArrivalByKey).toEqual({
      dockerHostId: "box",
    });
    expect([...hook.result.current.searchExemptKeys]).toEqual(["dockerHostId"]);
  });
});
