export interface TelegramMessagePayload {
  body: string;
  parseMode?: "MarkdownV2" | "HTML" | undefined;
  disableWebPagePreview?: boolean | undefined;
}

export default interface TelegramMessage extends TelegramMessagePayload {
  to: string;
}
