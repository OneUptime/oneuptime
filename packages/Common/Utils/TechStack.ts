import TechStack from "../Types/Service/TechStack";

export default class ServiceLanguageUtil {
  public static getLanguageByFileExtension(data: {
    fileExtension: string;
  }): TechStack {
    const { fileExtension } = data;

    switch (fileExtension) {
      case "js":
        return TechStack.JavaScript;
      case "ts":
        return TechStack.TypeScript;
      case "py":
        return TechStack.Python;
      case "rb":
        return TechStack.Ruby;
      case "java":
        return TechStack.Java;
      case "php":
        return TechStack.PHP;
      case "cs":
        return TechStack.CSharp;
      case "cpp":
        return TechStack.CPlusPlus;
      case "rs":
        return TechStack.Rust;
      case "swift":
        return TechStack.Swift;
      case "kt":
        return TechStack.Kotlin;
      case "go":
        return TechStack.Go;
      case "sh":
        return TechStack.Shell;
      default:
        return TechStack.Other;
    }
  }
}
