import { InlineText } from "./GuideTypes";
import {
  BROWSER_KEY_PREREQUISITE,
  SERVER_KEY_PREREQUISITE,
  VALIDATE_BROWSER_KEY_BODY,
  VALIDATE_SERVER_KEY_BODY,
} from "./GuideShared";
import { DOTNET_PREREQUISITE, DOTNET_PROTOCOL_NOTE } from "./DotNetShared";
import { GO_PREREQUISITE } from "./GoShared";
import { NODE_PREREQUISITE } from "./JavaScriptShared";
import {
  PYTHON_PREREQUISITE,
  PYTHON_PROTOCOL_NOTE,
  PYTHON_STABLE_HTTP_NOTE,
} from "./PythonShared";

/*
 * The sentences guides share on purpose, because they state one fact the
 * same way everywhere: each is kept in one place (GuideShared,
 * JavaScriptShared, PythonShared, DotNetShared, GoShared, RubyShared,
 * PhpShared, RustShared, ElixirShared) and left out of the check that no two
 * guides write the same sentence (Tests/OpenTelemetryGuides). Everything
 * else a guide says is its own.
 */
export const SHARED_GUIDE_TEXTS: Array<InlineText> = [
  SERVER_KEY_PREREQUISITE,
  BROWSER_KEY_PREREQUISITE,
  NODE_PREREQUISITE,
  PYTHON_PREREQUISITE,
  PYTHON_PROTOCOL_NOTE,
  PYTHON_STABLE_HTTP_NOTE,
  DOTNET_PREREQUISITE,
  DOTNET_PROTOCOL_NOTE,
  GO_PREREQUISITE,
  VALIDATE_SERVER_KEY_BODY,
  VALIDATE_BROWSER_KEY_BODY,
];
