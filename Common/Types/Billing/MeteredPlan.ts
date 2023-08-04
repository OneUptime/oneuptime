export default class MeteredPlan {
    private priceId: string;
    private unitName: string;
    private pricePerUnit: number;

    public constructor(
        priceId: string,
        pricePerUnit: number,
        unitName: string
    ) {
        this.priceId = priceId;
        this.pricePerUnit = pricePerUnit;
        this.unitName = unitName;
    }

    public getPriceId(): string {
        return this.priceId;
    }

    public getPricePerUnit(): number {
        return this.pricePerUnit;
    }

    public getUnitName(): string {
        return this.unitName;
    }
}
