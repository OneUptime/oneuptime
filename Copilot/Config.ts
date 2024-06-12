import URL from 'Common/Types/API/URL';
import CodeRepositoryType from 'Common/Types/CodeRepository/CodeRepositoryType';
import BadDataException from 'Common/Types/Exception/BadDataException';
import EnumUtil from 'Common/Utils/Enum';

type GetStringFunction = () => string;
type GetURLFunction = () => URL;

export const GetOneUptimeURL: GetURLFunction = () => {
    return URL.fromString(
        process.env['ONEUPTIME_URL'] || 'https://oneuptime.com'
    );
};

export const GetRepositorySecretKey: GetStringFunction = (): string => {
    return process.env['ONEUPTIME_REPOSITORY_SECRET_KEY'] || '';
};

export const GetLocalRepositoryPath: GetStringFunction = (): string => {
    return process.env['ONEUPTIME_LOCAL_REPOSITORY_PATH'] || '/repository';
};

export const GetRepositoryType: GetStringFunction = (): CodeRepositoryType => {
    const repoType: string | undefined =  process.env['REPOSITORY_TYPE'];
    
    if(!repoType) {
        return CodeRepositoryType.GitHub;
    }

    if(EnumUtil.isValidEnumValue(CodeRepositoryType, repoType)) {
        return repoType as CodeRepositoryType;
    }
    // check if the repository type is valid and is from the values in the enum. 

    throw new BadDataException(`Invalid Repository Type ${repoType}. It should be one of ${EnumUtil.getValues(CodeRepositoryType).join(', ')}`);
};


export const GetGitHubToken: GetStringFunction = (): string => {
    const token: string = process.env['GITHUB_TOKEN'] || '';


    if(GetRepositoryType() === CodeRepositoryType.GitHub && !token) {
        throw new BadDataException('GitHub Token is required for GitHub Repository');
    }

    return token;
}
