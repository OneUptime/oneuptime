import ServiceLanguage from "../Types/ServiceCatalog/ServiceLanguage";

export default class ServiceLanguageUtil {
    public static getLanguageByFileExtension(data: {
        fileExtension: string;
    }): ServiceLanguage {
        const { fileExtension } = data;
    
        switch (fileExtension) {
        case "js":
            return ServiceLanguage.JavaScript;
        case "ts":
            return ServiceLanguage.TypeScript;
        case "py":
            return ServiceLanguage.Python;
        case "rb":
            return ServiceLanguage.Ruby;
        case "java":
            return ServiceLanguage.Java;
        case "php":
            return ServiceLanguage.PHP;
        case "cs":
            return ServiceLanguage.CSharp;
        case "cpp":
            return ServiceLanguage.CPlusPlus;
        case "rs":
            return ServiceLanguage.Rust;
        case "swift":
            return ServiceLanguage.Swift;
        case "kt":
            return ServiceLanguage.Kotlin;
        case "go":
            return ServiceLanguage.Go;
        case "sh":
            return ServiceLanguage.Shell;
        default:
            return ServiceLanguage.Other;
        }
    }
}