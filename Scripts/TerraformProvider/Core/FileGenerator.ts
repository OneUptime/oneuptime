import fs from "fs";
import path from "path";

export class FileGenerator {
  private outputDir: string;

  public constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  public async writeFile(fileName: string, content: string): Promise<void> {
    const fullPath: string = path.join(this.outputDir, fileName);
    const directory: string = path.dirname(fullPath);

    // Ensure directory exists
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
  }

  public async writeFileInDir(
    directory: string,
    fileName: string,
    content: string,
  ): Promise<void> {
    const dirPath: string = path.join(this.outputDir, directory);
    const fullPath: string = path.join(dirPath, fileName);

    // Ensure directory exists
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
  }

  public ensureDirectory(dirPath: string): void {
    const fullPath: string = path.join(this.outputDir, dirPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  public readTemplateFile(templatePath: string): string {
    return fs.readFileSync(templatePath, "utf-8");
  }

  public replaceTemplateVariables(
    content: string,
    variables: Record<string, string>,
  ): string {
    let result: string = content;
    for (const [key, value] of Object.entries(variables)) {
      const regex: RegExp = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      result = result.replace(regex, value);
    }
    return result;
  }
}
