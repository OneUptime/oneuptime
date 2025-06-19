import fs from "fs";
import path from "path";

export class FileGenerator {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  async writeFile(fileName: string, content: string): Promise<void> {
    const fullPath = path.join(this.outputDir, fileName);
    const directory = path.dirname(fullPath);

    // Ensure directory exists
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
  }

  async writeFileInDir(
    directory: string,
    fileName: string,
    content: string,
  ): Promise<void> {
    const dirPath = path.join(this.outputDir, directory);
    const fullPath = path.join(dirPath, fileName);

    // Ensure directory exists
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
  }

  ensureDirectory(dirPath: string): void {
    const fullPath = path.join(this.outputDir, dirPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  readTemplateFile(templatePath: string): string {
    return fs.readFileSync(templatePath, "utf-8");
  }

  replaceTemplateVariables(
    content: string,
    variables: Record<string, string>,
  ): string {
    let result = content;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      result = result.replace(regex, value);
    }
    return result;
  }
}
