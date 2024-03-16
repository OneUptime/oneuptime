
import os from 'node:os';

enum OSTypeEnum {
    Windows = 'Windows',
    Linux = 'Linux',
    MacOS = 'MacOS',
    Unknown = 'Unknown',
}

export default class OSType {
    public static getOSType(): OSTypeEnum {
        const platform: string = os.type();
        switch (platform) {
            case 'Windows_NT':
                return OSTypeEnum.Windows;
            case 'Linux':
                return OSTypeEnum.Linux;
            case 'Darwin':
                return OSTypeEnum.MacOS;
            default:
                return OSTypeEnum.Unknown;
        }
    }
}
