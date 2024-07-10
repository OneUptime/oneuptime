import URL from "Common/Types/API/URL";
import LlmType from "./Types/LlmType";

type GetStringFunction = () => string;
type GetStringOrNullFunction = () => string | null;
type GetURLFunction = () => URL;

export const GetIsCopilotDisabled: () => boolean = () => {
  return process.env["DISABLE_COPILOT"] === "true";
};

export const GetOneUptimeURL: GetURLFunction = () => {
  return URL.fromString(
    process.env["ONEUPTIME_URL"] || "https://oneuptime.com",
  );
};

export const GetRepositorySecretKey: GetStringOrNullFunction = ():
  | string
  | null => {
  return process.env["ONEUPTIME_REPOSITORY_SECRET_KEY"] || null;
};

export const GetLocalRepositoryPath: GetStringFunction = (): string => {
  return "/repository";
};

export const GetCodeRepositoryPassword: GetStringOrNullFunction = ():
  | string
  | null => {
  const token: string | null = process.env["CODE_REPOSITORY_PASSWORD"] || null;
  return token;
};

export const GetCodeRepositoryUsername: GetStringOrNullFunction = ():
  | string
  | null => {
  const username: string | null =
    process.env["CODE_REPOSITORY_USERNAME"] || null;
  return username;
};

export const GetLlamaServerUrl: GetURLFunction = () => {
  return URL.fromString(
    process.env["ONEUPTIME_LLAMA_SERVER_URL"] ||
      GetOneUptimeURL().addRoute("/llama").toString(),
  );
};

type GetLlmTypeFunction = () => LlmType;

export const GetLlmType: GetLlmTypeFunction = (): LlmType => {
  return (process.env["LLM_TYPE"] as LlmType) || LlmType.Llama;
};

export const FixNumberOfCodeEventsInEachRun: number = 5;
