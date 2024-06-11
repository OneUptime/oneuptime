import URL from 'Common/Types/API/URL';
import BadDataException from 'Common/Types/Exception/BadDataException';

export const OneUptimeURL: URL = URL.fromString(
    process.env['ONEUPTIME_URL'] || 'https://oneuptime.com'
);

export const RepositorySecretKey: string =
    process.env['ONEUPTIME_REPOSITORY_SECRET_KEY'] || '';

if (!RepositorySecretKey) {
    throw new BadDataException('Repository Secret Key is required');
}
