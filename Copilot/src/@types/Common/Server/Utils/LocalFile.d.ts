declare module "Common/Server/Utils/LocalFile" {
  export default class LocalFile {
    public static read(path: string): Promise<string>;
    public static readDirectory(path: string): Promise<Array<import("node:fs").Dirent>>;
    public static write(path: string, data: string): Promise<void>;
    public static makeDirectory(path: string): Promise<void>;
    public static deleteFile(path: string): Promise<void>;
    public static deleteDirectory(path: string): Promise<void>;
    public static doesFileExist(path: string): Promise<boolean>;
    public static doesDirectoryExist(path: string): Promise<boolean>;
    public static sanitizeFilePath(path: string): string;
  }
}
