import ServiceLanguage from 'Common/Types/ServiceCatalog/ServiceLanguage';

export default class ServiceFileTypesUtil {
    public static getCommonFilesExtentions(): string[] {
        // return markdown, dockerfile, etc.
        return ['.md', 'dockerfile', '.yml', '.yaml', '.sh', '.gitignore'];
    }

    public static getFileExtentionsByServiceLanguage(
        serviceLanguage: ServiceLanguage
    ): string[] {
        let fileExtentions: Array<string> = [];

        switch (serviceLanguage) {
            case ServiceLanguage.NodeJS:
                fileExtentions = ['.js', '.ts', '.json', '.mjs'];
                break;
            case ServiceLanguage.Python:
                fileExtentions = ['.py'];
                break;
            case ServiceLanguage.Ruby:
                fileExtentions = ['.rb'];
                break;
            case ServiceLanguage.Go:
                fileExtentions = ['.go'];
                break;
            case ServiceLanguage.Java:
                fileExtentions = ['.java'];
                break;
            case ServiceLanguage.PHP:
                fileExtentions = ['.php'];
                break;
            case ServiceLanguage.CSharp:
                fileExtentions = ['.cs'];
                break;
            case ServiceLanguage.CPlusPlus:
                fileExtentions = ['.cpp', '.c'];
                break;
            case ServiceLanguage.Rust:
                fileExtentions = ['.rs'];
                break;
            case ServiceLanguage.Swift:
                fileExtentions = ['.swift'];
                break;
            case ServiceLanguage.Kotlin:
                fileExtentions = ['.kt', '.kts'];
                break;
            case ServiceLanguage.TypeScript:
                fileExtentions = ['.ts', '.tsx'];
                break;
            case ServiceLanguage.JavaScript:
                fileExtentions = ['.js', '.jsx'];
                break;
            case ServiceLanguage.Shell:
                fileExtentions = ['.sh'];
                break;
            case ServiceLanguage.React:
                fileExtentions = ['.js', '.ts', '.jsx', '.tsx'];
                break;
            case ServiceLanguage.Other:
                fileExtentions = [];
                break;
            default:
                fileExtentions = [];
        }

        // add common files extentions

        return fileExtentions.concat(this.getCommonFilesExtentions());
    }
}
