export default class MeteredPlan {
    private monthlyPriceId: string;
    private unitName: string;
    private pricePerUnit: number;

    public constructor(
        monthlyPriceId: string,
        pricePerUnit: number,
        unitName: string
    ) {
        this.monthlyPriceId = monthlyPriceId;

        this.pricePerUnit = pricePerUnit;
        this.unitName = unitName;
    }

    public getMonthlyPriceId(): string {
        return this.monthlyPriceId;
    }


    public getPricePerUnit(): number {
        return this.pricePerUnit;
    }

    public getUnitName(): string {
        return this.unitName;
    }
}
