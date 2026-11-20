import {
  demangleSwiftSymbol,
  toAppleSymbolDisplayName,
} from "../../../Utils/Telemetry/SwiftDemangle";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * #9922: a symbolicated iOS crash frame's Swift name, as a person reads it.
 *
 * Every expected name below is what the Swift toolchain's own
 * `swift-demangle --simplified` prints for that symbol, never a guess:
 *
 * - SIMPLIFIED_MANGLINGS: lines of swift/test/Demangle/Inputs/
 *   simplified-manglings.txt, as the file has them.
 * - MANGLINGS: symbols from swift/test/Demangle/Inputs/manglings.txt (which
 *   holds the full demangling only), with what swift-demangle 6.3.3
 *   --simplified prints for them. That same build prints all 217 lines of
 *   simplified-manglings.txt exactly as the file has them.
 * - APP_CODE and the rest: symbols swiftc 6.3.3 emitted for app-shaped
 *   Swift (the declaration is noted), with what swift-demangle 6.3.3
 *   --simplified prints for them.
 *
 * Where the real tool prints a name for a construct this port does not
 * read, or prints something that is not one name, null is expected: a
 * frame then shows its raw symbol, and a wrong name is worse than none.
 */

type Case = [string, string];

const SIMPLIFIED_MANGLINGS: Array<Case> = [
  // Merged function: simplified hides "merged".
  ["_$S3abc6testityySiFTm", "testit(_:)"],
  // A private initializer; simplified hides the discriminator.
  ["_$S4main4TestC1xACSi_tc6_PRIV_Llfc", "Test.init(x:)"],
  // Async continuations: simplified hides "await resume partial function".
  ["_$s4main1fSiyYaFTQ0_", "f()"],
  ["_$s4main1fSiyYaFTY0_", "f()"],
];

const MANGLINGS: Array<Case> = [
  // @objc and @nonobjc thunks, in both prefixes.
  ["_$s3foo3barC3bas3zimyAaEC_tFTo", "@objc bar.bas(zim:)"],
  ["_$sSC3fooyS2d_SdtFTO", "@nonobjc foo(_:_:)"],
  ["_$S3foo3barC3bas3zimyAaEC_tFTo", "@objc bar.bas(zim:)"],
  ["_$SSC3fooyS2d_SdtFTO", "@nonobjc foo(_:_:)"],
  // Partial apply of a closure, with an unmangled suffix.
  ["$s4main3fooyySiFyyXEfU_TA.1", "partial apply for closure #1 in foo(_:)"],
  // Generic specialization, with an unmangled suffix.
  ["$s4main8MyStructV3fooyyFAA1XV_Tg5.foo", "specialized MyStruct.foo()"],
  // Word substitutions throughout, in a constrained protocol extension.
  [
    "_$Ss17MutableCollectionP1asAARzs012RandomAccessB0RzsAA11SubSequences013BidirectionalB0PRpzsAdHRQlE06rotatecD015shiftingToStart5Indexs01_A9IndexablePQzAN_tFAKs01_M4BasePQzAQcfU_",
    "closure #1 in MutableCollection<A>.rotateRandomAccess(shiftingToStart:)",
  ],
  // Function signature specialization with constant-propagated functions.
  ["_$S3foo6testityyyyc_yyctF1a1bTf3pfpf_n", "specialized testit(_:_:)"],
  // A static operator in an extension of a nested type.
  [
    "_$Ss10DictionaryV3t17E6Index2V1loiySbAEyxq__G_AGtFZ",
    "static Dictionary.Index2.< infix(_:_:)",
  ],
  // Variadic parameters and labels.
  ["_$S8mangling14varargsVsArray3arr1nySid_SStF", "varargsVsArray(arr:n:)"],
  ["_$S8mangling14varargsVsArray3arr1nySaySiG_SStF", "varargsVsArray(arr:n:)"],
  ["_$S8mangling14varargsVsArray3arr1nySaySiGd_SStF", "varargsVsArray(arr:n:)"],
  ["_$S8mangling14varargsVsArray3arrySid_tF", "varargsVsArray(arr:)"],
  ["_$S8mangling14varargsVsArray3arrySaySiGd_tF", "varargsVsArray(arr:)"],
  // A constrained extension of an imported generic type.
  [
    "_$S10Foundation11MeasurementV12SimulatorKitSo9UnitAngleCRszlE11OrientationO2eeoiySbAcDEAGOyAF_G_AKtFZ",
    "static Measurement<A>.Orientation.== infix(_:_:)",
  ],
  // One unlabeled parameter of type ().
  ["_$S4test6testitySiyt_tF", "testit(_:)"],
  // A generic initializer of a type nested in a protocol.
  [
    "$s4Test5ProtoP8IteratorV10collectionAEy_qd__Gqd___tcfc",
    "Proto.Iterator.init(collection:)",
  ],
  // An opaque result type in a parameter.
  ["$s4test3fooV4blahyAA1SV1fQryFQOy_Qo_AHF", "foo.blah(_:)"],
  // Inlined generic function, resilience-domain specialization.
  ["$s1A1gyyxlFx_qd__t_Ti5", "specialized g<A>(_:)"],
  ["$s4Test6testityyxlFAA8MystructV_TB5", "specialized testit<A>(_:)"],
  // A generic initializer in a constrained protocol extension.
  [
    "$sSUss17FixedWidthIntegerRzrlEyxqd__cSzRd__lufCSu_SiTg5",
    "specialized UnsignedInteger<>.init<A>(_:)",
  ],
  // Specialization with dropped arguments.
  ["$s4test7genFuncyyx_q_tr0_lFSi_SbTtt1g5", "specialized genFunc<A, B>(_:_:)"],
  // A class's allocating initializer.
  ["$s4test3StrCACycfC", "Str.__allocating_init()"],
  // A serialized key path getter.
  [
    "$s18keypaths_inlinable13KeypathStructV8computedSSvpACTKq",
    "key path getter for KeypathStruct.computed : KeypathStruct, serialized",
  ],
  // Property wrappers.
  [
    "$s17property_wrappers10WithTuplesV9fractionsSd_S2dtvpfP",
    "property wrapper backing initializer of WithTuples.fractions",
  ],
  [
    "$s16property_wrapper8MyStructV1xSivpfF",
    "property wrapped field init accessor of MyStruct.x",
  ],
  [
    "$s4main6myFuncyyF1xL_SivpfF",
    "property wrapped field init accessor of x #1 in myFunc()",
  ],
  // Partial apply of a @nonobjc thunk of an imported class's method.
  [
    "$sSo17OS_dispatch_queueC4sync7executeyyyXE_tFTOTA",
    "partial apply for @nonobjc OS_dispatch_queue.sync(execute:)",
  ],
  // Async, async throws.
  ["$s7example1fyyYaF", "f()"],
  ["$s7example1fyyYaKF", "f()"],
  // Imported C++ template instantiations.
  [
    "$s4main20receiveInstantiationyySo34__CxxTemplateInst12MagicWrapperIiEVzF",
    "receiveInstantiation(_:)",
  ],
  [
    "$s4main19returnInstantiationSo34__CxxTemplateInst12MagicWrapperIiEVyF",
    "returnInstantiation()",
  ],
  // A @Sendable closure parameter.
  ["$s5async1hyyS2iYbXEF", "h(_:)"],
  // Async continuations of an actor's method.
  [
    "$s5Actor02MyA0C17testAsyncFunctionyyYaKFTY0_",
    "MyActor.testAsyncFunction()",
  ],
  [
    "$s5Actor02MyA0C17testAsyncFunctionyyYaKFTQ1_",
    "MyActor.testAsyncFunction()",
  ],
  // A @MainActor closure parameter.
  ["$s4test10returnsOptyxycSgxyScMYccSglF", "returnsOpt<A>(_:)"],
  // An isolated parameter.
  ["$s1t10globalFuncyyAA7MyActorCYiF", "globalFunc(_:)"],
  // A key path specialization of nested implicit closures.
  [
    "$s1t1fyyFSiAA3StrVcs7KeyPathCyADSiGcfu_SiADcfu0_33_556644b740b1b333fecb81e55a7cce98ADSiTf3npk_n",
    "specialized implicit closure #2 in implicit closure #1 in f()",
  ],
  // An existential parameter.
  ["$s4test3FooVAAyyAA1P_pF", "Foo.test(_:)"],
  // Typed throws, @isolated(any), sending.
  ["$s12typed_throws15rethrowConcreteyyAA7MyErrorOYKF", "rethrowConcrete()"],
  ["$s3red3use2fnySiyYAXE_tF", "use(fn:)"],
  ["$s4testAAyAA5KlassC_ACtACnYTF", "test(_:)"],
  ["$s5test24testyyAA5KlassCnYuF", "test(_:)"],
  ["$s4testA2A5KlassCyYTF", "test()"],
  [
    "$s4null19transferAsyncResultAA16NonSendableKlassCyYaYTF",
    "transferAsyncResult()",
  ],
  // Requirements on generic parameters and their associated types.
  ["$s5assoc6ncIteryyxAA1PRzlF", "ncIter<A>(_:)"],
  ["$s5assoc12bothCopyableyyxAA1PRzs0C08IteratorRpzlF", "bothCopyable<A>(_:)"],
  // A static generic method taking a global-actor isolated closure.
  ["$s3red7MyActorC3runyxxyYaKACYcYTXEYaKlFZ", "static MyActor.run<A>(_:)"],
  ["$s3red7MyActorC3runyxxyYaKYCXEYaKlFZ", "static MyActor.run<A>(_:)"],
];

