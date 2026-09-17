export default class MeteredPlan {
  private priceId: string;
  private unitName: string;
  private pricePerUnitInUSD: number;

  public constructor(data: {
    priceId: string;
    pricePerUnitInUSD: number;
    unitName: string;
  }) {
    this.priceId = data.priceId;
    this.pricePerUnitInUSD = data.pricePerUnitInUSD;
    this.unitName = data.unitName;
  }

  public getPriceId(): string {
    return this.priceId;
  }

  public getPricePerUnit(): number {
    return this.pricePerUnitInUSD;
  }

  public getUnitName(): string {
    return this.unitName;
  }
}
