import { DropdownOption } from "../Components/Dropdown/Dropdown";
import LlmType from "../../Types/LLM/LlmType";

/*
 * Human-friendly display labels for each LLM provider. The dropdown `value`
 * remains the raw LlmType enum value (which is persisted in the database), so
 * only the label shown to the user changes.
 */
const LlmTypeDropdownOptions: Array<DropdownOption> = [
  {
    label: "OpenAI",
    value: LlmType.OpenAI,
  },
  {
    label: "Azure OpenAI",
    value: LlmType.AzureOpenAI,
  },
  {
    label: "Anthropic",
    value: LlmType.Anthropic,
  },
  {
    label: "Groq",
    value: LlmType.Groq,
  },
  {
    label: "Mistral",
    value: LlmType.Mistral,
  },
  {
    label: "Ollama",
    value: LlmType.Ollama,
  },
  {
    label: "OpenAI-Compatible (vLLM, LocalAI, etc.)",
    value: LlmType.OpenAICompatible,
  },
];

export default LlmTypeDropdownOptions;
