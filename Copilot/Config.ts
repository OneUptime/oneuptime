import URL from "Common/Types/API/URL";
import LlmType from "./Types/LlmType";
import BadDataException from "Common/Types/Exception/BadDataException";

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

export const GetLlmServerUrl: GetURLFunction = () => {

  if(!process.env["ONEUPTIME_LLM_SERVER_URL"]) {
    throw new BadDataException("ONEUPTIME_LLM_SERVER_URL is not set")
  }

  return URL.fromString(
    process.env["ONEUPTIME_LLM_SERVER_URL"]
  );
};

export const GetOpenAIAPIKey: GetStringOrNullFunction = (): string | null => {
  return process.env["OPENAI_API_KEY"] || null;
}

export const GetOpenAIModel: GetStringOrNullFunction = (): string | null => {
  return process.env["OPENAI_MODEL"] || null;
}

type GetLlmTypeFunction = () => LlmType;

export const GetLlmType: GetLlmTypeFunction = (): LlmType => {
  if(GetOpenAIAPIKey() && GetOpenAIModel()) {
    return LlmType.OpenAI;
  }

  if(GetLlmServerUrl()) {
    return LlmType.LLM;
  }

  return LlmType.LLM;
};

export const FixNumberOfCodeEventsInEachRun: number = 5;