// The issue's own example and the shapes app code produces most.
const APP_CODE: Array<Case> = [
  // final class CartViewController { func checkout() }
  [
    "$s5MyApp18CartViewControllerC8checkoutyyF",
    "CartViewController.checkout()",
  ],
  // struct Cart { mutating func add(item: Item, quantity: Int) }
  [
    "$s5MyApp4CartV3add4item8quantityyAA4ItemV_SitF",
    "Cart.add(item:quantity:)",
  ],
  // mutating func add(_ item: Item)
  ["$s5MyApp4CartV3addyyAA4ItemVF", "Cart.add(_:)"],
  // mutating func remove(_ item: Item, all: Bool)
  ["$s5MyApp4CartV6remove_3allyAA4ItemV_SbtF", "Cart.remove(_:all:)"],
  // func update(_ a: Int, with b: String, and c: inout [Int])
  [
    "$s5MyApp18CartViewControllerC6update_4with3andySi_SSSaySiGztF",
    "CartViewController.update(_:with:and:)",
  ],
  // func cart(_ cart: Cart, didAdd item: Item, quantity: Int)
  [
    "$s5MyApp18CartViewControllerC4cart_6didAdd8quantityyAA0C0V_AA4ItemVSitF",
    "CartViewController.cart(_:didAdd:quantity:)",
  ],
  // func topLevel(_ x: Int, _ y: Int) -> Int
  ["$s5MyApp8topLevelyS2i_SitF", "topLevel(_:_:)"],
  // func variadic(_ values: Int..., label: String) -> Int
  ["$s5MyApp8variadic_5labelS2id_SStF", "variadic(_:label:)"],
  // func tuples(_ t: (Int, String), point: (x: Double, y: Double)) -> Int
  ["$s5MyApp6tuples_5pointS2i_SSt_Sd1x_Sd1yttF", "tuples(_:point:)"],
  // func withCallbacks(success: @escaping (Int) -> Void, failure: ...)
  [
    "$s5MyApp13withCallbacks7success7failureyySic_ys5Error_pctF",
    "withCallbacks(success:failure:)",
  ],
  // func existentials(_ a: Any, _ b: AnyObject, _ c: Shape & ..., _ d: Error?)
  [
    "$s5MyApp12existentialsyyyp_yXlAA5Shape_s23CustomStringConvertibleps5Error_pSgtF",
    "existentials(_:_:_:_:)",
  ],
  // func meta(_ type: Cart.Type, _ any: Any.Type, _ proto: Shape.Type)
  ["$s5MyApp4metayyAA4CartVm_ypXpAA5Shape_pXptF", "meta(_:_:_:)"],
  // func optionals(_ a: Int?, _ b: [String]?, _ c: [Int: [String]]) -> Set<Int>
  ["$s5MyApp9optionalsyShySiGSiSg_SaySSGSgSDySiAEGtF", "optionals(_:_:_:)"],
  // func sendable(_ f: @Sendable @escaping () -> Void)
  ["$s5MyApp8sendableyyyyYbcF", "sendable(_:)"],
  // func mainActor(_ f: @MainActor @escaping () -> Void)
  ["$s5MyApp9mainActoryyyyScMYccF", "mainActor(_:)"],
  // func asyncClosure(_ f: @escaping () async throws -> Int)
  ["$s5MyApp12asyncClosureyySiyYaKcF", "asyncClosure(_:)"],
  // func autoclosure(_ f: @autoclosure () -> Bool) -> Bool
  ["$s5MyApp11autoclosureyS2byXKF", "autoclosure(_:)"],
  // func typedThrows() throws(CheckoutError) -> Int
  ["$s5MyApp11typedThrowsSiyAA13CheckoutErrorOYKF", "typedThrows()"],
  // func inoutAndShared(_ a: inout Int, _ b: __shared String, _ c: __owned [Int])
  ["$s5MyApp14inoutAndSharedyySiz_SShSaySiGntF", "inoutAndShared(_:_:_:)"],
  // func load() throws, func fetch(id: Int) async throws -> Int
  ["$s5MyApp18CartViewControllerC4loadyyKF", "CartViewController.load()"],
  [
    "$s5MyApp18CartViewControllerC5fetch2idS2i_tYaKF",
    "CartViewController.fetch(id:)",
  ],
  // Async continuations: one name for every part of the function.
  [
    "$s5MyApp18CartViewControllerC5fetch2idS2i_tYaKFTQ0_",
    "CartViewController.fetch(id:)",
  ],
  [
    "$s5MyApp18CartViewControllerC7refreshyyYaFTY2_",
    "CartViewController.refresh()",
  ],
  // actor Bank { func deposit(_ amount: Int) async }
  ["$s5MyApp4BankC7deposityySiYaFTY0_", "Bank.deposit(_:)"],
  // @MainActor final class ViewModel { func refresh() async }
  ["$s5MyApp9ViewModelC7refreshyyYaF", "ViewModel.refresh()"],
  // static func make(), class func create(), class var kind
  [
    "$s5MyApp18CartViewControllerC4makeACyFZ",
    "static CartViewController.make()",
  ],
  [
    "$s5MyApp18CartViewControllerC6createACyFZ",
    "static CartViewController.create()",
  ],
  [
    "$s5MyApp18CartViewControllerC4kindSSvgZ",
    "static CartViewController.kind.getter",
  ],
  // class func make(named:) -> Self
  ["$s5MyApp6AnimalC4make5namedACXDSS_tFZ", "static Animal.make(named:)"],
  // Operators: static ==, infix <~>, postfix ++.
  ["$s5MyApp4CartV2eeoiySbAC_ACtFZ", "static Cart.== infix(_:_:)"],
  ["$s5MyApp3ltgoiyS2i_SitF", "<~> infix(_:_:)"],
  ["$s5MyApp2ppoPyySizF", "++ postfix(_:)"],
  [
    "$s5MyApp4ItemV23__derived_struct_equalsySbAC_ACtFZ",
    "static Item.__derived_struct_equals(_:_:)",
  ],
  // Initializers.
  ["$s5MyApp4CartVACycfC", "Cart.init()"],
  [
    "$s5MyApp18CartViewControllerCACycfC",
    "CartViewController.__allocating_init()",
  ],
  ["$s5MyApp18CartViewControllerCACycfc", "CartViewController.init()"],
  [
    "$s5MyApp18CartViewControllerC4nameACSgSS_tcfC",
    "CartViewController.__allocating_init(name:)",
  ],
  ["$s5MyApp4ItemV4name5priceACSS_SdtcfC", "Item.init(name:price:)"],
  ["$s5MyApp5OuterV5InnerV1t1uAEyx_qd__Gx_qd__tcfC", "Outer.Inner.init(t:u:)"],
  ["$s5MyApp9DirectionO8rawValueACSgSS_tcfC", "Direction.init(rawValue:)"],
  ["$s5MyApp7ProfileV4fromACs7Decoder_p_tKcfC", "Profile.init(from:)"],
  // Deinitializers: a class's three, a ~Copyable struct's one.
  ["$s5MyApp18CartViewControllerCfd", "CartViewController.deinit"],
  [
    "$s5MyApp18CartViewControllerCfD",
    "CartViewController.__deallocating_deinit",
  ],
  ["$s5MyApp18CartViewControllerCfE", "CartViewController.__ivar_destroyer"],
  ["$s5MyApp6UniqueVfD", "Unique.deinit"],
  // Properties and their accessors.
  [
    "$s5MyApp18CartViewControllerC4cartAA0C0Vvg",
    "CartViewController.cart.getter",
  ],
  [
    "$s5MyApp18CartViewControllerC4cartAA0C0Vvs",
    "CartViewController.cart.setter",
  ],
  [
    "$s5MyApp18CartViewControllerC4cartAA0C0VvM",
    "CartViewController.cart.modify",
  ],
  // The modify coroutine's resume part: the unmangled suffix is not shown.
  [
    "$s5MyApp18CartViewControllerC4cartAA0C0VvM.resume.0",
    "CartViewController.cart.modify",
  ],
  [
    "$s5MyApp18CartViewControllerC5totalSivw",
    "CartViewController.total.willset",
  ],
  [
    "$s5MyApp18CartViewControllerC5totalSivW",
    "CartViewController.total.didset",
  ],
  [
    "$s5MyApp18CartViewControllerC5titleSSvg",
    "CartViewController.title.getter",
  ],
  [
    "$s5MyApp18CartViewControllerC8delegateAA0C8Delegate_pSgvg",
    "CartViewController.delegate.getter",
  ],
  ["$s5MyApp4CartV6sharedACvgZ", "static Cart.shared.getter"],
  ["$s5MyApp4CartV6sharedACvMZ", "static Cart.shared.modify"],
  ["$s5MyApp4CartV6sharedACvau", "Cart.shared.unsafeMutableAddressor"],
  ["$s5MyApp9Settings2O5themeSSvWZ", "static Settings2.theme.didset"],
  ["$s5MyApp13globalCounterSivau", "globalCounter.unsafeMutableAddressor"],
  ["$s5MyApp12PaymentStateO6isPaidSbvg", "PaymentState.isPaid.getter"],
  ["$s5MyApp3BoxC11descriptionSSvg", "Box.description.getter"],
  ["$s5MyApp11ContentViewV4bodyQrvg", "ContentView.body.getter"],
  // A property wrapper's private backing storage.
  [
    "$s5MyApp8SettingsV7_volume33_F95563869034D81C4E169CAB9B06CBBFLLAA7ClampedVvg",
    "Settings._volume.getter",
  ],
  // Subscripts.
  [
    "$s5MyApp18CartViewControllerCyAA4ItemVSgSicig",
    "CartViewController.subscript.getter",
  ],
  ["$s5MyApp4CartVyAA4ItemVSicis", "Cart.subscript.setter"],
  ["$s5MyApp6MatrixVySdSi_SitciM", "Matrix.subscript.modify"],
  ["$s5MyApp5StackVyS2icigZ", "static Stack.subscript.getter"],
  // Closures.
  [
    "$s5MyApp18CartViewControllerC8checkoutyyFSSAA4ItemVXEfU_",
    "closure #1 in CartViewController.checkout()",
  ],
  [
    "$s5MyApp18CartViewControllerC8checkoutyyFSbSS_SStXEfU0_",
    "closure #2 in CartViewController.checkout()",
  ],
  [
    "$s5MyApp18CartViewControllerC8checkoutyyFyycfU2_",
    "closure #4 in CartViewController.checkout()",
  ],
  ["$s5MyApp4CartV5totalSdyFS2d_AA4ItemVtXEfU_", "closure #1 in Cart.total()"],
  [
    "$s5MyApp4CartV3add4item8quantityyAA4ItemV_SitFSiyXEfu_",
    "implicit closure #1 in Cart.add(item:quantity:)",
  ],
  [
    "$s5MyApp18CartViewControllerC5titleSSvgSSyXEfU_",
    "closure #1 in CartViewController.title.getter",
  ],
  [
    "$s5MyApp18CartViewControllerC6onDoneyycvpfiyycfU_",
    "closure #1 in variable initialization expression of CartViewController.onDone",
  ],
  ["$s5MyApp6LoaderCfdyycfU_", "closure #1 in Loader.deinit"],
  ["$s5MyApp6LoaderC4loadyyFyyYaKcfU_TY1_", "closure #1 in Loader.load()"],
  [
    "$s5MyApp6LoaderC14nestedClosuresSiyFS2icfU_S2icfU_",
    "closure #1 in closure #1 in Loader.nestedClosures()",
  ],
  // A SwiftUI-shaped body: a closure whose type holds opaque result types.
  [
    "$s5MyApp11ContentViewV4bodyQrvgAA05TupleD0VyAA0D0PAAE7paddingyQrSdFQOyAA4TextV_Qo__AhAE5onTapyQryycFQOyAK_Qo_tGyXEfU_yycfU_",
    "closure #1 in closure #1 in ContentView.body.getter",
  ],
  // Partial applies.
  [
    "$s5MyApp18CartViewControllerC8checkoutyyFyycfU1_TA",
    "partial apply for closure #3 in CartViewController.checkout()",
  ],
  [
    "$s5MyApp4CartV6remove_3allyAA4ItemV_SbtFSbAGXEfU_TA",
    "partial apply for closure #1 in Cart.remove(_:all:)",
  ],
  [
    "$s5MyApp6LoaderC4loadyyFyyYaKcfU_TATQ0_",
    "partial apply for closure #1 in Loader.load()",
  ],
  [
    "$s5MyApp6LoaderC4loadyyFyyYaKcfU_TA.12",
    "partial apply for closure #1 in Loader.load()",
  ],
  // Local functions and types.
  [
    "$s5MyApp18CartViewControllerC6nestedSiyF6helperL_1xS2i_tF",
    "helper #1 (x:) in CartViewController.nested()",
  ],
  [
    "$s5MyApp18CartViewControllerC6nestedSiyF5LocalL_V3runSiyF",
    "run() in Local #1 in CartViewController.nested()",
  ],
  [
    "$s5MyApp18CartViewControllerC6nestedSiyF5LocalL_VAFycfC",
    "init() in Local #1 in CartViewController.nested()",
  ],
  [
    "$s5MyApp18CartViewControllerC6nestedSiyF8LocalBoxL_C5valueSivg",
    "value.getter in LocalBox #1 in CartViewController.nested()",
  ],
  [
    "$s5MyApp18CartViewControllerC6nestedSiyF8LocalBoxL_CfD",
    "__deallocating_deinit in LocalBox #1 in CartViewController.nested()",
  ],
  [
    "$s5MyApp6LoaderC14nestedClosuresSiyFS2icfU_S2icfU_5localL_yS2iF",
    "local #1 (_:) in closure #1 in closure #1 in Loader.nestedClosures()",
  ],
  [
    "$s5MyApp6Store2C4test5valueSiAA10Published2VySiG_tF6$valueL_AHvg",
    "getter of $value #1 in Store2.test(value:)",
  ],
  // private and fileprivate: the discriminator is not shown.
  [
    "$s5MyApp18CartViewControllerC6secret33_F95563869034D81C4E169CAB9B06CBBFLLSiyF",
    "CartViewController.secret()",
  ],
  [
    "$s5MyApp18CartViewControllerC11filePrivate33_F95563869034D81C4E169CAB9B06CBBFLLSiyF",
    "CartViewController.filePrivate()",
  ],
  // Generic functions: the signature without its where clause.
  [
    "$s5MyApp18CartViewControllerC5applyyxxlF",
    "CartViewController.apply<A>(_:)",
  ],
  [
    "$s5MyApp18CartViewControllerC4find_2inSiSgx_SayxGtSQRzlF",
    "CartViewController.find<A>(_:in:)",
  ],
  [
    "$s5MyApp18CartViewControllerC4pairyx_q_tx_q_tSHRzr0_lF",
    "CartViewController.pair<A, B>(_:_:)",
  ],
  ["$s5MyApp3BoxC3mapyACyqd__Gqd__xXElF", "Box.map<A>(_:)"],
  ["$s5MyApp7genericy7ElementQzSgxSlRzSQADRQlF", "generic<A>(_:)"],
  ["$s5MyApp7useSelfyxxRlzClF", "useSelf<A>(_:)"],
  [
    "$s5MyApp11ViewBuilderO10buildBlockyAA05TupleC0Vyx_q_tGx_q_tAA0C0RzAaHR_r0_lFZ",
    "static ViewBuilder.buildBlock<A, B>(_:_:)",
  ],
  [
    "$ss13withTaskGroup2of9returning9isolation4bodyq_xm_q_mScA_pSgYiq_ScGyxGzYaXEtYas8SendableRzr0_lF",
    "withTaskGroup<A, B>(of:returning:isolation:body:)",
  ],
  // Extensions: hidden, but a constrained one's generic signature shows.
  ["$s5MyApp3BoxCAASQRzlE7isEqual2toSbx_tF", "Box<A>.isEqual(to:)"],
  ["$sSa5MyAppSiRszlE3sumSiyF", "Array<A>.sum()"],
  [
    "$sSa5MyAppSiRszlE3sumSiyFS2i_Sitcfu_",
    "implicit closure #1 in Array<A>.sum()",
  ],
  ["$sSD5MyAppSSRszrlE5value3forq_SgSS_tF", "Dictionary<>.value(for:)"],
  ["$sSq5MyAppSlRzlE12isNilOrEmptySbvg", "Optional<A>.isNilOrEmpty.getter"],
  ["$sSi5MyAppE5timesyyyyXEF", "Int.times(_:)"],
  ["$s5MyApp4ViewPAAE7paddingyQrSdF", "View.padding(_:)"],
  [
    "$s5MyApp10RepositoryPAAE10fetchFirst5ModelQzSgyYaKFTY1_",
    "Repository.fetchFirst()",
  ],
  // Specializations: "specialized" once, whatever the kind.
  ["$sSa6appendyyxnFSi_Tg5", "specialized Array.append(_:)"],
  ["$sSa5countSivgSS_Tg5", "specialized Array.count.getter"],
  ["$sSa6remove2atxSi_tFSnySiG_Tgq5", "specialized Array.remove(at:)"],
  [
    "$s5MyApp18CartViewControllerC4cart5ownerAcA0C0V_AA04BasedE0CtcfcTf4ngn_n",
    "specialized CartViewController.init(cart:owner:)",
  ],
  ["$s5MyApp7useSelfyxxRlzClFTf4n_g", "specialized useSelf<A>(_:)"],
  [
    "$sSTsE6sorted2bySay7ElementQzGSbAD_ADtKXE_tKFSaySSG_Tg555$s5MyApp18CartViewControllerC8checkoutyyFSbSS_SStXEfU0_Tf1cn_n",
    "specialized Sequence.sorted(by:)",
  ],
  [
    "$sSr15_stableSortImpl2byySbx_xtKXE_tKFySryxGz_SiztKXEfU_SS_Tg555$s5MyApp18CartViewControllerC8checkoutyyFSbSS_SStXEfU0_Tf1nnncn_n",
    "specialized closure #1 in UnsafeMutableBufferPointer._stableSortImpl(by:)",
  ],
  [
    "$sSasSQRzlE2eeoiySbSayxG_ABtFZ5MyApp4ItemV_Tt1g5",
    "specialized static Array<A>.== infix(_:_:)",
  ],
  [
    "$sSD17dictionaryLiteralSDyxq_Gx_q_td_tcfCSS_SiTt0g5Tf4g_n",
    "specialized Dictionary.init(dictionaryLiteral:)",
  ],
  [
    "$sSa034_makeUniqueAndReserveCapacityIfNotB0yyFyXl_Ts5",
    "specialized Array._makeUniqueAndReserveCapacityIfNotUnique()",
  ],
  [
    "$s5MyApp7ProfileV2eeoiySbAC_ACtFZTf4nnd_n",
    "specialized static Profile.== infix(_:_:)",
  ],
  // Merged functions: "merged" is not shown.
  [
    "$s5MyApp5OuterV5innerAC5InnerVyx_SiGSgvpfiTm",
    "variable initialization expression of Outer.inner",
  ],
  ["$s5MyApp4ItemVwCPTm", "initializeBufferWithCopyOfBuffer for Item"],
  // Protocol witnesses: the conforming type only.
  [
    "$s5MyApp18CartViewControllerCAA0C8DelegateA2aDP13cartDidChangeyyAA0C0VFTW",
    "protocol witness for CartDelegate.cartDidChange(_:) in conformance CartViewController",
  ],
  [
    "$s5MyApp4ItemVSQAASQ2eeoiySbx_xtFZTW",
    "protocol witness for static Equatable.== infix(_:_:) in conformance Item",
  ],
  [
    "$s5MyApp4ItemVSHAASH4hash4intoys6HasherVz_tFTW",
    "protocol witness for Hashable.hash(into:) in conformance Item",
  ],
  [
    "$s5MyApp3BoxCyxGs23CustomStringConvertibleAAsAEP11descriptionSSvgTW",
    "protocol witness for CustomStringConvertible.description.getter in conformance Box<A>",
  ],
  [
    "$s5MyApp4BankCScAAAScA15unownedExecutorScevgTW",
    "protocol witness for Actor.unownedExecutor.getter in conformance Bank",
  ],
  [
    "$s5MyApp11ContentViewVAA0D0A2aDP4body4BodyQzvgTW",
    "protocol witness for View.body.getter in conformance ContentView",
  ],
  [
    "$s5MyApp17ProfileRepositoryCAA0D0A2aDP8fetchAllSay5ModelQzGyYaKFTWTQ0_",
    "protocol witness for Repository.fetchAll() in conformance ProfileRepository",
  ],
  // Dispatch thunks (library evolution).
  ["$sSQ2eeoiySbx_xtFZTj", "dispatch thunk of static Equatable.== infix(_:_:)"],
  ["$sSl5countSivgTj", "dispatch thunk of Collection.count.getter"],
  ["$s5MyApp6AnimalC5speakSSyFTj", "dispatch thunk of Animal.speak()"],
  ["$s5MyApp7CounterC5valueSivMTj", "dispatch thunk of Counter.value.modify"],
  // Default arguments, initial values, property wrappers.
  [
    "$s5MyApp18CartViewControllerC3log_9separatoryypd_SStFfA0_",
    "default argument 1 of CartViewController.log(_:separator:)",
  ],
  [
    "$s5MyApp8defaults1a1b1cS2i_SSSaySiGtFfA_",
    "default argument 0 of defaults(a:b:c:)",
  ],
  [
    "$s5MyApp18CartViewControllerC4cartAA0C0Vvpfi",
    "variable initialization expression of CartViewController.cart",
  ],
  [
    "$s5MyApp8SettingsV6volumeSivpfP",
    "property wrapper backing initializer of Settings.volume",
  ],
  [
    "$s5MyApp6Store2C4test5valueSiAA10Published2VySiG_tFAEL_SivpfW",
    "property wrapper init from projected value of value #1 in Store2.test(value:)",
  ],
  // Global and static initialization.
  ["$s5MyApp4CartV6shared_WZ", "one-time initialization function for shared"],
  [
    "$s5MyApp10globalName_WZ",
    "one-time initialization function for globalName",
  ],
  // Metadata functions.
  [
    "$s5MyApp18CartViewControllerCMa",
    "type metadata accessor for CartViewController",
  ],
  [
    "$s5MyApp18CartViewControllerC6nestedSiyF5LocalL_VMa",
    "type metadata accessor for Local #1 in CartViewController.nested()",
  ],
  ["$sScMMa", "type metadata accessor for MainActor"],
  ["$s5MyApp3BoxCMr", "type metadata completion function for Box"],
  ["$s5MyApp5OuterVMi", "type metadata instantiation function for Outer"],
  ["$s5MyApp6AnimalCMu", "method lookup function for Animal"],
  // Value witnesses.
  ["$s5MyApp4CartVwxx", "destroy for Cart"],
  ["$s5MyApp12PaymentStateOwcp", "initializeWithCopy for PaymentState"],
  ["$s5MyApp12PaymentStateOwug", "getEnumTag for PaymentState"],
  ["$s5MyApp5OuterV5InnerVwtk", "initializeWithTake for Outer.Inner"],
  // Outlined value operations, with Optional, Array and Dictionary sugar.
  ["$s5MyApp12PaymentStateOWOy", "outlined copy of PaymentState"],
  ["$s5MyApp12PaymentStateOWOe", "outlined consume of PaymentState"],
  ["$s5MyApp12CartDelegate_pSgWOh", "outlined destroy of CartDelegate?"],
  ["$s5MyApp12CartDelegate_pSgXwWOh", "outlined destroy of weak CartDelegate?"],
  ["$sSay5MyApp4ItemVGWOh", "outlined destroy of [Item]"],
  ["$sSaySaySiGGWOh", "outlined destroy of [[Int]]"],
  ["$sSDySSSays5UInt8VGGWOh", "outlined destroy of [String : [UInt8]]"],
  ["$sSaySSGSg_ABtWOh", "outlined destroy of ([String]?, [String]?)"],
  ["$sSS_yptWOcTm", "outlined init with copy of (String, Any)"],
  [
    "$s5MyApp5OuterV5InnerVyx_SiGSglWOb",
    "outlined init with take of Outer<A>.Inner<Int>?",
  ],
  ["$s5MyApp5StackVySiGWOh", "outlined destroy of Stack<Int>"],
  ["$sxSgSlRzlWOh", "outlined destroy of A?"],
  // Witness table accessors.
  [
    "$sSay5MyApp4ItemVGSayxGSTsWl",
    "lazy protocol witness table accessor for type [Item] and conformance [A]",
  ],
  [
    "$s5MyApp4ItemVACSQAAWl",
    "lazy protocol witness table accessor for type Item and conformance Item",
  ],
  [
    "$s5MyApp9DirectionOSHAASQWb",
    "base witness table accessor for Equatable in Direction",
  ],
  // Key path accessors.
  ["$s5MyApp4BankC7balanceSivpACTK", "key path getter for Bank.balance : Bank"],
  [
    "$s5MyApp3BoxC5valuexvplACyxGTk",
    "key path setter for Box.value : <A>Box<A>",
  ],
];

