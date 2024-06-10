import Execute from '../Execute';
import CodeRepositoryFile from './CodeRepositoryFile';

export default class CodeRepositoryUtil {
    public static async getGitCommitHashForFile(
        filePath: string
    ): Promise<string> {
        return await Execute.executeCommand(
            `git log -1 --pretty=format:"%H" ${filePath}`
        );
    }

    public static async getFilesInDirectory(directoryPath: string): Promise<{
        files: Array<CodeRepositoryFile>;
        subDirectories: Array<string>;
    }> {
        const files: Array<CodeRepositoryFile> = [];
        const output: string = await Execute.executeCommand(
            `ls ${directoryPath}`
        );

        const fileNames: Array<string> = output.split('\n');

        const subDirectories: Array<string> = [];

        for (const fileName of fileNames) {
            if (fileName === '') {
                continue;
            }

            const isDirectory: boolean = (
                await Execute.executeCommand(
                    `file ${directoryPath}/${fileName}`
                )
            ).includes('directory');

            if (isDirectory) {
                subDirectories.push(`${directoryPath}/${fileName}`);
                continue;
            }

            const filePath: string = `${directoryPath}/${fileName}`;
            const gitCommitHash: string = await this.getGitCommitHashForFile(
                filePath
            );
            const fileExtension: string = fileName.split('.').pop() || '';
            files.push({
                filePath,
                gitCommitHash,
                fileExtension,
                fileName,
            });
        }

        return {
            files,
            subDirectories: subDirectories,
        };
    }

    public static async getFilesInDirectoryRecursive(
        directoryPath: string
    ): Promise<Array<CodeRepositoryFile>> {
        const files: Array<CodeRepositoryFile> = [];

        const { files: filesInDirectory, subDirectories } =
            await this.getFilesInDirectory(directoryPath);
        files.push(...filesInDirectory);

        for (const subDirectory of subDirectories) {
            files.push(
                ...(await this.getFilesInDirectoryRecursive(subDirectory))
            );
        }

        return files;
    }
}
