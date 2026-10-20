import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The three ways AI comes into OneUptime, as AI / LLM > Connect offers them:
 * pick one, and the page shows that way's shortest path - the snippet and
 * a key for your apps, the providers' tiles, or the company AI tools' tiles.
 *
 * The way shown is in the address (?way=providers), so a link can open the
 * one it means - Usage's "Connect a provider account" opens the tiles - and
 * a reader's own pick is remembered in their browser for the next visit
 * (LlmConnectWayChoice).
 *
 * Plain data, so it can be read without React.
 */

export type LlmConnectWayKey = "apps" | "providers" | "tools";

export const LLM_CONNECT_WAY_KEYS: ReadonlyArray<LlmConnectWayKey> = [
  "apps",
  "providers",
  "tools",
];

export const LLM_CONNECT_DEFAULT_WAY: LlmConnectWayKey = "apps";

// The address's parameter: /llm/connect?way=providers.
export const LLM_CONNECT_WAY_QUERY_PARAM: string = "way";

export const LLM_CONNECT_WAY_STORAGE_KEY: string = "oneuptime.llm-connect-way";

export interface LlmConnectWay {
  key: LlmConnectWayKey;
  // English translation keys; the picker translates them.
  title: string;
  description: string;
  icon: IconProp;
}

export const LLM_CONNECT_WAYS: ReadonlyArray<LlmConnectWay> = [
  {
    key: "apps",
    title: translationKey("Your apps"),
    description: translationKey(
      "Every call as it happens: the conversation, the person, tokens, cost and bad answers.",
    ),
    icon: IconProp.Code,
  },
  {
    key: "providers",
    title: translationKey("Your AI provider accounts"),
    description: translationKey(
      "What your OpenAI, Anthropic, Azure, Bedrock or Vertex AI accounts used and cost, with no code.",
    ),
    icon: IconProp.CreditCard,
  },
  {
    key: "tools",
    title: translationKey("Your company's AI tools"),
    description: translationKey(
      "What your people ask Claude Enterprise or Microsoft 365 Copilot, by person.",
    ),
    icon: IconProp.UserGroup,
  },
];

export function isLlmConnectWayKey(value: unknown): value is LlmConnectWayKey {
  return (
    typeof value === "string" &&
    (LLM_CONNECT_WAY_KEYS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * The way a page opens on: the one the address names, else the reader's
 * own last pick, else your apps.
 */
export function readLlmConnectWay(data: {
  fromAddress: string | null;
  remembered: LlmConnectWayKey;
}): LlmConnectWayKey {
  if (isLlmConnectWayKey(data.fromAddress)) {
    return data.fromAddress;
  }

  return isLlmConnectWayKey(data.remembered)
    ? data.remembered
    : LLM_CONNECT_DEFAULT_WAY;
}

/*
 * How a way is doing, ticked by what is true rather than by what was
 * clicked: an app's AI calls arrived in the last week, or how many
 * connections the way has and how many of them are not working. Undefined
 * is "not known yet" (still loading, or the read failed): the picker then
 * says nothing either way.
 */
export interface LlmConnectWayStatus {
  isSetUp: boolean | undefined;
  connected: number;
  failing: number;
}

export interface LlmConnectWayChip {
  key: "receiving" | "connected" | "failing";
  // An English translation key, or a template with {{count}}.
  text: string;
  count?: number | undefined;
  tone: "success" | "danger";
}

// What a way's card says about it, beside its description.
export function getLlmConnectWayChips(
  key: LlmConnectWayKey,
  status: LlmConnectWayStatus,
): Array<LlmConnectWayChip> {
  if (key === "apps") {
    return status.isSetUp === true
      ? [
          {
            key: "receiving",
            text: translationKey("Receiving AI calls"),
            tone: "success",
          },
        ]
      : [];
  }

  const chips: Array<LlmConnectWayChip> = [];

  if (status.connected > 0) {
    chips.push(
      status.connected > 1
        ? {
            key: "connected",
            text: translationKey("Connected ({{count}})"),
            count: status.connected,
            tone: "success",
          }
        : {
            key: "connected",
            text: translationKey("Connected"),
            tone: "success",
          },
    );
  }

  if (status.failing > 0) {
    chips.push({
      key: "failing",
      text: translationKey("Not working"),
      tone: "danger",
    });
  }

  return chips;
}