/*
 * Identifiers that reuse earlier words ("0C0V" is Cart, "04BasedE0C" is
 * BaseViewController), and substitutions with repeat counts ("A2aD",
 * "S2i") and two-letter runs ("AcA").
 */
const SUBSTITUTIONS: Array<Case> = [
  [
    "$s5MyApp18CartViewControllerC4cart5ownerAcA0C0V_AA04BasedE0CtcfC",
    "CartViewController.__allocating_init(cart:owner:)",
  ],
  [
    "$s5MyApp18CartViewControllerCAA0C8DelegateA2aDP4cart_6didAdd8quantityyAA0C0V_AA4ItemVSitFTW",
    "protocol witness for CartDelegate.cart(_:didAdd:quantity:) in conformance CartViewController",
  ],
  ["$s5MyApp4CartV5totalSdyFS2d_AA4ItemVtXEfU_", "closure #1 in Cart.total()"],
  [
    "$sSS21_builtinStringLiteral17utf8CodeUnitCount7isASCIISSBp_BwBi1_tcfC",
    "String.init(_builtinStringLiteral:utf8CodeUnitCount:isASCII:)",
  ],
  [
    "$ss27_stringCompareWithSmolCheck__9expectingSbs11_StringGutsV_ADs01_G16ComparisonResultOtF",
    "_stringCompareWithSmolCheck(_:_:expecting:)",
  ],
  [
    "$ss22_ContiguousArrayBufferV20_consumeAndCreateNew14bufferIsUnique15minimumCapacity13growForAppendAByxGSb_SiSbtF5MyApp4ItemV_Tg5",
    "specialized _ContiguousArrayBuffer._consumeAndCreateNew(bufferIsUnique:minimumCapacity:growForAppend:)",
  ],
  [
    "$sSksSx5IndexRpzSnyABG7IndicesRtzSiAA_6StrideRTzrlE7indicesACvg",
    "RandomAccessCollection<>.indices.getter",
  ],
];

