import { UNEXPLAINED_ERROR_MESSAGES } from "../../Types/Exception/UnexplainedError";

/**
 * A REQUEST BODY THE APP'S BODY PARSERS REFUSED IS THE CLIENT'S, NOT A FAULT
 * (#8419).
 *
 * express.json, express.urlencoded and express.raw (StartServer, and the MCP
 * OAuth routes' own) refuse a body they cannot take with an http-errors
 * error: a `type` that names what was wrong, a 4xx `status` and `expose`
 * set. None is one of OneUptime's Exceptions, so the last-resort handler
 * took each for a fault in the code: it logged an error and answered 500
 * with "The server ran into a problem it could not explain" and a reference
 * to hand to support - for a body over the 50 MB limit, for JSON that does
 * not parse. The person was told to report what they could fix themselves,
 * the on-call person read a code fault in the logs, and the API, the CLI and
 * Terraform read a 500 for their own mistake.
 *
 * Now each is answered with its own status and a sentence that says what
 * was wrong and what to do. A body that was too large is answered with
 * UNEXPLAINED_ERROR_MESSAGES.tooLarge, the sentence the front ends already
 * say for a proxy's 413 (#8278), so they read it back and draw it in the
 * reader's language. The others are for whoever wrote the request - a
 * script, the CLI, an integration - since the front ends send none of them.
 *
 * Only these types: a parser's 500s ("stream.not.readable",
 * "stream.encoding.set") are faults in how the server wires its parsers, and
 * "entity.verify.failed" would be a verify function of ours that threw.
 * Those still answer 500 with a reference.
 */

export const REQUEST_BODY_REFUSAL_MESSAGES: {
  tooLarge: string;
  invalidJson: string;
  cutOff: string;
  sizeMismatch: string;
  encodingUnsupported: string;
  charsetUnsupported: string;
  tooDeep: string;
} = {
  // The front ends' own sentence for a 413 (Types/Exception/UnexplainedError).
  tooLarge: UNEXPLAINED_ERROR_MESSAGES.tooLarge,
  invalidJson:
    "The request body is not valid JSON, so this did not finish. Check the JSON, and that the Content-Type header names what the body is, then send the request again.",
  cutOff:
    "The request body did not arrive in full, so this did not finish. Send the request again.",
  sizeMismatch:
    "The request body was not the size its Content-Length header said, so this did not finish. Send the request again with the right Content-Length.",
  encodingUnsupported:
    "The request body is compressed in a way OneUptime does not read, so this did not finish. Send it uncompressed, or with a Content-Encoding of gzip or deflate.",
  charsetUnsupported:
    "The request body is in a character set OneUptime does not read, so this did not finish. Send it in UTF-8.",
  tooDeep:
    "The form sent nests its fields deeper than OneUptime reads, so this did not finish. Send it with fewer levels of nesting.",
};

interface RequestBodyRefusalRule {
  status: number;
  message: string;
}

/*
 * The body parsers' error types (body-parser and raw-body, as express 4
 * ships them), each with the status it answers and its sentence.
 */
export const REQUEST_BODY_REFUSALS: Record<string, RequestBodyRefusalRule> = {
  // Over the parser's `limit` (50 MB), counted after a deflate body inflates.
  "entity.too.large": {
    status: 413,
    message: REQUEST_BODY_REFUSAL_MESSAGES.tooLarge,
  },
  // A form with more fields than the urlencoded parser's parameterLimit.
  "parameters.too.many": {
    status: 413,
    message: REQUEST_BODY_REFUSAL_MESSAGES.tooLarge,
  },
  // JSON that does not parse, or whose top level is not an object or array.
  "entity.parse.failed": {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.invalidJson,
  },
  // The client stopped sending before the body was in.
  "request.aborted": {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.cutOff,
  },
  // Fewer or more bytes than Content-Length said.
  "request.size.invalid": {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.sizeMismatch,
  },
  // A Content-Encoding other than gzip, deflate or identity ("br").
  "encoding.unsupported": {
    status: 415,
    message: REQUEST_BODY_REFUSAL_MESSAGES.encodingUnsupported,
  },
  // A charset the parser cannot decode.
  "charset.unsupported": {
    status: 415,
    message: REQUEST_BODY_REFUSAL_MESSAGES.charsetUnsupported,
  },
  // A urlencoded form nested past the parser's depth.
  "querystring.parse.rangeError": {
    status: 400,
    message: REQUEST_BODY_REFUSAL_MESSAGES.tooDeep,
  },
};

export interface RequestBodyRefusal {
  // The parser's own name for it, for the log line.
  type: string;
  status: number;
  message: string;
}

/*
 * What to answer for an error a body parser raised over the client's body,
 * or null for anything else, which the handler treats as before. A body
 * parser's error says so three ways at once: one of its types, a 4xx
 * status, and `expose` (http-errors sets it for every 4xx), so an error of
 * the code's own that happens to carry a `type` is not taken for one.
 */
export const readRequestBodyRefusal: (
  error: unknown,
) => RequestBodyRefusal | null = (
  error: unknown,
): RequestBodyRefusal | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate: {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  } = error as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  };

  const type: unknown = candidate.type;

  if (
    typeof type !== "string" ||
    !Object.prototype.hasOwnProperty.call(REQUEST_BODY_REFUSALS, type)
  ) {
    return null;
  }

  const status: unknown = candidate.status ?? candidate.statusCode;

  if (
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    status < 400 ||
    status > 499 ||
    candidate.expose !== true
  ) {
    return null;
  }

  const rule: RequestBodyRefusalRule = REQUEST_BODY_REFUSALS[type]!;

  return {
    type: type,
    status: rule.status,
    message: rule.message,
  };
};

export default readRequestBodyRefusal;
