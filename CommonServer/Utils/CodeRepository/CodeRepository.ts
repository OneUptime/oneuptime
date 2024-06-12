import Execute from '../Execute';
import CodeRepositoryFile from './CodeRepositoryFile';
import Dictionary from 'Common/Types/Dictionary';

export default class CodeRepositoryUtil {
    public static async getGitCommitHashForFile(data: {
        repoPath: string;
        filePath: string;
    }): Promise<string> {
        const { repoPath, filePath } = data;

        return await Execute.executeCommand(
            `cd ${repoPath} && git log -1 --pretty=format:"%H" "${filePath}"`
        );
    }

    public static async getFilesInDirectory(data: {
        directoryPath: string;
        repoPath: string;
    }): Promise<{
        files: Dictionary<CodeRepositoryFile>;
        subDirectories: Array<string>;
    }> {
        const { directoryPath, repoPath } = data;

        const totalPath: string = `${repoPath}/${directoryPath}`;

        const files: Dictionary<CodeRepositoryFile> = {};
        const output: string = await Execute.executeCommand(`ls ${totalPath}`);

        const fileNames: Array<string> = output.split('\n');

        const subDirectories: Array<string> = [];

        for (const fileName of fileNames) {
            if (fileName === '') {
                continue;
            }

            const isDirectory: boolean = (
                await Execute.executeCommand(`file "${totalPath}/${fileName}"`)
            ).includes('directory');

            if (isDirectory) {
                subDirectories.push(`${totalPath}/${fileName}`);
                continue;
            }

            const filePath: string = `${totalPath}/${fileName}`;
            const gitCommitHash: string = await this.getGitCommitHashForFile({
                filePath,
                repoPath,
            });
            const fileExtension: string = fileName.split('.').pop() || '';
            files[filePath] = {
                filePath,
                gitCommitHash,
                fileExtension,
                fileName,
            };
        }

        return {
            files,
            subDirectories: subDirectories,
        };
    }

    public static async getFilesInDirectoryRecursive(data: {
        repoPath: string;
        directoryPath: string;
    }): Promise<Dictionary<CodeRepositoryFile>> {
        let files: Dictionary<CodeRepositoryFile> = {};

        const { files: filesInDirectory, subDirectories } =
            await this.getFilesInDirectory({
                directoryPath: data.directoryPath,
                repoPath: data.repoPath,
            });

        files = {
            ...files,
            ...filesInDirectory,
        };

        for (const subDirectory of subDirectories) {
            files = {
                ...files,
                ...(await this.getFilesInDirectoryRecursive({
                    repoPath: data.repoPath,
                    directoryPath: subDirectory,
                })),
            };
        }

        return files;
    }
}