/*
 * Each with what the real tool prints for it, and why this reads null
 * instead.
 */
const NOT_READ: Array<[string, string]> = [
  // Swift 4 and older manglings (simplified-manglings.txt: "_()").
  ["_T04main1_yyF", "Swift 4"],
  ["_T03abc6testitySiFTm", "Swift 4"],
  ["_TFC3foo3bar3basfT3zimCS_3zim_T_", "Swift 3"],
  ["_TtSi", "Swift 3 type"],
  // Punycode: "√ prefix(_:)" and a raw identifier, "`foo space`()".
  ["$s5MyApp003BJgopyS2dF", "punycode"],
  ["_$s15raw_identifiers0020foospace_liaADEDGcjayyF", "punycode"],
  // Reabstraction thunks (simplified-manglings.txt: "thunk for ...").
  ["_$sBAIgHgIL_BAIegHgIL_TR", "reabstraction thunk"],
  ["$sSiIgd_SiIegr_TR", "reabstraction thunk"],
  ["$sSiIgd_SiIegr_TRTA", "partial apply of a reabstraction thunk"],
  ["$sSiIegy_SgWOh", "an outlined destroy of a SIL function type"],
  // Data, not code: metadata, descriptors, witness tables.
  ["$s5MyApp4CartVN", "type metadata"],
  ["$s5MyApp4CartVMn", "nominal type descriptor"],
  ["$s5MyApp18CartViewControllerC11viewDidLoadyyFTq", "method descriptor"],
  ["$s5MyApp4CartVWV", "value witness table"],
  ["$s5MyApp6SquareVAA5ShapeAAWP", "protocol witness table"],
  ["$s5MyApp4CartV6shared_Wz", "one-time initialization token"],
  [
    "$s5MyApp18CartViewControllerC5fetch2idS2i_tYaKFTu",
    "async function pointer",
  ],
  ["$s5MyApp4ItemVSHAAMc", "protocol conformance descriptor"],
  ["$s5MyApp7callAllSiyFTv_", "outlined variable"],
  // A type is not a symbol of code.
  ["$s5MyApp12CartDelegateP", "a protocol"],
  ["$sSiD", "a type mangling"],
  // The yielding accessors print differently by Swift version.
  ["$s2hi1SV1iSivx", "yielding_mutate, modify2 in 6.3"],
  ["$s2hi1SV1iSivy", "yielding_borrow, read2 in 6.3"],
  // What the real tool prints is not one name.
  ["$s4mainyycfU_", 'a closure in a module: "closure #1 in "'],
  ["$s4main3FooVZ", '"static Foo"'],
  ["$s4main3fooyyF3bar", '"foo()bar"'],
  ["$s4main3fooyyFS", '"foo()String"'],
  ["$sS", '"String", from a read past the end'],
  // Crashes or hangs swift-demangle 6.3.3.
  ["$sTJSdSSSpSrSUSP", "autodiff thunk"],
  ["$SSSTf0p", "a specialization parameter at the end"],
  [
    "_$S3foo6jestityyyyc_yyctF1l1bTf3pfp",
    "a specialization parameter at the end",
  ],
  // Labels that do not fit the parameters: the real tool fails too.
  ["$s4main3fooySiF", "a parameter with no label list"],
  ["$s4main7handlerySicvg", "a function-typed variable with no label list"],
];

