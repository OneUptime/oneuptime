import TechStack from "Common/Types/ServiceCatalog/TechStack";

export default class ServiceFileTypesUtil {
  private static getCommonDirectoriesToIgnore(): string[] {
    return [
      "node_modules",
      ".git",
      "build",
      "dist",
      "coverage",
      "logs",
      "tmp",
      "temp",
      "temporal",
      "tempfiles",
      "tempfiles",
    ];
  }

  private static getCommonFilesToIgnore(): string[] {
    return [".DS_Store", "Thumbs.db", ".gitignore", ".gitattributes"];
  }

  public static getCommonFilesToIgnoreByTechStackItem(
    techStack: TechStack,
  ): string[] {
    let filesToIgnore: string[] = [];

    switch (techStack) {
      case TechStack.NodeJS:
        filesToIgnore = ["package-lock.json"];
        break;
      case TechStack.Python:
        filesToIgnore = ["__pycache__"];
        break;
      case TechStack.Ruby:
        filesToIgnore = ["Gemfile.lock"];
        break;
      case TechStack.Go:
        filesToIgnore = ["go.sum", "go.mod"];
        break;
      case TechStack.Java:
        filesToIgnore = ["pom.xml"];
        break;
      case TechStack.PHP:
        filesToIgnore = ["composer.lock"];
        break;
      case TechStack.CSharp:
        filesToIgnore = ["packages", "bin", "obj"];
        break;
      case TechStack.CPlusPlus:
        filesToIgnore = ["build", "CMakeFiles", "CMakeCache.txt", "Makefile"];
        break;
      case TechStack.Rust:
        filesToIgnore = ["Cargo.lock"];
        break;
      case TechStack.Swift:
        filesToIgnore = ["Podfile.lock"];
        break;
      case TechStack.Kotlin:
        filesToIgnore = [
          "gradle",
          "build",
          "gradlew",
          "gradlew.bat",
          "gradle.properties",
        ];
        break;
      case TechStack.TypeScript:
        filesToIgnore = ["node_modules", "package-lock.json"];
        break;
      case TechStack.JavaScript:
        filesToIgnore = ["node_modules", "package-lock.json"];
        break;
      case TechStack.Shell:
        filesToIgnore = [];
        break;
      case TechStack.React:
        filesToIgnore = ["node_modules", "package-lock.json"];
        break;
      case TechStack.Other:
        filesToIgnore = [];
        break;
      default:
        filesToIgnore = [];
    }

    return filesToIgnore;
  }

  public static getCommonFilesToIgnoreByTechStack(
    techStack: Array<TechStack>,
  ): string[] {
    let filesToIgnore: string[] = [];

    for (const stack of techStack) {
      filesToIgnore = filesToIgnore.concat(
        this.getCommonFilesToIgnoreByTechStackItem(stack),
      );
    }

    return filesToIgnore
      .concat(this.getCommonFilesToIgnore())
      .concat(this.getCommonDirectoriesToIgnore());
  }

  private static getCommonFilesExtentions(): string[] {
    // return markdown, dockerfile, etc.
    return [".md", "dockerfile", ".yml", ".yaml", ".sh", ".gitignore"];
  }

  public static getFileExtentionsByTechStackItem(
    techStack: TechStack,
  ): string[] {
    let fileExtentions: Array<string> = [];

    switch (techStack) {
      case TechStack.NodeJS:
        fileExtentions = [".js", ".ts", ".json", ".mjs"];
        break;
      case TechStack.Python:
        fileExtentions = [".py"];
        break;
      case TechStack.Ruby:
        fileExtentions = [".rb"];
        break;
      case TechStack.Go:
        fileExtentions = [".go"];
        break;
      case TechStack.Java:
        fileExtentions = [".java"];
        break;
      case TechStack.PHP:
        fileExtentions = [".php"];
        break;
      case TechStack.CSharp:
        fileExtentions = [".cs"];
        break;
      case TechStack.CPlusPlus:
        fileExtentions = [".cpp", ".c"];
        break;
      case TechStack.Rust:
        fileExtentions = [".rs"];
        break;
      case TechStack.Swift:
        fileExtentions = [".swift"];
        break;
      case TechStack.Kotlin:
        fileExtentions = [".kt", ".kts"];
        break;
      case TechStack.TypeScript:
        fileExtentions = [".ts", ".tsx"];
        break;
      case TechStack.JavaScript:
        fileExtentions = [".js", ".jsx"];
        break;
      case TechStack.Shell:
        fileExtentions = [".sh"];
        break;
      case TechStack.React:
        fileExtentions = [".js", ".ts", ".jsx", ".tsx"];
        break;
      case TechStack.Other:
        fileExtentions = [];
        break;
      default:
        fileExtentions = [];
    }

    return fileExtentions;
  }

  public static getFileExtentionsByTechStack(
    techStack: Array<TechStack>,
  ): string[] {
    let fileExtentions: Array<string> = [];

    for (let i: number = 0; i < techStack.length; i++) {
      if (!techStack[i]) {
        continue;
      }
      fileExtentions = fileExtentions.concat(
        this.getFileExtentionsByTechStackItem(techStack[i]!),
      );
    }

    // add common files extentions

    return fileExtentions.concat(this.getCommonFilesExtentions());
  }
}
