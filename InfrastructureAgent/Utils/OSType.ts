import OSTypeEnum from 'Common/Types/Infrastrucutre/OSType';
import os from 'node:os';

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