const TRUNCATED_OR_CORRUPTED: Array<string> = [
  "$s",
  "_$s",
  "$S",
  "$s5MyApp",
  "$s5MyApp18CartViewController",
  "$s5MyApp18CartViewControllerC",
  "$s5MyApp18CartViewControllerC8checkout",
  "$s5MyApp18CartViewControllerC8checkoutyy",
  "$s5MyApp18CartViewControllerC8checkoutyyFT",
  "$s5MyApp18CartViewControllerC8checkoutyyFTA_",
  "$s5MyApp18CartViewControllerX8checkoutyyF",
  "$s5MyApp99CartViewControllerC8checkoutyyF",
  "$s5MyApp18CartViewControllerC8checkoutyyFyyF",
  "$s5MyApp18CartViewControllerCAA8checkoutyyF",
  "$s5MyApp18CartViewControllerCAZ8checkoutyyF",
  "$s5MyApp18CartViewControllerCA99_8checkoutyyF",
  "$s5MyApp18CartViewControllerC0Z8checkoutyyF",
  "$s5MyApp4CartV3add4item8quantityyAA4ItemV_SiF",
  "$s5MyApp4CartV3add4item8quantityyAA4ItemV_SitFfU",
  "$s5MyApp4CartV3add4item8quantityyAA4ItemV_SitFTg",
  "$s5MyApp4CartV3add4item8quantityyAA4ItemV_SitFTf4",
  "$sSa6appendyyxnFSi_Tg",
  "$sSaySiG",
  "$sS999i",
  "$sSi9999999999999999999_",
  "$s5MyApp4CartVyAA4ItemVSiciq",
];

