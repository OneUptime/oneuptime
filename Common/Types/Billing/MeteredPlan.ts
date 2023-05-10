export default class MeteredPlan {
    private monthlyPriceId: string;
    private yearlyPriceId: string;
    private unitName: string;
    private pricePerUnit: number;


    public constructor(
        monthlyPriceId: string,
        yearlyPriceId: string,
        pricePerUnit: number,
        unitName: string,
       
    ) {
        this.monthlyPriceId = monthlyPriceId;
        this.yearlyPriceId = yearlyPriceId;

        this.pricePerUnit = pricePerUnit;
        this.unitName = unitName;

    }

    public getMonthlyPriceId(): string {
        return this.monthlyPriceId;
    }

    public getYearlyPriceId(): string {
        return this.yearlyPriceId;
    }

    public getPricePerUnit(): number {
        return this.pricePerUnit;
    }

    public getUnitName(): string {
        return this.unitName;
    }


  

}
