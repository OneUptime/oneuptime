import BadDataException from './Exception/BadDataException';
import PositiveNumber from './PositiveNumber';

export default class Port {
    private _port: PositiveNumber = new PositiveNumber(0);
    public get port(): PositiveNumber {
        return this._port;
    }
    public set port(v: PositiveNumber) {
        this._port = v;
    }

    public constructor(port: number | string) {
        if (typeof port === 'string') {
            try {
                port = Number.parseInt(port, 10);
            } catch (error) {
                throw new BadDataException(`Invalid port: ${port}`);
            }
        }

        if (port >= 0 && port <= 65535) {
            this.port = new PositiveNumber(port);
        } else {
            throw new BadDataException(
                'Port should be in the range from 0 to 65535'
            );
        }
    }

    public toString(): string {
        return this.port.toString();
    }

    public toNumber(): number {
        return this.port.toNumber();
    }
}