function expectReadable(name: string | null): void {
  if (name !== null) {
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
    expect(name.trim()).toBe(name);
  }
}

describe("demangleSwiftSymbol, against simplified-manglings.txt", () => {
  test.each(SIMPLIFIED_MANGLINGS)("%s", (mangled: string, expected: string) => {
    expect(demangleSwiftSymbol(mangled)).toBe(expected);
  });
});

describe("demangleSwiftSymbol, against manglings.txt", () => {
  test.each(MANGLINGS)("%s", (mangled: string, expected: string) => {
    expect(demangleSwiftSymbol(mangled)).toBe(expected);
  });
});

describe("demangleSwiftSymbol, against app code swiftc mangled", () => {
  test.each(APP_CODE)("%s", (mangled: string, expected: string) => {
    expect(demangleSwiftSymbol(mangled)).toBe(expected);
  });

  test("the issue's example reads as the method it names", () => {
    expect(
      demangleSwiftSymbol("$s5MyApp18CartViewControllerC8checkoutyyF"),
    ).toBe("CartViewController.checkout()");
  });

  test("labels read as Swift writes them, unlabeled ones as _", () => {
    expect(
      demangleSwiftSymbol("$s5MyApp4CartV3add4item8quantityyAA4ItemV_SitF"),
    ).toBe("Cart.add(item:quantity:)");
    expect(demangleSwiftSymbol("$s5MyApp4CartV3addyyAA4ItemVF")).toBe(
      "Cart.add(_:)",
    );
  });
});

