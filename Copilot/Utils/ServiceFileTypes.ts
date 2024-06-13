import ServiceLanguage from 'Common/Types/ServiceCatalog/ServiceLanguage';

export default class ServiceFileTypesUtil {

    private static getCommonDirectoriesToIgnore(): string[] {
        return ['node_modules', '.git', 'build', 'dist', 'coverage', 'logs', 'tmp', 'temp', 'temporal', 'tempfiles', 'tempfiles'];
    }

    private static getCommonFilesToIgnore(): string[] {
        return ['.DS_Store', 'Thumbs.db', '.gitignore', '.gitattributes'];
    }

    public static getCommonFilesToIgnoreByServiceLanguage(
        serviceLanguage: ServiceLanguage
    ): string[] {
        let filesToIgnore: string[] = [];

        switch (serviceLanguage) {
            case ServiceLanguage.NodeJS:
                filesToIgnore = ['package-lock.json'];
                break;
            case ServiceLanguage.Python:
                filesToIgnore = ['__pycache__'];
                break;
            case ServiceLanguage.Ruby:
                filesToIgnore = ['Gemfile.lock'];
                break;
            case ServiceLanguage.Go:
                filesToIgnore = ['go.sum', 'go.mod'];
                break;
            case ServiceLanguage.Java:
                filesToIgnore = ['pom.xml'];
                break;
            case ServiceLanguage.PHP:
                filesToIgnore = ['composer.lock'];
                break;
            case ServiceLanguage.CSharp:
                filesToIgnore = ['packages', 'bin', 'obj'];
                break;
            case ServiceLanguage.CPlusPlus:
                filesToIgnore = ['build', 'CMakeFiles', 'CMakeCache.txt', 'Makefile'];
                break;
            case ServiceLanguage.Rust:
                filesToIgnore = ['Cargo.lock'];
                break;
            case ServiceLanguage.Swift:
                filesToIgnore = ['Podfile.lock'];
                break;
            case ServiceLanguage.Kotlin:
                filesToIgnore = ['gradle', 'build', 'gradlew', 'gradlew.bat', 'gradle.properties'];
                break;
            case ServiceLanguage.TypeScript:
                filesToIgnore = ['node_modules', 'package-lock.json'];
                break;
            case ServiceLanguage.JavaScript:
                filesToIgnore = ['node_modules', 'package-lock.json'];
                break;
            case ServiceLanguage.Shell:
                filesToIgnore = [];
                break;
            case ServiceLanguage.React:
                filesToIgnore = ['node_modules', 'package-lock.json'];
                break;
            case ServiceLanguage.Other:
                filesToIgnore = [];
                break;
            default:
                filesToIgnore = [];
        }

        return filesToIgnore.concat(this.getCommonFilesToIgnore()).concat(this.getCommonDirectoriesToIgnore());
    }

    private static getCommonFilesExtentions(): string[] {
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
