import Protocol from 'Common/Types/API/Protocol';
import ObjectID from 'Common/Types/ObjectID';
import Hostname from 'Common/Types/API/Hostname';
import { JSONValue } from 'Common/Types/JSON';
import URL from 'Common/Types/API/URL';
import GlobalConfigService from './Services/GlobalConfigService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import GlobalConfig from 'Model/Models/GlobalConfig';
import { AccountsRoute, DashboardRoute } from './EnvironmentConfig';

export default class DatabaseConfig {
    public static async getFromGlobalConfig(key: string): Promise<JSONValue> {
        const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneBy({
                query: {
                    _id: ObjectID.getZeroObjectID().toString(),
                },
                props: {
                    isRoot: true,
                },
                select: {
                    [key]: true,
                },
            });

        if (!globalConfig) {
            throw new BadDataException('Global Config not found');
        }

        return globalConfig.getColumnValue(key);
    }

    public static async getHost(): Promise<Hostname> {
        return (
            ((await DatabaseConfig.getFromGlobalConfig('host')) as Hostname) ||
            new Hostname('localhost')
        );
    }

    public static async getHttpProtocol(): Promise<Protocol> {
        return (await DatabaseConfig.getFromGlobalConfig('useHttps'))
            ? Protocol.HTTPS
            : Protocol.HTTP;
    }

    public static async getAccountsUrl(): Promise<URL> {
        const host: Hostname = await DatabaseConfig.getHost();
        return new URL(
            await DatabaseConfig.getHttpProtocol(),
            host,
            AccountsRoute
        );
    }

    public static async getDashboardUrl(): Promise<URL> {
        const host: Hostname = await DatabaseConfig.getHost();
        return new URL(
            await DatabaseConfig.getHttpProtocol(),
            host,
            DashboardRoute
        );
    }
}