describe("demangleSwiftSymbol, word substitutions and substitutions", () => {
  test.each(SUBSTITUTIONS)("%s", (mangled: string, expected: string) => {
    expect(demangleSwiftSymbol(mangled)).toBe(expected);
  });
});

describe("demangleSwiftSymbol, the mangling prefixes", () => {
  const BODY: string = "5MyApp18CartViewControllerC8checkoutyyF";

  test.each([[`$s${BODY}`], [`_$s${BODY}`], [`$S${BODY}`], [`_$S${BODY}`]])(
    "%s",
    (mangled: string) => {
      expect(demangleSwiftSymbol(mangled)).toBe(
        "CartViewController.checkout()",
      );
    },
  );

  test.each([
    [`s${BODY}`],
    [`$e${BODY}`],
    [`_$e${BODY}`],
    [`__$s${BODY}`],
    [`$$s${BODY}`],
    [`_T0${BODY}`],
    [`@__swiftmacro_${BODY}`],
  ])("%s is not read", (mangled: string) => {
    expect(demangleSwiftSymbol(mangled)).toBeNull();
  });

  test("white space around a name is not part of it", () => {
    expect(demangleSwiftSymbol(`  $s${BODY}\n`)).toBe(
      "CartViewController.checkout()",
    );
  });
});

describe("demangleSwiftSymbol, what it does not read", () => {
  test.each(NOT_READ)("%s (%s)", (mangled: string) => {
    expect(demangleSwiftSymbol(mangled)).toBeNull();
  });

  test.each(
    TRUNCATED_OR_CORRUPTED.map((name: string) => {
      return [name];
    }),
  )("%s, truncated or corrupted", (mangled: string) => {
    expect(demangleSwiftSymbol(mangled)).toBeNull();
  });

  test.each([
    ["main"],
    ["-[CartViewController checkout]"],
    ["+[NSObject load]"],
    ["_ZN5MyApp4Cart8checkoutEv"],
    ["__swift_destroy_boxed_opaque_existential_1"],
    ["objc_msgSend"],
    [""],
    ["   "],
  ])("%j, not a Swift name", (mangled: string) => {
    expect(demangleSwiftSymbol(mangled)).toBeNull();
  });

  test("characters a mangling never holds", () => {
    const BODY: string = "5MyApp18CartViewControllerC8checkoutyyF";

    for (const character of [" ", "\n", "\t", "\u0000", "é", "-", "@", "/"]) {
      expect(demangleSwiftSymbol(`$s5MyApp${character}${BODY}`)).toBeNull();
    }
  });

  test("anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, ["$s"]]) {
      expect(demangleSwiftSymbol(value as unknown as string)).toBeNull();
    }
  });

  test("an absurdly long name is shown as it is, quickly", () => {
    const long: Array<string> = [
      `$s${"5MyApp".repeat(2000)}`,
      `$s${"A".repeat(5000)}`,
    ];
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const demangled: FastestRun<Array<string | null>> = fastestRun({
      run: (): Array<string | null> => {
        return long.map(demangleSwiftSymbol);
      },
      limitInMs: 2000,
    });

    expect(demangled.result).toEqual([null, null]);
    expect(demangled.inMs).toBeLessThan(2000);
  });

  test("a long name under the limit still reads", () => {
    const name: string = "N".repeat(3000);
    const mangled: string = `$s5MyApp${name.length}${name}C8checkoutyyF`;

    expect(mangled.length).toBeLessThan(4096);
    expect(demangleSwiftSymbol(mangled)).toBe(`${name}.checkout()`);
  });

  test("a word repeated into a long identifier still reads", () => {
    /*
     * 101 references to the 26-letter word, closed by "0", make a
     * 2,626-letter class name.
     */
    const word: string = "Abcdefghijklmnopqrstuvwxyz";
    const mangled: string = `$s26${word}0${"a".repeat(100)}A0C8checkoutyyF`;

    expect(demangleSwiftSymbol(mangled)).toBe(`${word.repeat(101)}.checkout()`);
  });

  /*
   * Each level an optional pair of the level before, the second half by
   * substitution: the printed name doubles with every level.
   */
  function doubling(levels: number): string {
    let mangled: string = "$s5MyApp4CartV";

    for (let index: number = 2; index < 2 + levels; index++) {
      mangled += `_A${String.fromCharCode(65 + index)}tSg`;
    }

    return `${mangled}WOh`;
  }

  test("a name that doubles reads in full while it is short", () => {
    expect(demangleSwiftSymbol(doubling(1))).toBe(
      "outlined destroy of (Cart, Cart)?",
    );
    expect(demangleSwiftSymbol(doubling(3))).toBe(
      "outlined destroy of (((Cart, Cart)?, (Cart, Cart)?)?, ((Cart, Cart)?, (Cart, Cart)?)?)?",
    );
  });

  test("manglings that make work grow fast end quickly", () => {
    const growing: Array<string> = [
      // 2^23 copies of "Cart", from 152 characters.
      doubling(23),
      // Repeat counts on substitutions and standard types.
      `$s5MyApp4CartV${"A2048_".repeat(600)}`,
      `$s${"S2048i".repeat(600)}`,
      // An identifier of 301 references to a 26-letter word: 7,826 letters.
      `$s26Abcdefghijklmnopqrstuvwxyz0${"a".repeat(300)}A0C8checkoutyyF`,
      // Arrays nested 900 deep.
      `$s${"Say".repeat(900)}Si${"G".repeat(900)}WOh`,
      // Types left on the stack.
      `$s5MyApp3BoxC${"ACyACyxGG".repeat(400)}WOh`,
      `$s${"Si_SStSg".repeat(500)}WOh`,
    ];
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const demangled: FastestRun<Array<string | null>> = fastestRun({
      run: (): Array<string | null> => {
        return growing.map(demangleSwiftSymbol);
      },
      limitInMs: 5000,
    });

    // Each is shown as it is.
    expect(demangled.result).toEqual(
      growing.map((): null => {
        return null;
      }),
    );
    expect(demangled.inMs).toBeLessThan(5000);
  });
});

