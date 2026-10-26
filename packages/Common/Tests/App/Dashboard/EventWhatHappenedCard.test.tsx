import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * "What happened", the first card of an incident's, alert's or episode's
 * overview: the record's description and its root cause, which the overview
 * did not show before (they lived on pages of their own). What it says with
 * and without them, how a long one folds, and who may edit both, in one
 * dialog that saves through the page.
 */

interface RecordedModalProps {
  title: string;
  modelType: unknown;
  modelIdToEdit?: { toString: () => string };
  modalWidth?: string;
  submitButtonText?: string;
  formProps: {
    formType: string;
    fields: Array<{
      field: Record<string, boolean>;
      title: string;
      fieldType: string;
      description?: string;
      required?: boolean;
    }>;
  };
  onSuccess: (item: unknown) => void;
  onClose: () => void;
}

const modalProps: Array<RecordedModalProps> = [];

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: RecordedModalProps): ReactElement => {
      modalProps.push(props);
      return React.createElement("div", {
        "data-testid": "edit-what-happened-modal",
      });
    },
  };
});

// The viewer itself is MarkdownViewer's suites'; here, what it is handed.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import EventWhatHappenedCard, {
  EPISODE_STATUS_PAGE_DESCRIPTION_HELP,
  STATUS_PAGE_DESCRIPTION_HELP,
  StatusPageRecordKind,
  WHAT_HAPPENED_CARD_TITLE,
  getStatusPageDescriptionHelp,
  isOpenedByRootCause,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventWhatHappenedCard";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Alert from "../../../Models/DatabaseModels/Alert";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "../../../UI/Components/Modal/Modal";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const INCIDENT_ID: string = "20000000-0000-4000-8000-000000001042";

let gate: PermissionGateResult = { isAllowed: true };

