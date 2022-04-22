import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
    encryptedFields,
} from '../Models/DockerCredential';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DatabaseService from './DatabaseService';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';
import Protocol from 'Common/Types/API/Protocol';
import Hostname from 'Common/Types/API/Hostname';
import Route from 'Common/Types/API/Route';

class Service extends DatabaseService<typeof Model> {
    public constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'Docker Credential',
            publicListProps: {
                populate: [],
                select: [],
            },
            adminListProps: {
                populate: [],
                select: [],
            },
            ownerListProps: {
                populate: [],
                select: [],
            },
            memberListProps: {
                populate: [],
                select: [],
            },
            viewerListProps: {
                populate: [],
                select: [],
            },
            publicItemProps: {
                populate: [],
                select: [],
            },
            adminItemProps: {
                populate: [],
                select: [],
            },
            memberItemProps: {
                populate: [],
                select: [],
            },
            viewerItemProps: {
                populate: [],
                select: [],
            },
            ownerItemProps: {
                populate: [],
                select: [],
            },
            isResourceByProject: false,
            slugifyField: slugifyField,
            encryptedFields: encryptedFields,
        });
    }

    public async validateDockerCredential({
        username,
        password,
    }: {
        username: string;
        password: string;
    }): Promise<boolean> {
        try {
            await API.post(
                new URL(
                    Protocol.HTTPS,
                    new Hostname('hub.docker.com'),
                    new Route('/v2/users/login')
                ),
                { username, password }
            );

            return true;
        } catch (err) {
            // Username or password was incorrect
            throw new BadDataException('Invalid docker credential');
        }
    }
}

export default Service;
