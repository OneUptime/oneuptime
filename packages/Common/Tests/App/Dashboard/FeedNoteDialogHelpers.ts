import "@testing-library/jest-dom";
import { expect } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import { ReactElement } from "react";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MockFunction } from "../../MockType";

/*
 * Shared steps for the tests that write a note from a feed's "Add Public
 * Note" / "Add Private Note" dialog. Each test file keeps its own jest.mock
 * calls (they are hoisted per file); these only drive the rendered page.
 */

export const NOTIFY_FLAG: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";

// The composer's sentences under "Notify status page subscribers".
export const NOTIFYING_DESCRIPTION: string =
  "Subscribers will be notified about this update as soon as you post it.";
export const UNTICKED_ON_NOTIFYING_EVENT_DESCRIPTION: string =
  "The update will appear on your status page without notifying subscribers.";

export async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

export async function renderAndSettle(
  element: ReactElement,
): Promise<RenderResult> {
  const view: RenderResult = render(element);
  await flush();
  return view;
}

export async function openNoteDialog(menuText: string): Promise<HTMLElement> {
  const trigger: HTMLElement = screen
    .getByText("Actions")
    .closest('[aria-haspopup="menu"]') as HTMLElement;

  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: menuText }));
  await flush();

  return screen.getByRole("dialog", { name: menuText });
}

export function noteEditor(dialog: HTMLElement): HTMLTextAreaElement {
  return within(dialog).getByLabelText("Note text") as HTMLTextAreaElement;
}

export function writeNote(dialog: HTMLElement, text: string): void {
  fireEvent.change(noteEditor(dialog), { target: { value: text } });
}

export function notifyCheckbox(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByRole("checkbox", {
    name: "Notify status page subscribers",
  }) as HTMLInputElement;
}

export function notifyDescription(dialog: HTMLElement): string {
  return (
    within(dialog).getByTestId("note-notify-description").textContent || ""
  );
}

export async function postNote(dialog: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
  });
  await flush();
}

// What ModelAPI.create would put on the wire for the index-th note posted.
export function postedPayload(
  createMock: MockFunction,
  index: number = 0,
): Record<string, unknown> {
  const call: Array<unknown> | undefined = createMock.mock.calls[index];

  expect(call).toBeDefined();

  const request: { model: BaseModel; modelType: { new (): BaseModel } } =
    call![0] as { model: BaseModel; modelType: { new (): BaseModel } };

  return JSON.parse(
    JSON.stringify(BaseModel.toJSON(request.model, request.modelType)),
  ) as Record<string, unknown>;
}

export function postedModelType(
  createMock: MockFunction,
  index: number = 0,
): { new (): BaseModel } {
  return (
    createMock.mock.calls[index]![0] as { modelType: { new (): BaseModel } }
  ).modelType;
}