beforeEach(() => {
  gate = { isAllowed: true };
  modalProps.length = 0;
  jest.spyOn(PermissionGate, "checkFormUpdate").mockImplementation(() => {
    return gate;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderCard(props: {
  description?: string;
  rootCause?: string;
  onSaved?: () => void;
  modelType?: typeof Incident | typeof Alert | typeof IncidentEpisode;
  statusPageRecord?: StatusPageRecordKind;
}): RenderResult {
  return render(
    <EventWhatHappenedCard<Incident | Alert | IncidentEpisode>
      modelType={(props.modelType || Incident) as typeof Incident}
      modelId={new ObjectID(INCIDENT_ID)}
      description={props.description}
      rootCause={props.rootCause}
      statusPageRecord={props.statusPageRecord}
      onSaved={props.onSaved || ((): void => {})}
    />,
  );
}

describe("what the card says", () => {
  test("leads with the description, then the root cause under its own heading", () => {
    renderCard({
      description:
        "The API monitor for POST /api/checkout reported p95 latency of **2.4s**.",
      rootCause: "checkout-api started with `DB_POOL_MAX=10` (was 40).",
    });

    expect(
      screen.getByRole("heading", { name: WHAT_HAPPENED_CARD_TITLE }),
    ).toBeVisible();

    // Each is markdown, read by the viewer the Description page uses.
    const [description, rootCauseText] = screen.getAllByTestId("markdown");

    expect(description).toHaveTextContent(
      "The API monitor for POST /api/checkout reported p95 latency of **2.4s**.",
    );
    expect(rootCauseText).toHaveTextContent(
      "checkout-api started with `DB_POOL_MAX=10` (was 40).",
    );

    const rootCause: HTMLElement = screen.getByRole("region", {
      name: "Root cause",
    });

    expect(rootCause).toContainElement(rootCauseText!);
    expect(screen.getByTestId("what-happened-description")).toContainElement(
      description!,
    );
    expect(
      screen.getByTestId("what-happened-description"),
    ).not.toHaveTextContent("DB_POOL_MAX");
  });

  test("says plainly when nothing has been written yet", () => {
    renderCard({});

    expect(
      screen.getByTestId("what-happened-description-empty"),
    ).toHaveTextContent("No description yet.");
    expect(
      screen.getByTestId("what-happened-root-cause-empty"),
    ).toHaveTextContent("Not identified yet.");
  });

  test("a root cause that is only white space is not one", () => {
    renderCard({ description: "Checkout is slow.", rootCause: "   \n " });

    expect(screen.getByText("Not identified yet.")).toBeVisible();
  });

  test("a root cause without a description still shows, under its heading", () => {
    renderCard({ rootCause: "The pool size was cut to 10." });

    expect(screen.getByText("No description yet.")).toBeVisible();
    expect(screen.getByText("The pool size was cut to 10.")).toBeVisible();
  });

  test("nothing inside the card is a box: the root cause is a section under a hairline", () => {
    renderCard({ description: "Checkout is slow." });

    const section: HTMLElement = screen.getByTestId("what-happened-root-cause");

    expect(section.className).toContain("border-t");
    expect(section.className).not.toContain("rounded");
    expect(section.className).not.toContain("shadow");
    expect(section.className).not.toContain("bg-");
  });
});

describe("a long description or root cause", () => {
  /*
   * jsdom lays nothing out, so heights are given: the text's own height,
   * and the collapsed frame's six lines.
   */
  let contentHeight: number = 0;

  beforeEach(() => {
    contentHeight = 0;
    jest
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement): number {
        return this.parentElement
          ?.getAttribute("data-testid")
          ?.endsWith("-text")
          ? contentHeight
          : 0;
      });
    jest
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement): number {
        return this.getAttribute("data-testid")?.endsWith("-text") ? 144 : 0;
      });
  });

  test("a text that fits shows whole, with no Show more and no fade", () => {
    contentHeight = 96;
    renderCard({ description: "Checkout is slow." });

    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

    const frame: HTMLElement = screen.getByTestId(
      "what-happened-description-text",
    );

    expect(frame.className).not.toContain("mask-image");
  });

  test("a longer one shows its first lines, fading out, and Show more opens it", () => {
    contentHeight = 400;
    renderCard({ description: "A very long description." });

    const frame: HTMLElement = screen.getByTestId(
      "what-happened-description-text",
    );
    const showMore: HTMLElement = screen.getByRole("button", {
      name: "Show more",
    });

    expect(frame.className).toContain("max-h-36");
    expect(frame.className).toContain("overflow-hidden");
    expect(frame.className).toContain("mask-image");
    expect(showMore).toHaveAttribute("aria-expanded", "false");
    expect(showMore).toHaveAttribute("aria-controls", frame.id);

    fireEvent.click(showMore);

    const showLess: HTMLElement = screen.getByRole("button", {
      name: "Show less",
    });

    expect(showLess).toHaveAttribute("aria-expanded", "true");
    expect(frame.className).not.toContain("max-h-36");
    expect(frame.className).not.toContain("mask-image");

    fireEvent.click(showLess);

    expect(frame.className).toContain("max-h-36");
  });

  test("the description and the root cause fold on their own", () => {
    contentHeight = 400;
    renderCard({
      description: "A very long description.",
      rootCause: "A very long root cause.",
    });

    const [descriptionMore, rootCauseMore] = screen.getAllByRole("button", {
      name: "Show more",
    });

    fireEvent.click(rootCauseMore!);

    expect(descriptionMore).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByTestId("what-happened-root-cause-value-text").className,
    ).not.toContain("max-h-36");
    expect(
      screen.getByTestId("what-happened-description-text").className,
    ).toContain("max-h-36");
  });

  test("a different text starts folded again", () => {
    contentHeight = 400;
    const view: RenderResult = renderCard({
      description: "A very long description.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: "Show less" })).toBeVisible();

    view.rerender(
      <EventWhatHappenedCard<Incident>
        modelType={Incident}
        modelId={new ObjectID(INCIDENT_ID)}
        description="Another very long description."
        onSaved={(): void => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

/*
 * An incident or alert somebody opened by hand without a root cause used to
 * be given one by the server: "Incident created by [Maya Chen](...)", or
 * "Incident created by @maya on Slack." from Slack's form. That says who,
 * which the Declared / Created tile already says - not why. New records get
 * none; the ones written before read as none here.
 */
describe("the root cause the server wrote for a record opened by hand", () => {
  const MAYA_LINK: string =
    "[Maya Chen](https://oneuptime.example/dashboard/10000000-0000-4000-8000-000000000001/settings/users/80000000-0000-4000-8000-000000000001)";

  test("reads as no root cause yet, for an incident and for an alert", () => {
    for (const stored of [
      `Incident created by ${MAYA_LINK}`,
      `Alert created by ${MAYA_LINK}`,
      `  Incident created by ${MAYA_LINK}\n`,
      "Incident created by @maya.chen on Slack.",
      "Incident created via Microsoft Teams",
    ]) {
      const view: RenderResult = renderCard({
        description: "Checkout is slow.",
        rootCause: stored,
      });

      expect(
        view.getByTestId("what-happened-root-cause-empty"),
      ).toHaveTextContent("Not identified yet.");
      expect(view.queryByTestId("what-happened-root-cause-value")).toBeNull();
      expect(view.container).not.toHaveTextContent("created by");
      expect(view.container).not.toHaveTextContent("created via");

      view.unmount();
    }
  });

  test("a root cause somebody wrote is shown, even one that starts the same way", () => {
    for (const written of [
      "Incident created by a bad deploy of checkout-api.",
      `Incident created by ${MAYA_LINK}, who rolled back the pool size change.`,
      `The pool was cut to 10.\n\nIncident created by ${MAYA_LINK}`,
    ]) {
      const view: RenderResult = renderCard({ rootCause: written });

      expect(
        view.getByTestId("what-happened-root-cause-value"),
      ).toBeInTheDocument();
      expect(view.queryByTestId("what-happened-root-cause-empty")).toBeNull();

      view.unmount();
    }
  });

  test("knows the server's sentences and nothing else", () => {
    expect(isOpenedByRootCause(`Incident created by ${MAYA_LINK}`)).toBe(true);
    expect(isOpenedByRootCause(`Alert created by ${MAYA_LINK}`)).toBe(true);
    expect(
      isOpenedByRootCause("Incident created by @maya.chen on Slack."),
    ).toBe(true);
    expect(isOpenedByRootCause("Incident created via Microsoft Teams")).toBe(
      true,
    );
    expect(isOpenedByRootCause("Incident created by Maya Chen")).toBe(false);
    expect(isOpenedByRootCause(`Episode created by ${MAYA_LINK}`)).toBe(false);
    expect(
      isOpenedByRootCause(
        "Incident created by @maya.chen on Slack. The pool was cut to 10.",
      ),
    ).toBe(false);
    expect(isOpenedByRootCause("")).toBe(false);
  });
});

describe("editing", () => {
  test("Edit opens one dialog for the description and the root cause, on this record", () => {
    renderCard({
      description: "Checkout is slow.",
      statusPageRecord: "incident",
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByTestId("edit-what-happened-modal")).toBeInTheDocument();

    const props: RecordedModalProps = modalProps[modalProps.length - 1]!;

    expect(props.title).toBe("Edit what happened");
    expect(props.modelType).toBe(Incident);
    expect(props.modelIdToEdit?.toString()).toBe(INCIDENT_ID);
    expect(props.modalWidth).toBe(ModalWidth.Large);
    expect(props.formProps.formType).toBe(FormType.Update);
    expect(
      props.formProps.fields.map(
        (field: RecordedModalProps["formProps"]["fields"][number]) => {
          return [Object.keys(field.field)[0], field.title, field.fieldType];
        },
      ),
    ).toEqual([
      ["description", "Description", FormFieldSchemaType.Markdown],
      ["rootCause", "Root Cause", FormFieldSchemaType.Markdown],
    ]);
    // Neither is required: a record can be saved with either left blank.
    for (const field of props.formProps.fields) {
      expect(field.required).toBe(false);
    }
    /*
     * An incident's description shows on the status pages it appears on;
     * the form says so, in a key of its own the dialog translates.
     */
    expect(props.formProps.fields[0]!.description).toBe(
      "Shown on the status pages this incident appears on.",
    );
    expect(props.formProps.fields[0]!.description).toBe(
      STATUS_PAGE_DESCRIPTION_HELP,
    );
  });

  test("an alert's dialog edits the alert, and says nothing about status pages", () => {
    renderCard({ modelType: Alert });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const props: RecordedModalProps = modalProps[modalProps.length - 1]!;

    expect(props.modelType).toBe(Alert);
    expect(props.formProps.fields[0]!.description).toBeUndefined();
  });

  test("an incident episode's dialog says its description shows on the status pages it appears on", () => {
    renderCard({ modelType: IncidentEpisode, statusPageRecord: "episode" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const props: RecordedModalProps = modalProps[modalProps.length - 1]!;

    expect(props.modelType).toBe(IncidentEpisode);
    expect(props.formProps.fields[0]!.description).toBe(
      "Shown on the status pages this episode appears on.",
    );
    expect(props.formProps.fields[0]!.description).toBe(
      EPISODE_STATUS_PAGE_DESCRIPTION_HELP,
    );
  });

  test("names the public record the description belongs to, or says nothing", () => {
    expect(getStatusPageDescriptionHelp("incident")).toBe(
      STATUS_PAGE_DESCRIPTION_HELP,
    );
    expect(getStatusPageDescriptionHelp("episode")).toBe(
      EPISODE_STATUS_PAGE_DESCRIPTION_HELP,
    );
    expect(getStatusPageDescriptionHelp(undefined)).toBeUndefined();
  });

  test("a save closes the dialog and hands the page the refresh", () => {
    const onSaved: () => void = jest.fn<() => void>();

    renderCard({ onSaved: onSaved });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    act(() => {
      modalProps[modalProps.length - 1]!.onSuccess(new Incident());
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("edit-what-happened-modal")).toBeNull();
  });

  test("closing the dialog saves nothing", () => {
    const onSaved: () => void = jest.fn<() => void>();

    renderCard({ onSaved: onSaved });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    act(() => {
      modalProps[modalProps.length - 1]!.onClose();
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByTestId("edit-what-happened-modal")).toBeNull();
  });

  test("asks about exactly the two columns it edits", () => {
    renderCard({});

    const [, fields] = (
      PermissionGate.checkFormUpdate as unknown as {
        mock: {
          calls: Array<[unknown, Array<{ field: Record<string, unknown> }>]>;
        };
      }
    ).mock.calls[0]!;

    expect(
      fields.map((field: { field: Record<string, unknown> }) => {
        return Object.keys(field.field)[0];
      }),
    ).toEqual(["description", "rootCause"]);
  });

  test("somebody who may not change them sees Edit locked, with why", () => {
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to edit this Incident. You need one of these permissions: Project Owner.",
    };

    renderCard({ description: "Checkout is slow." });

    const edit: HTMLElement = screen.getByRole("button", { name: "Edit" });

    expect(edit).toBeDisabled();

    fireEvent.click(edit);

    expect(screen.queryByTestId("edit-what-happened-modal")).toBeNull();
  });

  test("no Edit while there is nothing honest to say about it yet", () => {
    gate = { isAllowed: false };

    renderCard({ description: "Checkout is slow." });

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
