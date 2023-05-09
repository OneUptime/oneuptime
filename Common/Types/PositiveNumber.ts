import BadDataException from './Exception/BadDataException';
import Typeof from './Typeof';

export default class PositiveNumber {
    private _positiveNumber: number = 0;
    public get positiveNumber(): number {
        return this._positiveNumber;
    }
    public set positiveNumber(v: number) {
        this._positiveNumber = v;
    }

    public constructor(positiveNumber: number | string) {
        if (typeof positiveNumber === Typeof.String) {
            positiveNumber = Number.parseInt(positiveNumber.toString(), 10);
            if (isNaN(positiveNumber)) {
                throw new BadDataException(`Invalid number: ${positiveNumber}`);
            }
        }

        if ((positiveNumber as number) < 0) {
            throw new BadDataException('positiveNumber cannot be less than 0');
        }

        this.positiveNumber = positiveNumber as number;
    }

    public toString(): string {
        return this.positiveNumber.toString();
    }

    public isZero(): boolean {
        return this.positiveNumber === 0;
    }

    public isOne(): boolean {
        return this.positiveNumber === 1;
    }

    public toNumber(): number {
        return this.positiveNumber;
    }
}
