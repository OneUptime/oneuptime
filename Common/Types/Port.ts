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

    public constructor(port: number) {
        if (port >= 0 && port <= 65535) {
            this.port = new PositiveNumber(port);
        } else {
            throw new BadDataException(
                'Port should be in the range from 0 to 65535'
            );
        }
    }

    toString(): string {
        return this.port.toString();
    }

    toNumber(): number {
        return this.port.toNumber();
    }
}
