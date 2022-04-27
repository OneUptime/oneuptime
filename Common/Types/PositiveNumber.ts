import BadDataException from './Exception/BadDataException';

export default class PositiveNumber {
    private _positiveNumber: number = 0;
    public get positiveNumber(): number {
        return this._positiveNumber;
    }
    public set positiveNumber(v: number) {
        this._positiveNumber = v;
    }

    public constructor(positiveNumber: number | string) {
        if (typeof positiveNumber === 'string') {
            try {
                positiveNumber = Number.parseInt(positiveNumber, 10);
            } catch (error) {
                throw new BadDataException(`Invalid number: ${positiveNumber}`);
            }
        }

        if (positiveNumber < 0) {
            throw new BadDataException('positiveNumber cannot be less than 0');
        }

        this.positiveNumber = positiveNumber;
    }

    public toString(): string {
        return this.positiveNumber.toString();
    }

    public toNumber(): number {
        return this.positiveNumber;
    }
}