describe("demangleSwiftSymbol never throws", () => {
  const SEEDS: Array<string> = [
    ...SIMPLIFIED_MANGLINGS,
    ...MANGLINGS,
    ...APP_CODE,
    ...SUBSTITUTIONS,
  ].map((entry: Case) => {
    return entry[0];
  });

  test("on every prefix of every real symbol", () => {
    for (const symbol of SEEDS) {
      for (let length: number = 0; length <= symbol.length; length++) {
        expectReadable(demangleSwiftSymbol(symbol.slice(0, length)));
      }
    }
  });

  test("on real symbols with one character changed, dropped or doubled", () => {
    // Seeded, so a failure can be replayed.
    const random: SeededRandom = seededRandom(9922);
    const alphabet: string =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$.";

    for (const symbol of SEEDS) {
      for (let round: number = 0; round < 40; round++) {
        const at: number = random(symbol.length);
        const character: string = alphabet[random(alphabet.length)] || "_";
        const changed: string =
          symbol.slice(0, at) + character + symbol.slice(at + 1);
        const dropped: string = symbol.slice(0, at) + symbol.slice(at + 1);
        const doubled: string = symbol.slice(0, at) + symbol.slice(at - 1);

        expectReadable(demangleSwiftSymbol(changed));
        expectReadable(demangleSwiftSymbol(dropped));
        expectReadable(demangleSwiftSymbol(doubled));
      }
    }
  });

  test("on random manglings and random text", () => {
    const random: SeededRandom = seededRandom(9925);
    const mangling: string =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$.yyAAS_";

    for (let round: number = 0; round < 4000; round++) {
      const length: number = random(80);
      let body: string = "";

      for (let index: number = 0; index < length; index++) {
        body += mangling[random(mangling.length)] || "y";
      }

      let text: string = "";

      for (let index: number = 0; index < length; index++) {
        text += String.fromCharCode(random(0x3000));
      }

      expectReadable(demangleSwiftSymbol(`$s${body}`));
      expectReadable(demangleSwiftSymbol(`_$S${body}`));
      expectReadable(demangleSwiftSymbol(text));
      expect(toAppleSymbolDisplayName(`$s${body}`).length).toBeGreaterThan(0);
    }
  });

  test("on real symbols spliced together", () => {
    const random: SeededRandom = seededRandom(2026);

    for (let round: number = 0; round < 3000; round++) {
      const first: string = SEEDS[random(SEEDS.length)] || "$s";
      const second: string = SEEDS[random(SEEDS.length)] || "$s";
      const spliced: string =
        first.slice(0, random(first.length)) +
        second.slice(random(second.length));

      expectReadable(demangleSwiftSymbol(spliced));
    }
  });
});

describe("toAppleSymbolDisplayName", () => {
  test("a Swift name, demangled", () => {
    expect(
      toAppleSymbolDisplayName("$s5MyApp18CartViewControllerC8checkoutyyF"),
    ).toBe("CartViewController.checkout()");
    expect(
      toAppleSymbolDisplayName("_$s5MyApp18CartViewControllerC8checkoutyyF"),
    ).toBe("CartViewController.checkout()");
    expect(
      toAppleSymbolDisplayName(
        "  $s5MyApp18CartViewControllerC8checkoutyyFSSAA4ItemVXEfU_ ",
      ),
    ).toBe("closure #1 in CartViewController.checkout()");
  });

  test("an Objective-C name, as given", () => {
    expect(toAppleSymbolDisplayName("-[CartViewController checkout]")).toBe(
      "-[CartViewController checkout]",
    );
    expect(toAppleSymbolDisplayName("+[NSObject load]")).toBe(
      "+[NSObject load]",
    );
    expect(
      toAppleSymbolDisplayName("-[UIApplication sendAction:to:from:forEvent:]"),
    ).toBe("-[UIApplication sendAction:to:from:forEvent:]");
  });

  test("a C name, as given", () => {
    expect(toAppleSymbolDisplayName("main")).toBe("main");
    expect(toAppleSymbolDisplayName("objc_msgSend")).toBe("objc_msgSend");
    expect(toAppleSymbolDisplayName("_dispatch_call_block_and_release")).toBe(
      "_dispatch_call_block_and_release",
    );
  });

  test("a C++ name, as given", () => {
    expect(toAppleSymbolDisplayName("_ZN5MyApp4Cart8checkoutEv")).toBe(
      "_ZN5MyApp4Cart8checkoutEv",
    );
    expect(
      toAppleSymbolDisplayName(
        "__ZNSt3__16vectorIiNS_9allocatorIiEEE9push_backERKi",
      ),
    ).toBe("__ZNSt3__16vectorIiNS_9allocatorIiEEE9push_backERKi");
  });

  test("a Swift name this cannot read, as given", () => {
    expect(toAppleSymbolDisplayName("$s5MyApp003BJgopyS2dF")).toBe(
      "$s5MyApp003BJgopyS2dF",
    );
    expect(toAppleSymbolDisplayName("$sSiIgd_SiIegr_TR")).toBe(
      "$sSiIgd_SiIegr_TR",
    );
    expect(toAppleSymbolDisplayName("_T04main1_yyF")).toBe("_T04main1_yyF");
  });

  test("trimmed, and never empty for a non-empty name", () => {
    expect(toAppleSymbolDisplayName("  main\n")).toBe("main");
    expect(toAppleSymbolDisplayName(" -[A b] ")).toBe("-[A b]");
    expect(toAppleSymbolDisplayName("")).toBe("");
    expect(toAppleSymbolDisplayName("   ")).toBe("   ");
    expect(toAppleSymbolDisplayName(42 as unknown as string)).toBe("");

    for (const entry of [...APP_CODE, ...NOT_READ]) {
      expect(toAppleSymbolDisplayName(entry[0]).length).toBeGreaterThan(0);
    }
  });
});
