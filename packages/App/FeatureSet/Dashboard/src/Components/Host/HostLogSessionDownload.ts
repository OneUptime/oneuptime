import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { getHostLogSessionLinesRoute } from "Common/Types/Host/HostLogSession";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import downloadFile from "Common/UI/Utils/DownloadFile";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Download Lines on a device's Logs page (#9966): a log session's lines as
 * the `logcat -v threadtime` text file a vendor's support asks for, saved
 * under the name the server gives it (GET /host-log-session/:id/lines,
 * Common/Server/API/HostLogSessionAPI). The server reads the lines with the
 * reader's own permissions, as Logs does, so a reader who cannot see them
 * there downloads nothing: the refusal comes back as the error.
 */

export interface DownloadedLines {
  fileName: string;
  lineCount: number;
  isTruncated: boolean;
}

// The answer, read defensively: a server from before this route answers no file.
export function readLinesAnswer(data: JSONObject | undefined): {
  fileName: string;
  content: string;
  lineCount: number;
  isTruncated: boolean;
} {
  const fileName: unknown = data?.["fileName"];
  const content: unknown = data?.["content"];
  const lineCount: unknown = data?.["lineCount"];

  return {
    fileName:
      typeof fileName === "string" && fileName.trim()
        ? fileName.trim()
        : "log-session.txt",
    content: typeof content === "string" ? content : "",
    lineCount: typeof lineCount === "number" ? lineCount : 0,
    isTruncated: data?.["isTruncated"] === true,
  };
}

export default async function downloadHostLogSessionLines(
  sessionId: string,
): Promise<DownloadedLines> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        getHostLogSessionLinesRoute(sessionId),
      ),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const answer: ReturnType<typeof readLinesAnswer> = readLinesAnswer(
    response.data as JSONObject,
  );

  downloadFile({
    content: answer.content,
    filename: answer.fileName,
    mimeType: "text/plain;charset=utf-8;",
  });

  return {
    fileName: answer.fileName,
    lineCount: answer.lineCount,
    isTruncated: answer.isTruncated,
  };
}
