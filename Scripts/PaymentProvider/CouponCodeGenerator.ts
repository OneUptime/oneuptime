import BillingService from 'CommonServer/Services/BillingService';
import Sleep from 'Common/Types/Sleep';

const main: Function = async () => {
    for (let i = 0; i < 2000; i++) {
        const code = await BillingService.generateCouponCode({
            name: "Name",
            percentOff: 100,
            durationInMonths: 12,
            maxRedemptions: 1
        });
        console.log(code);
        await Sleep.sleep(50);
    }
};

main();
