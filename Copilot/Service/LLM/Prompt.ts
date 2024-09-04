export enum PromptRole {
  System = "system",
  User = "user",
  Assistant = "assistant",
}

export interface Prompt {
  content: string;
  role: PromptRole;
}
