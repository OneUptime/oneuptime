import { EXTERNAL_MCP_TOOL_MARK_COPY } from "./ExternalMcpServerCopy";
import { markExternalMcpToolReadOnly } from "./ExternalMcpToolMarks";
import { ExternalMcpServerTool } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import ObjectID from "Common/Types/ObjectID";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * MARK A TOOL AS READ-ONLY, the dialog (issue #11081): opened from a tool's
 * Mark as Read-Only (or Mark Again) on its server's Tools card, for one
 * tool. Before anything is saved it says plainly what marking means - what
 * the server says the tool does and what it takes, that OneUptime AI will
 * then call it with nobody asking, that it should be marked only by someone
 * who knows it only reads, and that the mark is recorded with their name
 * and stops applying when the server changes the tool. Its one primary
 * button marks; Cancel, the X and Escape leave everything as it was.
 */

export interface ComponentProps {
  externalMcpServerId: ObjectID;
  tool: ExternalMcpServerTool;
  onClose: () => void;
  // Called once the mark is saved, so the card shows it.
  onMarked: () => void;
}

const MarkExternalMcpToolModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const argumentNames: Array<string> = props.tool.argumentNames || [];

  return (
    <ConfirmModal
      title={translator.translateTemplate(
        EXTERNAL_MCP_TOOL_MARK_COPY.dialogTitle,
        { tool: props.tool.name },
      )}
      isTitleTranslated={true}
      submitButtonText={EXTERNAL_MCP_TOOL_MARK_COPY.dialogSubmit}
      isLoading={isSaving}
      error={error || undefined}
      errorWhatFailed={translator.translateText(
        EXTERNAL_MCP_TOOL_MARK_COPY.markFailed,
      )}
      onClose={() => {
        if (!isSaving) {
          props.onClose();
        }
      }}
      onSubmit={() => {
        setIsSaving(true);
        setError("");

        markExternalMcpToolReadOnly({
          externalMcpServerId: props.externalMcpServerId,
          toolName: props.tool.name,
        })
          .then(() => {
            Toast.success(
              translator.translateTemplate(
                EXTERNAL_MCP_TOOL_MARK_COPY.markedToast,
                { tool: props.tool.name },
              ),
            );
            setIsSaving(false);
            props.onMarked();
          })
          .catch((err: unknown) => {
            setIsSaving(false);
            setError(API.getFriendlyMessage(err));
          });
      }}
      description={
        <div
          className="flex flex-col gap-3 text-sm text-gray-600"
          data-testid="mark-external-mcp-tool"
        >
          {/* The server's own words, drawn as given. */}
          <div className="rounded-md border border-gray-200 px-3 py-2">
            <p className="text-xs font-medium text-gray-500">
              {translator.translateText(
                EXTERNAL_MCP_TOOL_MARK_COPY.dialogWhatItSays,
              )}
            </p>
            <p
              className="mt-1 text-sm text-gray-900 [overflow-wrap:anywhere]"
              data-testid="mark-external-mcp-tool-description"
            >
              {props.tool.description ||
                translator.translateText(
                  EXTERNAL_MCP_TOOL_MARK_COPY.dialogNoDescription,
                )}
            </p>
            {argumentNames.length > 0 ? (
              <p
                className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]"
                data-testid="mark-external-mcp-tool-arguments"
              >
                {translator.translateTemplate(
                  EXTERNAL_MCP_TOOL_MARK_COPY.dialogArguments,
                  { arguments: argumentNames.join(", ") },
                )}
              </p>
            ) : (
              <></>
            )}
          </div>
          <p data-testid="mark-external-mcp-tool-meaning">
            {translator.translateText(
              EXTERNAL_MCP_TOOL_MARK_COPY.dialogMeaning,
            )}
          </p>
          <p
            className="font-medium text-gray-900"
            data-testid="mark-external-mcp-tool-warning"
          >
            {translator.translateText(
              EXTERNAL_MCP_TOOL_MARK_COPY.dialogWarning,
            )}
          </p>
          <p data-testid="mark-external-mcp-tool-recorded">
            {translator.translateText(
              EXTERNAL_MCP_TOOL_MARK_COPY.dialogRecorded,
            )}
          </p>
        </div>
      }
    />
  );
};

export default MarkExternalMcpToolModal;
