
// mock billing service. 
jest.mock("../../../../Server/Services/BillingService", ()=>{
    return {
      changeQuantity: jest.fn(),
      subscribeToPlan: ()=>{
        return Promise.resolve({ subscriptionId: "sub_123", meteredSubscriptionId: "sub_123", trialEndsAt: new Date() });
      },
      createCustomer: jest.fn(),
    }
  });

  jest.mock("../../../../Server/Services/ProjectService", ()=>{
    return {
      create: jest.fn(),
    }
  });
  