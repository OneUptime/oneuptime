import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression tests for the forged-evidence hole: BaseAPI auto-registers
 * create/update HTTP routes for every CRUD model. If message/run/event
 * models ever gain non-empty create or update permissions, any project
 * member could POST fake assistant messages with fabricated citations, or
 * edit transcripts. These tables must stay server-write-only.
 */
describe("AI chat model access control", () => {
  test("AIConversationMessage is not writable through the CRUD API", () => {
    const model: AIConversationMessage = new AIConversationMessage();
    expect(model.getCreatePermissions()).toHaveLength(0);
    expect(model.getUpdatePermissions()).toHaveLength(0);
    expect(model.getDeletePermissions()).toHaveLength(0);
  });

  test("AIRun is not writable through the CRUD API", () => {
    const model: AIRun = new AIRun();
    expect(model.getCreatePermissions()).toHaveLength(0);
    expect(model.getUpdatePermissions()).toHaveLength(0);
    expect(model.getDeletePermissions()).toHaveLength(0);
  });

  test("AIRunEvent is not writable through the CRUD API", () => {
    const model: AIRunEvent = new AIRunEvent();
    expect(model.getCreatePermissions()).toHaveLength(0);
    expect(model.getUpdatePermissions()).toHaveLength(0);
    expect(model.getDeletePermissions()).toHaveLength(0);
  });

  test("AIConversation can be created and read by members but not updated", () => {
    const model: AIConversation = new AIConversation();
    expect(model.getCreatePermissions().length).toBeGreaterThan(0);
    expect(model.getReadPermissions().length).toBeGreaterThan(0);
    expect(model.getUpdatePermissions()).toHaveLength(0);
  });
});
