import URL from 'Common/Types/API/URL';

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
