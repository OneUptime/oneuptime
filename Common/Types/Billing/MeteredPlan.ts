export default class MeteredPlan {
    private priceId: string;
    private intervalName: string;
    private unitName: string;
    private pricePerUnit: number;


    public constructor(
        priceId: string,
        pricePerUnit: number,
        unitName: string,
        intervalName: string,
       
    ) {
        this.priceId = priceId;
        this.intervalName = intervalName;
        this.pricePerUnit = pricePerUnit;
        this.unitName = unitName;

    }

    public getPriceId(): string {
        return this.priceId;
    }

    public getIntervalName(): string {
        return this.intervalName;
    }

    public getPricePerUnit(): number {
        return this.pricePerUnit;
    }

    public getUnitName(): string {
        return this.unitName;
    }


  

}
