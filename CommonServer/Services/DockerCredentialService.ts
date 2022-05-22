import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/DockerCredential';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DatabaseService from './DatabaseService';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';
import Protocol from 'Common/Types/API/Protocol';
import Hostname from 'Common/Types/API/Hostname';
import Route from 'Common/Types/API/Route';

export class Service extends DatabaseService<Model> {
    public constructor() {
        super(Model);
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
export default new Service();
