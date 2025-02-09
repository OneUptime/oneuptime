// To run this script:
// export $(grep -v '^#' config.env | xargs) && ts-node ./Scripts/PaymentProvider/CouponCodeGenerator.ts > coupons.csv
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Sleep from "Common/Types/Sleep";
import BillingService from "Common/Server/Services/BillingService";

const main: PromiseVoidFunction = async (): Promise<void> => {
  for (let i: number = 0; i < 2000; i++) {
    const code: string = await BillingService.generateCouponCode({
      name: "Name",
      percentOff: 100,
      durationInMonths: 12,
      maxRedemptions: 1,
    });
    //eslint-disable-next-line no-console
    console.log(code);
    await Sleep.sleep(50);
  }
};

main().catch((err: Error) => {
  //eslint-disable-next-line no-console
  console.error(err);
});
