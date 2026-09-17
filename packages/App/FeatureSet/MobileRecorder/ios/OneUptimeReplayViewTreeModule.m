#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(OneUptimeReplayViewTree, NSObject)

RCT_EXTERN_METHOD(captureViewTree:(nonnull NSNumber *)rootTag
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getAppMetadata:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isTouchTargetPrivate:(nonnull NSNumber *)targetTag
                  replayRootTag:(nonnull NSNumber *)replayRootTag
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
