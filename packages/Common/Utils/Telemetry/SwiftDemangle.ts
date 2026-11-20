/*
 * SWIFT SYMBOL NAMES, AS A PERSON READS THEM (#9922).
 *
 * An iOS crash frame symbolicated against a dSYM names a raw Swift symbol:
 * "$s5MyApp18CartViewControllerC8checkoutyyF". This turns it into what
 * `swift-demangle --simplified` prints: "CartViewController.checkout()".
 *
 * A port of the Swift compiler's own demangler (lib/Demangling/Demangler.cpp,
 * a postfix stack machine with substitutions) and of its node printer
 * (lib/Demangling/NodePrinter.cpp) with DemangleOptions::
 * SimplifiedUIDemangleOptions() fixed in. Only the part of the grammar app
 * code produces is ported, operator for operator: anything else - and any
 * input the real demangler would print as something other than one code
 * entity - gives null, so the caller shows the raw name. A wrong name is
 * worse than none.
 *
 * Display only: grouping keys on the raw name. Pure, no imports, bounded
 * work, and never throws.
 */

// The longest symbol read; a longer one is shown as it is.
const MAX_SYMBOL_LENGTH: number = 4096;

// Bounds on the work one symbol may cause.
const MAX_NODES: number = 50000;
const MAX_STACK: number = 4096;
const MAX_IDENTIFIER_LENGTH: number = 4096;
const MAX_OUTPUT_LENGTH: number = 4096;
const MAX_PRINT_STEPS: number = 50000;

// NodePrinter::MaxDepth: deeper trees print "<<too complex>>" there.
const MAX_PRINT_DEPTH: number = 768;

// SubstitutionMerging::MaxRepeatCount.
const MAX_REPEAT_COUNT: number = 2048;

// Demangler::MaxNumWords.
const MAX_NUM_WORDS: number = 26;

// MAX_SPECIALIZATION_PASS.
const MAX_SPECIALIZATION_PASS: number = 10;

const INT_MAX: number = 2147483647;

const STDLIB_NAME: string = "Swift";
const MANGLING_MODULE_OBJC: string = "__C";
const MANGLING_MODULE_CLANG_IMPORTER: string = "__C_Synthesized";

// The prefixes read: Swift 5 and later ($s), and Swift 4.2 / 5.0 ($S).
const MANGLING_PREFIXES: Array<string> = ["_$s", "$s", "_$S", "$S"];

// What a symbol table's name may hold; swift-demangle reads the same.
const MANGLED_NAME_PATTERN: RegExp = /^[A-Za-z0-9_$.]+$/;

type NodeKind =
  | "Allocator"
  | "ArgumentTuple"
  | "AsyncAnnotation"
  | "AsyncAwaitResumePartialFunction"
  | "AsyncRemoved"
  | "AsyncSuspendResumePartialFunction"
  | "AutoClosureType"
  | "BaseWitnessTableAccessor"
  | "BoundGenericClass"
  | "BoundGenericEnum"
  | "BoundGenericFunction"
  | "BoundGenericProtocol"
  | "BoundGenericStructure"
  | "BoundGenericTypeAlias"
  | "BuiltinTypeName"
  | "CFunctionPointer"
  | "Class"
  | "ConcurrentFunctionType"
  | "Constructor"
  | "CurryThunk"
  | "Deallocator"
  | "DefaultArgumentInitializer"
  | "DependentAssociatedTypeRef"
  | "DependentGenericConformanceRequirement"
  | "DependentGenericInverseConformanceRequirement"
  | "DependentGenericLayoutRequirement"
  | "DependentGenericParamCount"
  | "DependentGenericParamType"
  | "DependentGenericSameTypeRequirement"
  | "DependentGenericSignature"
  | "DependentGenericType"
  | "DependentMemberType"
  | "Destructor"
  | "DidSet"
  | "DirectMethodReferenceAttribute"
  | "DispatchThunk"
  | "DroppedArgument"
  | "DynamicAttribute"
  | "DynamicSelf"
  | "EmptyList"
  | "Enum"
  | "EscapingAutoClosureType"
  | "EscapingObjCBlock"
  | "ExistentialMetatype"
  | "ExplicitClosure"
  | "Extension"
  | "FirstElementMarker"
  | "Function"
  | "FunctionSignatureSpecialization"
  | "FunctionSignatureSpecializationParam"
  | "FunctionSignatureSpecializationParamKind"
  | "FunctionSignatureSpecializationParamPayload"
  | "FunctionSignatureSpecializationReturn"
  | "FunctionType"
  | "GenericPartialSpecialization"
  | "GenericPartialSpecializationNotReAbstracted"
  | "GenericSpecialization"
  | "GenericSpecializationInResilienceDomain"
  | "GenericSpecializationNotReAbstracted"
  | "GenericSpecializationParam"
  | "GenericSpecializationPrespecialized"
  | "Getter"
  | "Global"
  | "GlobalActorFunctionType"
  | "GlobalGetter"
  | "GlobalVariableOnceDeclList"
  | "GlobalVariableOnceFunction"
  | "IVarDestroyer"
  | "IVarInitializer"
  | "Identifier"
  | "ImplicitClosure"
  | "InOut"
  | "Index"
  | "InfixOperator"
  | "InitAccessor"
  | "Initializer"
  | "InlinedGenericFunction"
  | "IsSerialized"
  | "Isolated"
  | "IsolatedAnyFunctionType"
  | "IsolatedDeallocator"
  | "KeyPathAppliedMethodThunkHelper"
  | "KeyPathGetterThunkHelper"
  | "KeyPathSetterThunkHelper"
  | "KeyPathUnappliedMethodThunkHelper"
  | "LabelList"
  | "LazyProtocolWitnessTableAccessor"
  | "LocalDeclName"
  | "MaterializeForSet"
  | "MergedFunction"
  | "Metatype"
  | "MetatypeRepresentation"
  | "MethodLookupFunction"
  | "ModifyAccessor"
  | "Module"
  | "NativeOwningAddressor"
  | "NativeOwningMutableAddressor"
  | "NativePinningAddressor"
  | "NativePinningMutableAddressor"
  | "NoEscapeFunctionType"
  | "NonIsolatedCallerFunctionType"
  | "NonObjCAttribute"
  | "Number"
  | "ObjCAttribute"
  | "ObjCBlock"
  | "OpaqueReturnType"
  | "OpaqueReturnTypeIndex"
  | "OpaqueReturnTypeOf"
  | "OpaqueType"
  | "OutlinedAssignWithCopy"
  | "OutlinedAssignWithCopyNoValueWitness"
  | "OutlinedAssignWithTake"
  | "OutlinedAssignWithTakeNoValueWitness"
  | "OutlinedConsume"
  | "OutlinedCopy"
  | "OutlinedDestroy"
  | "OutlinedDestroyNoValueWitness"
  | "OutlinedInitializeWithCopy"
  | "OutlinedInitializeWithCopyNoValueWitness"
  | "OutlinedInitializeWithTake"
  | "OutlinedInitializeWithTakeNoValueWitness"
  | "OutlinedRelease"
  | "OutlinedRetain"
  | "Owned"
  | "OwningAddressor"
  | "OwningMutableAddressor"
  | "PartialApplyForwarder"
  | "PartialApplyObjCForwarder"
  | "PostfixOperator"
  | "PrefixOperator"
  | "PrivateDeclName"
  | "PropertyWrappedFieldInitAccessor"
  | "PropertyWrapperBackingInitializer"
  | "PropertyWrapperInitFromProjectedValue"
  | "Protocol"
  | "ProtocolConformance"
  | "ProtocolList"
  | "ProtocolListWithAnyObject"
  | "ProtocolListWithClass"
  | "ProtocolWitness"
  | "ReadAccessor"
  | "RepresentationChanged"
  | "ReturnType"
  | "Sending"
  | "SendingResultFunctionType"
  | "Setter"
  | "Shared"
  | "SpecializationPassID"
  | "Static"
  | "Structure"
  | "Subscript"
  | "Suffix"
  | "ThinFunctionType"
  | "ThrowsAnnotation"
  | "Tuple"
  | "TupleElement"
  | "TupleElementName"
  | "Type"
  | "TypeAlias"
  | "TypeList"
  | "TypeMetadataAccessFunction"
  | "TypeMetadataCompletionFunction"
  | "TypeMetadataInstantiationFunction"
  | "TypedThrowsAnnotation"
  | "UncurriedFunctionType"
  | "Unmanaged"
  | "Unowned"
  | "UnsafeAddressor"
  | "UnsafeMutableAddressor"
  | "ValueWitness"
  | "VariadicMarker"
  | "Variable"
  | "Weak"
  | "WillSet";

interface SwiftNode {
  kind: NodeKind;
  text: string | null;
  index: number | null;
  children: Array<SwiftNode>;
}

/*
 * Thrown where the input uses something this port does not read, or where
 * the real demangler or printer would not give one clean name. Caught at
 * the top: the symbol then reads as null.
 */
class NotReadable extends Error {}

function fail(): never {
  throw new NotReadable();
}

function isDigit(c: string): boolean {
  return c.length === 1 && c >= "0" && c <= "9";
}

function isLowerLetter(c: string): boolean {
  return c.length === 1 && c >= "a" && c <= "z";
}

function isUpperLetter(c: string): boolean {
  return c.length === 1 && c >= "A" && c <= "Z";
}

function isLetter(c: string): boolean {
  return isLowerLetter(c) || isUpperLetter(c);
}

// ManglingUtils.h: where a substitution word starts and ends.
function isWordStart(c: string): boolean {
  return c !== "" && !isDigit(c) && c !== "_";
}

function isWordEnd(c: string, previous: string): boolean {
  if (c === "_" || c === "") {
    return true;
  }

  return !isUpperLetter(previous) && isUpperLetter(c);
}

const CONTEXT_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "Allocator",
  "Class",
  "Constructor",
  "Deallocator",
  "DefaultArgumentInitializer",
  "Destructor",
  "DidSet",
  "Enum",
  "ExplicitClosure",
  "Extension",
  "Function",
  "Getter",
  "GlobalGetter",
  "IVarInitializer",
  "IVarDestroyer",
  "ImplicitClosure",
  "Initializer",
  "InitAccessor",
  "IsolatedDeallocator",
  "MaterializeForSet",
  "ModifyAccessor",
  "Module",
  "NativeOwningAddressor",
  "NativeOwningMutableAddressor",
  "NativePinningAddressor",
  "NativePinningMutableAddressor",
  "OwningAddressor",
  "OwningMutableAddressor",
  "PropertyWrapperBackingInitializer",
  "PropertyWrappedFieldInitAccessor",
  "PropertyWrapperInitFromProjectedValue",
  "Protocol",
  "ReadAccessor",
  "Setter",
  "Static",
  "Structure",
  "Subscript",
  "TypeAlias",
  "UnsafeAddressor",
  "UnsafeMutableAddressor",
  "Variable",
  "WillSet",
  "OpaqueReturnTypeOf",
]);

const DECL_NAME_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "Identifier",
  "LocalDeclName",
  "PrivateDeclName",
  "PrefixOperator",
  "PostfixOperator",
  "InfixOperator",
]);

const ANY_GENERIC_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "Structure",
  "Class",
  "Enum",
  "Protocol",
  "TypeAlias",
]);

const REQUIREMENT_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "DependentGenericSameTypeRequirement",
  "DependentGenericLayoutRequirement",
  "DependentGenericConformanceRequirement",
  "DependentGenericInverseConformanceRequirement",
]);

const FUNCTION_ATTR_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "FunctionSignatureSpecialization",
  "GenericSpecialization",
  "GenericSpecializationPrespecialized",
  "InlinedGenericFunction",
  "GenericSpecializationNotReAbstracted",
  "GenericPartialSpecialization",
  "GenericPartialSpecializationNotReAbstracted",
  "GenericSpecializationInResilienceDomain",
  "ObjCAttribute",
  "NonObjCAttribute",
  "DynamicAttribute",
  "DirectMethodReferenceAttribute",
  "PartialApplyForwarder",
  "PartialApplyObjCForwarder",
  "MergedFunction",
  "AsyncAwaitResumePartialFunction",
  "AsyncSuspendResumePartialFunction",
]);

// Demangle::nodeConsumesGenericArgs.
const NON_CONSUMING_GENERIC_ARGS_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "Variable",
  "Subscript",
  "ImplicitClosure",
  "ExplicitClosure",
  "DefaultArgumentInitializer",
  "Initializer",
  "PropertyWrapperBackingInitializer",
  "PropertyWrappedFieldInitAccessor",
  "PropertyWrapperInitFromProjectedValue",
  "Static",
]);

// The declarations a symbol names: functions, accessors, closures, ...
const DECLARATION_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "Function",
  "BoundGenericFunction",
  "Variable",
  "Subscript",
  "Allocator",
  "Constructor",
  "Destructor",
  "Deallocator",
  "IsolatedDeallocator",
  "IVarDestroyer",
  "IVarInitializer",
  "ExplicitClosure",
  "ImplicitClosure",
  "Initializer",
  "DefaultArgumentInitializer",
  "PropertyWrapperBackingInitializer",
  "PropertyWrappedFieldInitAccessor",
  "PropertyWrapperInitFromProjectedValue",
  "Getter",
  "Setter",
  "MaterializeForSet",
  "WillSet",
  "DidSet",
  "ReadAccessor",
  "ModifyAccessor",
  "InitAccessor",
  "GlobalGetter",
  "OwningMutableAddressor",
  "NativeOwningMutableAddressor",
  "NativePinningMutableAddressor",
  "UnsafeMutableAddressor",
  "OwningAddressor",
  "NativeOwningAddressor",
  "NativePinningAddressor",
  "UnsafeAddressor",
]);

// The compiler-made functions a symbol may name, each about a type.
const GENERATED_CODE_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "MethodLookupFunction",
  "BaseWitnessTableAccessor",
  "TypeMetadataAccessFunction",
  "TypeMetadataCompletionFunction",
  "TypeMetadataInstantiationFunction",
  "ValueWitness",
  "GlobalVariableOnceFunction",
  "LazyProtocolWitnessTableAccessor",
  "OutlinedCopy",
  "OutlinedConsume",
  "OutlinedRetain",
  "OutlinedRelease",
  "OutlinedInitializeWithTake",
  "OutlinedInitializeWithTakeNoValueWitness",
  "OutlinedInitializeWithCopy",
  "OutlinedInitializeWithCopyNoValueWitness",
  "OutlinedAssignWithTake",
  "OutlinedAssignWithTakeNoValueWitness",
  "OutlinedAssignWithCopy",
  "OutlinedAssignWithCopyNoValueWitness",
  "OutlinedDestroy",
  "OutlinedDestroyNoValueWitness",
]);

// StandardTypesMangling.def: S + letter, and Sc + letter for _Concurrency.
const STANDARD_TYPES: Record<string, [NodeKind, string]> = {
  A: ["Structure", "AutoreleasingUnsafeMutablePointer"],
  a: ["Structure", "Array"],
  b: ["Structure", "Bool"],
  D: ["Structure", "Dictionary"],
  d: ["Structure", "Double"],
  f: ["Structure", "Float"],
  h: ["Structure", "Set"],
  I: ["Structure", "DefaultIndices"],
  i: ["Structure", "Int"],
  J: ["Structure", "Character"],
  N: ["Structure", "ClosedRange"],
  n: ["Structure", "Range"],
  O: ["Structure", "ObjectIdentifier"],
  P: ["Structure", "UnsafePointer"],
  p: ["Structure", "UnsafeMutablePointer"],
  R: ["Structure", "UnsafeBufferPointer"],
  r: ["Structure", "UnsafeMutableBufferPointer"],
  S: ["Structure", "String"],
  s: ["Structure", "Substring"],
  u: ["Structure", "UInt"],
  V: ["Structure", "UnsafeRawPointer"],
  v: ["Structure", "UnsafeMutableRawPointer"],
  W: ["Structure", "UnsafeRawBufferPointer"],
  w: ["Structure", "UnsafeMutableRawBufferPointer"],
  q: ["Enum", "Optional"],
  B: ["Protocol", "BinaryFloatingPoint"],
  E: ["Protocol", "Encodable"],
  e: ["Protocol", "Decodable"],
  F: ["Protocol", "FloatingPoint"],
  G: ["Protocol", "RandomNumberGenerator"],
  H: ["Protocol", "Hashable"],
  j: ["Protocol", "Numeric"],
  K: ["Protocol", "BidirectionalCollection"],
  k: ["Protocol", "RandomAccessCollection"],
  L: ["Protocol", "Comparable"],
  l: ["Protocol", "Collection"],
  M: ["Protocol", "MutableCollection"],
  m: ["Protocol", "RangeReplaceableCollection"],
  Q: ["Protocol", "Equatable"],
  T: ["Protocol", "Sequence"],
  t: ["Protocol", "IteratorProtocol"],
  U: ["Protocol", "UnsignedInteger"],
  X: ["Protocol", "RangeExpression"],
  x: ["Protocol", "Strideable"],
  Y: ["Protocol", "RawRepresentable"],
  y: ["Protocol", "StringProtocol"],
  Z: ["Protocol", "SignedInteger"],
  z: ["Protocol", "BinaryInteger"],
};

const CONCURRENCY_TYPES: Record<string, [NodeKind, string]> = {
  A: ["Protocol", "Actor"],
  C: ["Structure", "CheckedContinuation"],
  c: ["Structure", "UnsafeContinuation"],
  E: ["Structure", "CancellationError"],
  e: ["Structure", "UnownedSerialExecutor"],
  F: ["Protocol", "Executor"],
  f: ["Protocol", "SerialExecutor"],
  G: ["Structure", "TaskGroup"],
  g: ["Structure", "ThrowingTaskGroup"],
  h: ["Protocol", "TaskExecutor"],
  I: ["Protocol", "AsyncIteratorProtocol"],
  i: ["Protocol", "AsyncSequence"],
  J: ["Structure", "UnownedJob"],
  M: ["Class", "MainActor"],
  P: ["Structure", "TaskPriority"],
  S: ["Structure", "AsyncStream"],
  s: ["Structure", "AsyncThrowingStream"],
  T: ["Structure", "Task"],
  t: ["Structure", "UnsafeCurrentTask"],
};

// Builtin types named by one letter (Strings.h).
const BUILTIN_TYPE_NAMES: Record<string, string> = {
  A: "Builtin.ImplicitActor",
  b: "Builtin.BridgeObject",
  B: "Builtin.UnsafeValueBuffer",
  e: "Builtin.Executor",
  I: "Builtin.IntLiteral",
  O: "Builtin.UnknownObject",
  o: "Builtin.NativeObject",
  p: "Builtin.RawPointer",
  j: "Builtin.Job",
  D: "Builtin.DefaultActorStorage",
  d: "Builtin.NonDefaultDistributedActorStorage",
  c: "Builtin.RawUnsafeContinuation",
  t: "Builtin.SILToken",
  w: "Builtin.Word",
  P: "Builtin.PackIndex",
};

// ValueWitnessMangling.def, with the names NodePrinter prints.
const VALUE_WITNESSES: Record<string, string> = {
  al: "allocateBuffer",
  ca: "assignWithCopy",
  ta: "assignWithTake",
  de: "deallocateBuffer",
  xx: "destroy",
  XX: "destroyBuffer",
  Xx: "destroyArray",
  CP: "initializeBufferWithCopyOfBuffer",
  Cp: "initializeBufferWithCopy",
  cp: "initializeWithCopy",
  Tk: "initializeBufferWithTake",
  tk: "initializeWithTake",
  pr: "projectBuffer",
  TK: "initializeBufferWithTakeOfBuffer",
  Cc: "initializeArrayWithCopy",
  Tt: "initializeArrayWithTakeFrontToBack",
  tT: "initializeArrayWithTakeBackToFront",
  xs: "storeExtraInhabitant",
  xg: "getExtraInhabitantIndex",
  ug: "getEnumTag",
  up: "destructiveProjectEnumData",
  ui: "destructiveInjectEnumTag",
  et: "getEnumTagSinglePayload",
  st: "storeEnumTagSinglePayload",
};

// FunctionSigSpecializationParamKind.
const SPEC_CONSTANT_PROP_FUNCTION: number = 0;
const SPEC_CONSTANT_PROP_GLOBAL: number = 1;
const SPEC_CONSTANT_PROP_INTEGER: number = 2;
const SPEC_CONSTANT_PROP_FLOAT: number = 3;
const SPEC_CONSTANT_PROP_STRING: number = 4;
const SPEC_CLOSURE_PROP: number = 5;
const SPEC_BOX_TO_VALUE: number = 6;
const SPEC_BOX_TO_STACK: number = 7;
const SPEC_INOUT_TO_OUT: number = 8;
const SPEC_CONSTANT_PROP_KEY_PATH: number = 9;
const SPEC_CONSTANT_PROP_STRUCT: number = 10;
const SPEC_CLOSURE_PROP_PREVIOUS_ARG: number = 11;
const SPEC_DEAD: number = 1 << 6;
const SPEC_OWNED_TO_GUARANTEED: number = 1 << 7;
const SPEC_SROA: number = 1 << 8;
const SPEC_GUARANTEED_TO_OWNED: number = 1 << 9;
const SPEC_EXISTENTIAL_TO_GENERIC: number = 1 << 10;

// Demangler.cpp, the subset app code produces.
class Demangler {
  private text: string;
  private pos: number = 0;
  private nodeStack: Array<SwiftNode> = [];
  private substitutions: Array<SwiftNode> = [];
  private words: Array<string> = [];
  private nodeCount: number = 0;

  public constructor(text: string) {
    this.text = text;
  }

  // Demangler::demangleSymbol, for a name whose prefix is already known.
  public demangleSymbol(prefixLength: number): SwiftNode {
    this.pos = prefixLength;

    while (this.pos < this.text.length) {
      const node: SwiftNode | null = this.demangleOperator();

      if (!node) {
        fail();
      }

      this.pushNode(node);
    }

    const topLevel: SwiftNode = this.createNode("Global");

    // An unmangled suffix (".resume.0", ".cold.1") is not printed.
    this.popNodeKind("Suffix");

    let parent: SwiftNode = topLevel;

    for (;;) {
      const attribute: SwiftNode | null = this.popNodeIf(
        (kind: NodeKind): boolean => {
          return FUNCTION_ATTR_KINDS.has(kind);
        },
      );

      if (!attribute) {
        break;
      }

      parent.children.push(attribute);

      if (
        attribute.kind === "PartialApplyForwarder" ||
        attribute.kind === "PartialApplyObjCForwarder"
      ) {
        parent = attribute;
      }
    }

    /*
     * The real demangler adds every node left on the stack, and prints them
     * one after another. One code entity is a name; anything else is not.
     */
    if (this.nodeStack.length !== 1) {
      fail();
    }

    const entity: SwiftNode = this.nodeStack[0] as SwiftNode;

    if (!isCodeSymbol(entity)) {
      fail();
    }

    parent.children.push(entity);

    return topLevel;
  }

  // Reading the text.

  private peekChar(): string {
    return this.pos < this.text.length ? (this.text[this.pos] as string) : "";
  }

  private nextChar(): string {
    if (this.pos >= this.text.length) {
      return "";
    }

    const c: string = this.text[this.pos] as string;
    this.pos++;
    return c;
  }

  private nextIf(c: string): boolean {
    if (!this.text.startsWith(c, this.pos)) {
      return false;
    }

    this.pos += c.length;
    return true;
  }

  /*
   * Demangler::pushBack. After a read past the end it would step back onto
   * the last character and read it again, which is not a mangling.
   */
  private pushBack(c: string): void {
    if (c === "" || this.pos <= 0) {
      fail();
    }

    this.pos--;
  }

  // Nodes.

  private createNode(
    kind: NodeKind,
    payload?: { text?: string; index?: number },
  ): SwiftNode {
    this.nodeCount++;

    if (this.nodeCount > MAX_NODES) {
      fail();
    }

    return {
      kind: kind,
      text: payload && payload.text !== undefined ? payload.text : null,
      index: payload && payload.index !== undefined ? payload.index : null,
      children: [],
    };
  }

  private createTextNode(kind: NodeKind, text: string): SwiftNode {
    return this.createNode(kind, { text: text });
  }

  private createIndexNode(kind: NodeKind, index: number): SwiftNode {
    return this.createNode(kind, { index: index });
  }

  private createWithChild(
    kind: NodeKind,
    child: SwiftNode | null,
  ): SwiftNode | null {
    if (!child) {
      return null;
    }

    const node: SwiftNode = this.createNode(kind);
    node.children.push(child);
    return node;
  }

  private createWithChildren(
    kind: NodeKind,
    ...children: Array<SwiftNode | null>
  ): SwiftNode | null {
    for (const child of children) {
      if (!child) {
        return null;
      }
    }

    const node: SwiftNode = this.createNode(kind);

    for (const child of children) {
      node.children.push(child as SwiftNode);
    }

    return node;
  }

  private createType(child: SwiftNode | null): SwiftNode | null {
    return this.createWithChild("Type", child);
  }

  private addChild(
    parent: SwiftNode | null,
    child: SwiftNode | null,
  ): SwiftNode | null {
    if (!parent || !child) {
      return null;
    }

    parent.children.push(child);
    return parent;
  }

  private changeKind(node: SwiftNode | null, kind: NodeKind): SwiftNode | null {
    if (!node) {
      return null;
    }

    const changed: SwiftNode = this.createNode(kind);
    changed.text = node.text;
    changed.index = node.index;
    changed.children = node.children.slice();
    return changed;
  }

  private reverseChildren(node: SwiftNode, startingAt: number): void {
    const tail: Array<SwiftNode> = node.children.splice(startingAt).reverse();
    node.children.push(...tail);
  }

  // The node stack.

  private pushNode(node: SwiftNode): void {
    if (this.nodeStack.length >= MAX_STACK) {
      fail();
    }

    this.nodeStack.push(node);
  }

  private popNode(): SwiftNode | null {
    return this.nodeStack.pop() || null;
  }

  private popNodeKind(kind: NodeKind): SwiftNode | null {
    const top: SwiftNode | undefined =
      this.nodeStack[this.nodeStack.length - 1];

    if (!top || top.kind !== kind) {
      return null;
    }

    return this.popNode();
  }

  private popNodeIf(predicate: (kind: NodeKind) => boolean): SwiftNode | null {
    const top: SwiftNode | undefined =
      this.nodeStack[this.nodeStack.length - 1];

    if (!top || !predicate(top.kind)) {
      return null;
    }

    return this.popNode();
  }

  private addSubstitution(node: SwiftNode | null): void {
    if (node) {
      this.substitutions.push(node);
    }
  }

  // Numbers.

  private demangleNatural(): number {
    if (!isDigit(this.peekChar())) {
      return -1000;
    }

    let num: number = 0;

    for (;;) {
      const c: string = this.peekChar();

      if (!isDigit(c)) {
        return num;
      }

      num = 10 * num + (c.charCodeAt(0) - 48);

      if (num > INT_MAX) {
        return -1000;
      }

      this.nextChar();
    }
  }

  private demangleIndex(): number {
    if (this.nextIf("_")) {
      return 0;
    }

    const num: number = this.demangleNatural();

    if (num >= 0 && num < INT_MAX && this.nextIf("_")) {
      return num + 1;
    }

    return -1000;
  }

  private demangleIndexAsNode(): SwiftNode | null {
    const index: number = this.demangleIndex();

    if (index >= 0) {
      return this.createIndexNode("Number", index);
    }

    return null;
  }

  // Demangler::demangleOperator.
  private demangleOperator(): SwiftNode | null {
    const c: string = this.nextChar();

    switch (c) {
      case "A":
        return this.demangleMultiSubstitutions();
      case "B":
        return this.demangleBuiltinType();
      case "C":
        return this.demangleAnyGenericType("Class");
      case "E":
        return this.demangleExtensionContext();
      case "F":
        return this.demanglePlainFunction();
      case "G":
        return this.demangleBoundGenericType();
      case "K":
        return this.createNode("ThrowsAnnotation");
      case "L":
        return this.demangleLocalIdentifier();
      case "M":
        return this.demangleMetatype();
      case "O":
        return this.demangleAnyGenericType("Enum");
      case "P":
        return this.demangleAnyGenericType("Protocol");
      case "Q":
        return this.demangleArchetype();
      case "R":
        return this.demangleGenericRequirement();
      case "S":
        return this.demangleStandardSubstitution();
      case "T":
        return this.demangleThunkOrSpecialization();
      case "V":
        return this.demangleAnyGenericType("Structure");
      case "W":
        return this.demangleWitness();
      case "X":
        return this.demangleSpecialType();
      case "Y":
        return this.demangleTypeAnnotation();
      case "Z":
        return this.createWithChild(
          "Static",
          this.popNodeIf((kind: NodeKind): boolean => {
            return isEntity(kind);
          }),
        );
      case "a":
        return this.demangleAnyGenericType("TypeAlias");
      case "c":
        return this.popFunctionType("FunctionType");
      case "d":
        return this.createNode("VariadicMarker");
      case "f":
        return this.demangleFunctionEntity();
      case "h":
        return this.createType(
          this.createWithChild("Shared", this.popTypeAndGetChild()),
        );
      case "i":
        return this.demangleSubscript();
      case "l":
        return this.demangleGenericSignature(false);
      case "m":
        return this.createType(
          this.createWithChild("Metatype", this.popNodeKind("Type")),
        );
      case "n":
        return this.createType(
          this.createWithChild("Owned", this.popTypeAndGetChild()),
        );
      case "o":
        return this.demangleOperatorIdentifier();
      case "p":
        return this.createType(this.demangleProtocolList());
      case "q":
        return this.createType(this.demangleGenericParamIndex());
      case "r":
        return this.demangleGenericSignature(true);
      case "s":
        return this.createTextNode("Module", STDLIB_NAME);
      case "t":
        return this.popTuple();
      case "u":
        return this.demangleGenericType();
      case "v":
        return this.demangleAccessor(this.demangleEntity("Variable"));
      case "w":
        return this.demangleValueWitness();
      case "x":
        return this.createType(this.getDependentGenericParamType(0, 0));
      case "y":
        return this.createNode("EmptyList");
      case "z":
        return this.createType(
          this.createWithChild("InOut", this.popTypeAndGetChild()),
        );
      case "_":
        return this.createNode("FirstElementMarker");
      case ".":
        this.pushBack(c);
        return this.createSuffix();
      default:
        if (!isDigit(c)) {
          // D, H, I, N, g, $ and the symbolic references: not read here.
          return fail();
        }

        this.pushBack(c);
        return this.demangleIdentifier();
    }
  }

  private createSuffix(): SwiftNode {
    const suffix: string = this.text.slice(this.pos);
    this.pos = this.text.length;
    return this.createTextNode("Suffix", suffix);
  }

  // Substitutions.

  private demangleMultiSubstitutions(): SwiftNode | null {
    let repeatCount: number = -1;

    for (;;) {
      const c: string = this.nextChar();

      if (c === "") {
        return null;
      }

      if (isLowerLetter(c)) {
        const node: SwiftNode | null = this.pushMultiSubstitutions(
          repeatCount,
          c.charCodeAt(0) - 97,
        );

        if (!node) {
          return null;
        }

        this.pushNode(node);
        repeatCount = -1;
        continue;
      }

      if (isUpperLetter(c)) {
        return this.pushMultiSubstitutions(repeatCount, c.charCodeAt(0) - 65);
      }

      if (c === "_") {
        const index: number = repeatCount + 27;

        if (index >= this.substitutions.length) {
          return null;
        }

        return this.substitutions[index] || null;
      }

      this.pushBack(c);
      repeatCount = this.demangleNatural();

      if (repeatCount < 0) {
        return null;
      }
    }
  }

  private pushMultiSubstitutions(
    repeatCount: number,
    substitutionIndex: number,
  ): SwiftNode | null {
    if (substitutionIndex >= this.substitutions.length) {
      return null;
    }

    if (repeatCount > MAX_REPEAT_COUNT) {
      return null;
    }

    const node: SwiftNode = this.substitutions[substitutionIndex] as SwiftNode;
    let count: number = repeatCount;

    while (count-- > 1) {
      this.pushNode(node);
    }

    return node;
  }

  private createSwiftType(kind: NodeKind, name: string): SwiftNode | null {
    return this.createType(
      this.createWithChildren(
        kind,
        this.createTextNode("Module", STDLIB_NAME),
        this.createTextNode("Identifier", name),
      ),
    );
  }

  private demangleStandardSubstitution(): SwiftNode | null {
    const c: string = this.nextChar();

    switch (c) {
      case "o":
        return this.createTextNode("Module", MANGLING_MODULE_OBJC);
      case "C":
        return this.createTextNode("Module", MANGLING_MODULE_CLANG_IMPORTER);
      case "g": {
        const optionalType: SwiftNode | null = this.createType(
          this.createWithChildren(
            "BoundGenericEnum",
            this.createSwiftType("Enum", "Optional"),
            this.createWithChild("TypeList", this.popNodeKind("Type")),
          ),
        );
        this.addSubstitution(optionalType);
        return optionalType;
      }
      default: {
        this.pushBack(c);
        let repeatCount: number = this.demangleNatural();

        if (repeatCount > MAX_REPEAT_COUNT) {
          return null;
        }

        const secondLevel: boolean = this.nextIf("c");
        const node: SwiftNode | null = this.createStandardSubstitution(
          this.nextChar(),
          secondLevel,
        );

        if (!node) {
          return null;
        }

        while (repeatCount-- > 1) {
          this.pushNode(node);
        }

        return node;
      }
    }
  }

  private createStandardSubstitution(
    c: string,
    secondLevel: boolean,
  ): SwiftNode | null {
    const table: Record<string, [NodeKind, string]> = secondLevel
      ? CONCURRENCY_TYPES
      : STANDARD_TYPES;

    if (c === "" || !Object.prototype.hasOwnProperty.call(table, c)) {
      return null;
    }

    const entry: [NodeKind, string] = table[c] as [NodeKind, string];
    return this.createSwiftType(entry[0], entry[1]);
  }

  // Identifiers.

  private demangleIdentifier(): SwiftNode | null {
    let hasWordSubstitutions: boolean = false;
    const first: string = this.peekChar();

    if (!isDigit(first)) {
      return null;
    }

    if (first === "0") {
      this.nextChar();

      if (this.peekChar() === "0") {
        // Punycode: not read here.
        return fail();
      }

      hasWordSubstitutions = true;
    }

    let identifier: string = "";

    do {
      while (hasWordSubstitutions && isLetter(this.peekChar())) {
        const c: string = this.nextChar();
        let wordIndex: number = 0;

        if (isLowerLetter(c)) {
          wordIndex = c.charCodeAt(0) - 97;
        } else {
          wordIndex = c.charCodeAt(0) - 65;
          hasWordSubstitutions = false;
        }

        if (wordIndex >= this.words.length) {
          return null;
        }

        identifier += this.words[wordIndex] as string;

        if (identifier.length > MAX_IDENTIFIER_LENGTH) {
          return fail();
        }
      }

      if (this.nextIf("0")) {
        break;
      }

      const numChars: number = this.demangleNatural();

      if (numChars <= 0) {
        return null;
      }

      if (this.pos + numChars > this.text.length) {
        return null;
      }

      const slice: string = this.text.slice(this.pos, this.pos + numChars);
      identifier += slice;

      if (identifier.length > MAX_IDENTIFIER_LENGTH) {
        return fail();
      }

      // The words a later identifier may refer to, as the mangler found them.
      let wordStart: number = -1;

      for (let index: number = 0; index <= slice.length; index++) {
        const c: string = index < slice.length ? (slice[index] as string) : "";

        if (wordStart >= 0 && isWordEnd(c, slice[index - 1] as string)) {
          if (index - wordStart >= 2 && this.words.length < MAX_NUM_WORDS) {
            this.words.push(slice.slice(wordStart, index));
          }

          wordStart = -1;
        }

        if (wordStart < 0 && isWordStart(c)) {
          wordStart = index;
        }
      }

      this.pos += numChars;
    } while (hasWordSubstitutions);

    if (identifier === "") {
      return null;
    }

    const node: SwiftNode = this.createTextNode("Identifier", identifier);
    this.addSubstitution(node);
    return node;
  }

  private demangleOperatorIdentifier(): SwiftNode | null {
    const identifier: SwiftNode | null = this.popNodeKind("Identifier");

    if (!identifier) {
      return null;
    }

    const table: string = "& @/= >    <*!|+?%-~   ^ .";
    let operatorText: string = "";

    for (const c of identifier.text || "") {
      if (!isLowerLetter(c)) {
        return null;
      }

      const op: string = table[c.charCodeAt(0) - 97] as string;

      if (op === " ") {
        return null;
      }

      operatorText += op;
    }

    switch (this.nextChar()) {
      case "i":
        return this.createTextNode("InfixOperator", operatorText);
      case "p":
        return this.createTextNode("PrefixOperator", operatorText);
      case "P":
        return this.createTextNode("PostfixOperator", operatorText);
      default:
        return null;
    }
  }

  private demangleLocalIdentifier(): SwiftNode | null {
    if (this.nextIf("L")) {
      const discriminator: SwiftNode | null = this.popNodeKind("Identifier");
      const name: SwiftNode | null = this.popNodeIf(isDeclNameKind);
      return this.createWithChildren("PrivateDeclName", discriminator, name);
    }

    if (this.nextIf("l")) {
      const discriminator: SwiftNode | null = this.popNodeKind("Identifier");
      return this.createWithChild("PrivateDeclName", discriminator);
    }

    const c: string = this.peekChar();

    if ((c >= "a" && c <= "j") || (c >= "A" && c <= "J")) {
      // A related entity of an imported declaration: not read here.
      return fail();
    }

    const discriminator: SwiftNode | null = this.demangleIndexAsNode();
    const name: SwiftNode | null = this.popNodeIf(isDeclNameKind);
    return this.createWithChildren("LocalDeclName", discriminator, name);
  }

  // Contexts.

  private popModule(): SwiftNode | null {
    const identifier: SwiftNode | null = this.popNodeKind("Identifier");

    if (identifier) {
      return this.changeKind(identifier, "Module");
    }

    return this.popNodeKind("Module");
  }

  private popContext(): SwiftNode | null {
    const module: SwiftNode | null = this.popModule();

    if (module) {
      return module;
    }

    const type: SwiftNode | null = this.popNodeKind("Type");

    if (type) {
      if (type.children.length !== 1) {
        return null;
      }

      const child: SwiftNode = type.children[0] as SwiftNode;

      if (!CONTEXT_KINDS.has(child.kind)) {
        return null;
      }

      return child;
    }

    return this.popNodeIf((kind: NodeKind): boolean => {
      return CONTEXT_KINDS.has(kind);
    });
  }

  private popTypeAndGetChild(): SwiftNode | null {
    const type: SwiftNode | null = this.popNodeKind("Type");

    if (!type || type.children.length !== 1) {
      return null;
    }

    return type.children[0] as SwiftNode;
  }

  private popTypeAndGetAnyGeneric(): SwiftNode | null {
    const child: SwiftNode | null = this.popTypeAndGetChild();

    if (child && ANY_GENERIC_KINDS.has(child.kind)) {
      return child;
    }

    return null;
  }

  // Types.

  private demangleBuiltinType(): SwiftNode | null {
    let type: SwiftNode | null = null;
    const maxTypeSize: number = 4096;
    const c: string = this.nextChar();
    const named: string | undefined = Object.prototype.hasOwnProperty.call(
      BUILTIN_TYPE_NAMES,
      c,
    )
      ? BUILTIN_TYPE_NAMES[c]
      : undefined;

    if (named !== undefined) {
      return this.createType(this.createTextNode("BuiltinTypeName", named));
    }

    switch (c) {
      case "f": {
        const size: number = this.demangleIndex() - 1;

        if (size <= 0 || size > maxTypeSize) {
          return null;
        }

        type = this.createTextNode("BuiltinTypeName", `Builtin.FPIEEE${size}`);
        break;
      }
      case "i": {
        const size: number = this.demangleIndex() - 1;

        if (size <= 0 || size > maxTypeSize) {
          return null;
        }

        type = this.createTextNode("BuiltinTypeName", `Builtin.Int${size}`);
        break;
      }
      case "v": {
        const elements: number = this.demangleIndex() - 1;

        if (elements <= 0 || elements > maxTypeSize) {
          return null;
        }

        const elementType: SwiftNode | null = this.popTypeAndGetChild();

        if (
          !elementType ||
          elementType.kind !== "BuiltinTypeName" ||
          !(elementType.text || "").startsWith("Builtin.")
        ) {
          return null;
        }

        type = this.createTextNode(
          "BuiltinTypeName",
          `Builtin.Vec${elements}x${(elementType.text || "").slice(8)}`,
        );
        break;
      }
      default:
        // Fixed arrays, borrows and the tuple type: not read here.
        return fail();
    }

    return this.createType(type);
  }

  private demangleAnyGenericType(kind: NodeKind): SwiftNode | null {
    const name: SwiftNode | null = this.popNodeIf(isDeclNameKind);
    const context: SwiftNode | null = this.popContext();
    const type: SwiftNode | null = this.createType(
      this.createWithChildren(kind, context, name),
    );
    this.addSubstitution(type);
    return type;
  }

  private demangleExtensionContext(): SwiftNode | null {
    const genericSignature: SwiftNode | null = this.popNodeKind(
      "DependentGenericSignature",
    );
    const module: SwiftNode | null = this.popModule();
    const type: SwiftNode | null = this.popTypeAndGetAnyGeneric();
    let extension: SwiftNode | null = this.createWithChildren(
      "Extension",
      module,
      type,
    );

    if (genericSignature) {
      extension = this.addChild(extension, genericSignature);
    }

    return extension;
  }

  /*
   * The opaque return type nodes a declaration's type holds are, in the
   * real demangler, given the declaration's mangled name; it is never
   * printed, so it is left out here.
   */
  private demanglePlainFunction(): SwiftNode | null {
    const genericSignature: SwiftNode | null = this.popNodeKind(
      "DependentGenericSignature",
    );
    let type: SwiftNode | null = this.popFunctionType("FunctionType");
    const labelList: SwiftNode | null = this.popFunctionParamLabels(type);

    if (genericSignature) {
      type = this.createType(
        this.createWithChildren("DependentGenericType", genericSignature, type),
      );
    }

    const name: SwiftNode | null = this.popNodeIf(isDeclNameKind);
    const context: SwiftNode | null = this.popContext();

    return labelList
      ? this.createWithChildren("Function", context, name, labelList, type)
      : this.createWithChildren("Function", context, name, type);
  }

  private popFunctionType(kind: NodeKind): SwiftNode | null {
    let functionType: SwiftNode | null = this.createNode(kind);

    this.addChild(functionType, this.popNodeKind("SendingResultFunctionType"));
    this.addChild(
      functionType,
      this.popNodeIf((nodeKind: NodeKind): boolean => {
        return (
          nodeKind === "GlobalActorFunctionType" ||
          nodeKind === "IsolatedAnyFunctionType" ||
          nodeKind === "NonIsolatedCallerFunctionType"
        );
      }),
    );
    this.addChild(
      functionType,
      this.popNodeIf((nodeKind: NodeKind): boolean => {
        return (
          nodeKind === "ThrowsAnnotation" ||
          nodeKind === "TypedThrowsAnnotation"
        );
      }),
    );
    this.addChild(functionType, this.popNodeKind("ConcurrentFunctionType"));
    this.addChild(functionType, this.popNodeKind("AsyncAnnotation"));

    functionType = this.addChild(
      functionType,
      this.popFunctionParams("ArgumentTuple"),
    );
    functionType = this.addChild(
      functionType,
      this.popFunctionParams("ReturnType"),
    );

    return this.createType(functionType);
  }

  private popFunctionParams(kind: NodeKind): SwiftNode | null {
    let paramsType: SwiftNode | null = null;

    if (this.popNodeKind("EmptyList")) {
      paramsType = this.createType(this.createNode("Tuple"));
    } else {
      paramsType = this.popNodeKind("Type");
    }

    return this.createWithChild(kind, paramsType);
  }

  private popFunctionParamLabels(type: SwiftNode | null): SwiftNode | null {
    if (this.popNodeKind("EmptyList")) {
      return this.createNode("LabelList");
    }

    if (!type || type.kind !== "Type") {
      return null;
    }

    let functionType: SwiftNode | undefined = type.children[0];

    if (functionType && functionType.kind === "DependentGenericType") {
      functionType = functionType.children[1]?.children[0];
    }

    if (
      !functionType ||
      (functionType.kind !== "FunctionType" &&
        functionType.kind !== "NoEscapeFunctionType")
    ) {
      return null;
    }

    const skipped: Array<NodeKind> = [
      "SendingResultFunctionType",
      "GlobalActorFunctionType",
      "IsolatedAnyFunctionType",
      "NonIsolatedCallerFunctionType",
    ];
    let firstChildIndex: number = 0;

    for (const kind of skipped) {
      if (functionType.children[firstChildIndex]?.kind === kind) {
        firstChildIndex++;
      }
    }

    const throwsKind: NodeKind | undefined =
      functionType.children[firstChildIndex]?.kind;

    if (
      throwsKind === "ThrowsAnnotation" ||
      throwsKind === "TypedThrowsAnnotation"
    ) {
      firstChildIndex++;
    }

    if (
      functionType.children[firstChildIndex]?.kind === "ConcurrentFunctionType"
    ) {
      firstChildIndex++;
    }

    if (functionType.children[firstChildIndex]?.kind === "AsyncAnnotation") {
      firstChildIndex++;
    }

    const parameterType: SwiftNode | undefined =
      functionType.children[firstChildIndex];

    if (!parameterType || parameterType.kind !== "ArgumentTuple") {
      return fail();
    }

    const params: SwiftNode | undefined =
      parameterType.children[0]?.children[0];

    if (!params) {
      return fail();
    }

    const numParams: number =
      params.kind === "Tuple" ? params.children.length : 1;

    if (numParams === 0) {
      return null;
    }

    const labelList: SwiftNode = this.createNode("LabelList");
    let hasLabels: boolean = false;

    for (let index: number = 0; index < numParams; index++) {
      const label: SwiftNode | null = this.popNode();

      if (!label) {
        return null;
      }

      if (label.kind !== "Identifier" && label.kind !== "FirstElementMarker") {
        return null;
      }

      labelList.children.push(label);
      hasLabels = hasLabels || label.kind !== "FirstElementMarker";
    }

    if (!hasLabels) {
      return this.createNode("LabelList");
    }

    this.reverseChildren(labelList, 0);
    return labelList;
  }

  private popTuple(): SwiftNode | null {
    const root: SwiftNode = this.createNode("Tuple");

    if (!this.popNodeKind("EmptyList")) {
      let firstElement: boolean = false;

      do {
        firstElement = this.popNodeKind("FirstElementMarker") !== null;
        const element: SwiftNode = this.createNode("TupleElement");
        this.addChild(element, this.popNodeKind("VariadicMarker"));
        const identifier: SwiftNode | null = this.popNodeKind("Identifier");

        if (identifier) {
          element.children.push(
            this.createTextNode("TupleElementName", identifier.text || ""),
          );
        }

        const type: SwiftNode | null = this.popNodeKind("Type");

        if (!type) {
          return null;
        }

        element.children.push(type);
        root.children.push(element);
      } while (!firstElement);

      this.reverseChildren(root, 0);
    }

    return this.createType(root);
  }

  private popTypeList(): SwiftNode | null {
    const root: SwiftNode = this.createNode("TypeList");

    if (!this.popNodeKind("EmptyList")) {
      let firstElement: boolean = false;

      do {
        firstElement = this.popNodeKind("FirstElementMarker") !== null;
        const type: SwiftNode | null = this.popNodeKind("Type");

        if (!type) {
          return null;
        }

        root.children.push(type);
      } while (!firstElement);

      this.reverseChildren(root, 0);
    }

    return root;
  }

  private popProtocol(): SwiftNode | null {
    const type: SwiftNode | null = this.popNodeKind("Type");

    if (type) {
      if (type.children.length < 1) {
        return null;
      }

      if (!isProtocolNode(type)) {
        return null;
      }

      return type;
    }

    const name: SwiftNode | null = this.popNodeIf(isDeclNameKind);
    const context: SwiftNode | null = this.popContext();
    return this.createType(this.createWithChildren("Protocol", context, name));
  }

  private demangleBoundGenerics(typeLists: Array<SwiftNode>): boolean {
    for (;;) {
      const typeList: SwiftNode = this.createNode("TypeList");
      typeLists.push(typeList);

      for (;;) {
        const type: SwiftNode | null = this.popNodeKind("Type");

        if (!type) {
          break;
        }

        typeList.children.push(type);
      }

      this.reverseChildren(typeList, 0);

      if (this.popNodeKind("EmptyList")) {
        break;
      }

      if (!this.popNodeKind("FirstElementMarker")) {
        return false;
      }
    }

    return true;
  }

  private demangleBoundGenericType(): SwiftNode | null {
    const typeLists: Array<SwiftNode> = [];

    if (!this.demangleBoundGenerics(typeLists)) {
      return null;
    }

    const nominal: SwiftNode | null = this.popTypeAndGetAnyGeneric();

    if (!nominal) {
      return null;
    }

    const bound: SwiftNode | null = this.demangleBoundGenericArgs(
      nominal,
      typeLists,
      0,
    );

    if (!bound) {
      return null;
    }

    const type: SwiftNode | null = this.createType(bound);
    this.addSubstitution(type);
    return type;
  }

  private demangleBoundGenericArgs(
    nominalNode: SwiftNode | null,
    typeLists: Array<SwiftNode>,
    typeListIndexStart: number,
  ): SwiftNode | null {
    let nominal: SwiftNode | null = nominalNode;
    let typeListIndex: number = typeListIndexStart;

    if (!nominal) {
      return null;
    }

    if (typeListIndex >= typeLists.length) {
      return null;
    }

    if (nominal.children.length === 0) {
      return null;
    }

    const context: SwiftNode = nominal.children[0] as SwiftNode;
    const consumesGenericArgs: boolean = !NON_CONSUMING_GENERIC_ARGS_KINDS.has(
      nominal.kind,
    );
    const args: SwiftNode = typeLists[typeListIndex] as SwiftNode;

    if (consumesGenericArgs) {
      typeListIndex++;
    }

    if (typeListIndex < typeLists.length) {
      let boundParent: SwiftNode | null = null;

      if (context.kind === "Extension") {
        boundParent = this.demangleBoundGenericArgs(
          context.children[1] || null,
          typeLists,
          typeListIndex,
        );
        boundParent = this.createWithChildren(
          "Extension",
          context.children[0] || null,
          boundParent,
        );

        if (context.children.length === 3) {
          this.addChild(boundParent, context.children[2] || null);
        }
      } else {
        boundParent = this.demangleBoundGenericArgs(
          context,
          typeLists,
          typeListIndex,
        );
      }

      const newNominal: SwiftNode | null = this.createWithChild(
        nominal.kind,
        boundParent,
      );

      if (!newNominal) {
        return null;
      }

      for (let index: number = 1; index < nominal.children.length; index++) {
        this.addChild(newNominal, nominal.children[index] || null);
      }

      nominal = newNominal;
    }

    if (!consumesGenericArgs) {
      return nominal;
    }

    if (args.children.length === 0) {
      return nominal;
    }

    let kind: NodeKind;

    switch (nominal.kind) {
      case "Class":
        kind = "BoundGenericClass";
        break;
      case "Structure":
        kind = "BoundGenericStructure";
        break;
      case "Enum":
        kind = "BoundGenericEnum";
        break;
      case "Protocol":
        kind = "BoundGenericProtocol";
        break;
      case "TypeAlias":
        kind = "BoundGenericTypeAlias";
        break;
      case "Function":
      case "Constructor":
        return this.createWithChildren("BoundGenericFunction", nominal, args);
      default:
        return null;
    }

    return this.createWithChildren(kind, this.createType(nominal), args);
  }

  private demangleMetatype(): SwiftNode | null {
    switch (this.nextChar()) {
      case "a":
        return this.createWithChild(
          "TypeMetadataAccessFunction",
          this.popNodeKind("Type"),
        );
      case "i":
        return this.createWithChild(
          "TypeMetadataInstantiationFunction",
          this.popNodeKind("Type"),
        );
      case "r":
        return this.createWithChild(
          "TypeMetadataCompletionFunction",
          this.popNodeKind("Type"),
        );
      case "u":
        return this.createWithChild(
          "MethodLookupFunction",
          this.popNodeKind("Type"),
        );
      default:
        // Metadata records and descriptors are data, not code.
        return fail();
    }
  }

  private demangleArchetype(): SwiftNode | null {
    switch (this.nextChar()) {
      case "O": {
        const definingContext: SwiftNode | null = this.popContext();
        return this.createWithChild("OpaqueReturnTypeOf", definingContext);
      }
      case "o": {
        const index: number = this.demangleIndex();

        if (index < 0) {
          return fail();
        }

        const boundGenericArgs: Array<SwiftNode> = [];

        if (!this.demangleBoundGenerics(boundGenericArgs)) {
          return null;
        }

        const name: SwiftNode | null = this.popNode();

        if (!name) {
          return null;
        }

        const opaque: SwiftNode | null = this.createWithChildren(
          "OpaqueType",
          name,
          this.createIndexNode("Index", index),
        );
        const boundGenerics: SwiftNode = this.createNode("TypeList");

        for (let i: number = boundGenericArgs.length - 1; i >= 0; i--) {
          boundGenerics.children.push(boundGenericArgs[i] as SwiftNode);
        }

        this.addChild(opaque, boundGenerics);
        const opaqueType: SwiftNode | null = this.createType(opaque);
        this.addSubstitution(opaqueType);
        return opaqueType;
      }
      case "r":
        return this.createType(this.createNode("OpaqueReturnType"));
      case "R": {
        const ordinal: number = this.demangleIndex();

        if (ordinal < 0) {
          return null;
        }

        return this.createType(
          this.createWithChild(
            "OpaqueReturnType",
            this.createIndexNode("OpaqueReturnTypeIndex", ordinal),
          ),
        );
      }
      case "x": {
        const type: SwiftNode | null = this.demangleAssociatedTypeSimple(null);
        this.addSubstitution(type);
        return type;
      }
      case "X": {
        const type: SwiftNode | null =
          this.demangleAssociatedTypeCompound(null);
        this.addSubstitution(type);
        return type;
      }
      case "y": {
        const type: SwiftNode | null = this.demangleAssociatedTypeSimple(
          this.demangleGenericParamIndex(),
        );
        this.addSubstitution(type);
        return type;
      }
      case "Y": {
        const type: SwiftNode | null = this.demangleAssociatedTypeCompound(
          this.demangleGenericParamIndex(),
        );
        this.addSubstitution(type);
        return type;
      }
      case "z": {
        const type: SwiftNode | null = this.demangleAssociatedTypeSimple(
          this.getDependentGenericParamType(0, 0),
        );
        this.addSubstitution(type);
        return type;
      }
      case "Z": {
        const type: SwiftNode | null = this.demangleAssociatedTypeCompound(
          this.getDependentGenericParamType(0, 0),
        );
        this.addSubstitution(type);
        return type;
      }
      default:
        // Packs and associated type references: not read here.
        return fail();
    }
  }

  private demangleAssociatedTypeSimple(
    base: SwiftNode | null,
  ): SwiftNode | null {
    const associatedTypeName: SwiftNode | null = this.popAssocTypeName();
    const baseType: SwiftNode | null = base
      ? this.createType(base)
      : this.popNodeKind("Type");
    return this.createType(
      this.createWithChildren(
        "DependentMemberType",
        baseType,
        associatedTypeName,
      ),
    );
  }

  private demangleAssociatedTypeCompound(
    base: SwiftNode | null,
  ): SwiftNode | null {
    const names: Array<SwiftNode> = [];
    let firstElement: boolean = false;

    do {
      firstElement = this.popNodeKind("FirstElementMarker") !== null;
      const name: SwiftNode | null = this.popAssocTypeName();

      if (!name) {
        return null;
      }

      names.push(name);
    } while (!firstElement);

    let baseType: SwiftNode | null = base
      ? this.createType(base)
      : this.popNodeKind("Type");

    for (;;) {
      const name: SwiftNode | undefined = names.pop();

      if (!name) {
        break;
      }

      let dependent: SwiftNode | null = this.createNode("DependentMemberType");
      dependent = this.addChild(dependent, baseType);
      baseType = this.createType(this.addChild(dependent, name));
    }

    return baseType;
  }

  private popAssocTypeName(): SwiftNode | null {
    const protocol: SwiftNode | null = this.popNodeKind("Type");

    if (protocol && !isProtocolNode(protocol)) {
      return null;
    }

    const identifier: SwiftNode | null = this.popNodeKind("Identifier");
    const associatedType: SwiftNode | null = this.createWithChild(
      "DependentAssociatedTypeRef",
      identifier,
    );
    this.addChild(associatedType, protocol);
    return associatedType;
  }

  private getDependentGenericParamType(
    depth: number,
    index: number,
  ): SwiftNode | null {
    if (depth < 0 || index < 0) {
      return null;
    }

    const param: SwiftNode = this.createNode("DependentGenericParamType");
    param.children.push(this.createIndexNode("Index", depth));
    param.children.push(this.createIndexNode("Index", index));
    return param;
  }

  private demangleGenericParamIndex(): SwiftNode | null {
    if (this.nextIf("d")) {
      const depth: number = this.demangleIndex() + 1;
      const index: number = this.demangleIndex();
      return this.getDependentGenericParamType(depth, index);
    }

    if (this.nextIf("z")) {
      return this.getDependentGenericParamType(0, 0);
    }

    if (this.peekChar() === "s") {
      // A constrained existential's Self: not read here.
      return fail();
    }

    return this.getDependentGenericParamType(0, this.demangleIndex() + 1);
  }

  private popProtocolConformance(): SwiftNode | null {
    const genericSignature: SwiftNode | null = this.popNodeKind(
      "DependentGenericSignature",
    );
    const module: SwiftNode | null = this.popModule();
    const protocol: SwiftNode | null = this.popProtocol();
    let type: SwiftNode | null = this.popNodeKind("Type");

    if (!type) {
      // A property behavior's conformance: not read here.
      return fail();
    }

    if (genericSignature) {
      type = this.createType(
        this.createWithChildren("DependentGenericType", genericSignature, type),
      );
    }

    return this.createWithChildren(
      "ProtocolConformance",
      type,
      protocol,
      module,
    );
  }

  private demangleThunkOrSpecialization(): SwiftNode | null {
    const c: string = this.nextChar();

    switch (c) {
      case "c":
        return this.createWithChild(
          "CurryThunk",
          this.popNodeIf((kind: NodeKind): boolean => {
            return isEntity(kind);
          }),
        );
      case "j":
        return this.createWithChild(
          "DispatchThunk",
          this.popNodeIf((kind: NodeKind): boolean => {
            return isEntity(kind);
          }),
        );
      case "o":
        return this.createNode("ObjCAttribute");
      case "O":
        return this.createNode("NonObjCAttribute");
      case "D":
        return this.createNode("DynamicAttribute");
      case "d":
        return this.createNode("DirectMethodReferenceAttribute");
      case "a":
        return this.createNode("PartialApplyObjCForwarder");
      case "A":
        return this.createNode("PartialApplyForwarder");
      case "m":
        return this.createNode("MergedFunction");
      case "Y":
      case "Q": {
        const discriminator: SwiftNode | null = this.demangleIndexAsNode();
        return this.createWithChild(
          c === "Q"
            ? "AsyncAwaitResumePartialFunction"
            : "AsyncSuspendResumePartialFunction",
          discriminator,
        );
      }
      case "W": {
        const entity: SwiftNode | null = this.popNodeIf(
          (kind: NodeKind): boolean => {
            return isEntity(kind);
          },
        );
        const conformance: SwiftNode | null = this.popProtocolConformance();
        return this.createWithChildren("ProtocolWitness", conformance, entity);
      }
      case "g":
        return this.demangleGenericSpecialization(
          "GenericSpecialization",
          null,
        );
      case "G":
        return this.demangleGenericSpecialization(
          "GenericSpecializationNotReAbstracted",
          null,
        );
      case "B":
        return this.demangleGenericSpecialization(
          "GenericSpecializationInResilienceDomain",
          null,
        );
      case "t":
        return this.demangleGenericSpecializationWithDroppedArguments(c);
      case "s":
        return this.demangleGenericSpecialization(
          "GenericSpecializationPrespecialized",
          null,
        );
      case "i":
        return this.demangleGenericSpecialization(
          "InlinedGenericFunction",
          null,
        );
      case "p":
      case "P": {
        const specialization: SwiftNode | null = this.demangleSpecAttributes(
          c === "p"
            ? "GenericPartialSpecialization"
            : "GenericPartialSpecializationNotReAbstracted",
        );
        const param: SwiftNode | null = this.createWithChild(
          "GenericSpecializationParam",
          this.popNodeKind("Type"),
        );
        return this.addChild(specialization, param);
      }
      case "f":
        return this.demangleFunctionSpecialization();
      case "K":
      case "k":
        return this.demangleKeyPathThunkHelper(c);
      default:
        // Reabstraction and other thunks, descriptors: not read here.
        return fail();
    }
  }

  private demangleKeyPathThunkHelper(c: string): SwiftNode | null {
    let kind: NodeKind;

    if (this.nextIf("mu")) {
      kind = "KeyPathUnappliedMethodThunkHelper";
    } else if (this.nextIf("MA")) {
      kind = "KeyPathAppliedMethodThunkHelper";
    } else {
      kind =
        c === "K" ? "KeyPathGetterThunkHelper" : "KeyPathSetterThunkHelper";
    }

    const isSerialized: boolean = this.nextIf("q");
    const types: Array<SwiftNode> = [];
    let node: SwiftNode | null = this.popNode();

    if (!node || node.kind !== "Type") {
      return null;
    }

    do {
      types.push(node);
      node = this.popNode();
    } while (node && node.kind === "Type");

    if (!node) {
      return null;
    }

    let result: SwiftNode | null = null;

    if (node.kind === "DependentGenericSignature") {
      const declaration: SwiftNode | null = this.popNode();

      if (!declaration) {
        return null;
      }

      result = this.createWithChildren(kind, declaration, node);
    } else {
      result = this.createWithChild(kind, node);
    }

    if (!result) {
      return null;
    }

    for (let index: number = types.length - 1; index >= 0; index--) {
      result.children.push(types[index] as SwiftNode);
    }

    if (isSerialized) {
      result.children.push(this.createNode("IsSerialized"));
    }

    return result;
  }

  private demangleGenericSpecialization(
    kind: NodeKind,
    droppedArguments: SwiftNode | null,
  ): SwiftNode | null {
    const specialization: SwiftNode | null = this.demangleSpecAttributes(kind);

    if (!specialization) {
      return null;
    }

    if (droppedArguments) {
      for (const argument of droppedArguments.children) {
        specialization.children.push(argument);
      }
    }

    const typeList: SwiftNode | null = this.popTypeList();

    if (!typeList) {
      return null;
    }

    for (const type of typeList.children) {
      specialization.children.push(
        this.createWithChild("GenericSpecializationParam", type) as SwiftNode,
      );
    }

    return specialization;
  }

  private demangleGenericSpecializationWithDroppedArguments(
    c: string,
  ): SwiftNode | null {
    this.pushBack(c);
    const dropped: SwiftNode = this.createNode("GenericSpecialization");

    while (this.nextIf("t")) {
      const n: number = this.demangleNatural();
      dropped.children.push(
        this.createIndexNode("DroppedArgument", n < 0 ? 0 : n + 1),
      );
    }

    let kind: NodeKind;

    switch (this.nextChar()) {
      case "g":
        kind = "GenericSpecialization";
        break;
      case "G":
        kind = "GenericSpecializationNotReAbstracted";
        break;
      case "B":
        kind = "GenericSpecializationInResilienceDomain";
        break;
      default:
        return null;
    }

    return this.demangleGenericSpecialization(kind, dropped);
  }

  private demangleFunctionSpecialization(): SwiftNode | null {
    let specialization: SwiftNode | null = this.demangleSpecAttributes(
      "FunctionSignatureSpecialization",
    );

    if (
      specialization &&
      specialization.children[0]?.kind === "RepresentationChanged"
    ) {
      return specialization;
    }

    while (specialization && !this.nextIf("_")) {
      specialization = this.addChild(
        specialization,
        this.demangleFuncSpecParam("FunctionSignatureSpecializationParam"),
      );
    }

    if (!this.nextIf("n")) {
      specialization = this.addChild(
        specialization,
        this.demangleFuncSpecParam("FunctionSignatureSpecializationReturn"),
      );
    }

    if (!specialization) {
      return null;
    }

    // The parameters' identifiers and types, popped in reverse order.
    const count: number = specialization.children.length;

    for (let index: number = 0; index < count; index++) {
      const param: SwiftNode = specialization.children[
        count - index - 1
      ] as SwiftNode;

      if (param.kind !== "FunctionSignatureSpecializationParam") {
        continue;
      }

      const fixedChildren: number = param.children.length;
      let paramToAdd: SwiftNode | null = param;

      for (
        let childIndex: number = 0;
        childIndex < fixedChildren;
        childIndex++
      ) {
        const kindNode: SwiftNode = param.children[
          fixedChildren - childIndex - 1
        ] as SwiftNode;

        if (kindNode.kind !== "FunctionSignatureSpecializationParamKind") {
          continue;
        }

        const paramKind: number = kindNode.index as number;

        if (paramKind === SPEC_CLOSURE_PROP) {
          for (;;) {
            const type: SwiftNode | null = this.popNodeKind("Type");

            if (!type) {
              break;
            }

            paramToAdd = this.addChild(paramToAdd, type);
          }
        } else if (paramKind === SPEC_CONSTANT_PROP_KEY_PATH) {
          const first: SwiftNode | null = this.popNodeKind("Type");
          paramToAdd = this.addChild(paramToAdd, first);
          const second: SwiftNode | null = this.popNodeKind("Type");
          paramToAdd = this.addChild(paramToAdd, second);
        } else if (paramKind === SPEC_CONSTANT_PROP_STRUCT) {
          const type: SwiftNode | null = this.popNodeKind("Type");
          paramToAdd = this.addChild(paramToAdd, type);
          continue;
        } else if (
          paramKind !== SPEC_CONSTANT_PROP_FUNCTION &&
          paramKind !== SPEC_CONSTANT_PROP_GLOBAL &&
          paramKind !== SPEC_CONSTANT_PROP_STRING
        ) {
          continue;
        }

        const identifier: SwiftNode | null = this.popNodeKind("Identifier");
        paramToAdd = this.addChild(paramToAdd, identifier);
      }

      if (!paramToAdd) {
        return null;
      }

      this.reverseChildren(param, fixedChildren);
    }

    return specialization;
  }

  private createParamKind(param: SwiftNode, value: number): SwiftNode {
    param.children.push(
      this.createIndexNode("FunctionSignatureSpecializationParamKind", value),
    );
    return param;
  }

  private demangleFuncSpecParam(kind: NodeKind): SwiftNode | null {
    const param: SwiftNode = this.createNode(kind);

    switch (this.nextChar()) {
      case "n":
        return param;
      case "c":
        return this.createParamKind(param, SPEC_CLOSURE_PROP);
      case "C": {
        this.createParamKind(param, SPEC_CLOSURE_PROP_PREVIOUS_ARG);
        const previousArgumentIndex: number = this.demangleNatural();

        if (previousArgumentIndex < 0) {
          return null;
        }

        param.children.push(
          this.createIndexNode(
            "FunctionSignatureSpecializationParamPayload",
            previousArgumentIndex,
          ),
        );
        return param;
      }
      case "p":
        for (;;) {
          const c: string = this.nextChar();

          switch (c) {
            case "S":
              this.createParamKind(param, SPEC_CONSTANT_PROP_STRUCT);
              break;
            case "f":
              this.createParamKind(param, SPEC_CONSTANT_PROP_FUNCTION);
              break;
            case "g":
              this.createParamKind(param, SPEC_CONSTANT_PROP_GLOBAL);
              break;
            case "i":
              if (
                !this.addFuncSpecParamNumber(param, SPEC_CONSTANT_PROP_INTEGER)
              ) {
                return null;
              }
              break;
            case "d":
              if (
                !this.addFuncSpecParamNumber(param, SPEC_CONSTANT_PROP_FLOAT)
              ) {
                return null;
              }
              break;
            case "s": {
              let encoding: string;

              switch (this.nextChar()) {
                case "b":
                  encoding = "u8";
                  break;
                case "w":
                  encoding = "u16";
                  break;
                case "c":
                  encoding = "objc";
                  break;
                default:
                  return null;
              }

              this.createParamKind(param, SPEC_CONSTANT_PROP_STRING);
              param.children.push(
                this.createTextNode(
                  "FunctionSignatureSpecializationParamPayload",
                  encoding,
                ),
              );
              break;
            }
            case "k":
              this.createParamKind(param, SPEC_CONSTANT_PROP_KEY_PATH);
              break;
            default:
              this.pushBack(c);
              return param;
          }
        }
      case "e": {
        let value: number = SPEC_EXISTENTIAL_TO_GENERIC;

        if (this.nextIf("D")) {
          value |= SPEC_DEAD;
        }

        if (this.nextIf("G")) {
          value |= SPEC_OWNED_TO_GUARANTEED;
        }

        if (this.nextIf("O")) {
          value |= SPEC_GUARANTEED_TO_OWNED;
        }

        if (this.nextIf("X")) {
          value |= SPEC_SROA;
        }

        return this.createParamKind(param, value);
      }
      case "d": {
        let value: number = SPEC_DEAD;

        if (this.nextIf("G")) {
          value |= SPEC_OWNED_TO_GUARANTEED;
        }

        if (this.nextIf("O")) {
          value |= SPEC_GUARANTEED_TO_OWNED;
        }

        if (this.nextIf("X")) {
          value |= SPEC_SROA;
        }

        return this.createParamKind(param, value);
      }
      case "g": {
        let value: number = SPEC_OWNED_TO_GUARANTEED;

        if (this.nextIf("X")) {
          value |= SPEC_SROA;
        }

        return this.createParamKind(param, value);
      }
      case "o": {
        let value: number = SPEC_GUARANTEED_TO_OWNED;

        if (this.nextIf("X")) {
          value |= SPEC_SROA;
        }

        return this.createParamKind(param, value);
      }
      case "x":
        return this.createParamKind(param, SPEC_SROA);
      case "i":
        return this.createParamKind(param, SPEC_BOX_TO_VALUE);
      case "s":
        return this.createParamKind(param, SPEC_BOX_TO_STACK);
      case "r":
        return this.createParamKind(param, SPEC_INOUT_TO_OUT);
      default:
        // Escaping and differentiable closure propagation: not read here.
        return fail();
    }
  }

  private addFuncSpecParamNumber(param: SwiftNode, kind: number): boolean {
    this.createParamKind(param, kind);
    let digits: string = "";

    while (isDigit(this.peekChar())) {
      digits += this.nextChar();
    }

    if (digits === "") {
      return false;
    }

    param.children.push(
      this.createTextNode(
        "FunctionSignatureSpecializationParamPayload",
        digits,
      ),
    );
    return true;
  }

  private demangleSpecAttributes(kind: NodeKind): SwiftNode | null {
    const isSerialized: boolean = this.nextIf("q");
    const asyncRemoved: boolean = this.nextIf("a");
    const representationChanged: boolean = this.nextIf("r");
    const passCharacter: string = this.nextChar();

    if (!isDigit(passCharacter)) {
      return null;
    }

    const passId: number = passCharacter.charCodeAt(0) - 48;

    if (passId >= MAX_SPECIALIZATION_PASS) {
      return null;
    }

    const specialization: SwiftNode = this.createNode(kind);

    if (isSerialized) {
      specialization.children.push(this.createNode("IsSerialized"));
    }

    if (asyncRemoved) {
      specialization.children.push(this.createNode("AsyncRemoved"));
    }

    if (representationChanged) {
      specialization.children.push(this.createNode("RepresentationChanged"));
    }

    specialization.children.push(
      this.createIndexNode("SpecializationPassID", passId),
    );
    return specialization;
  }

  private demangleWitness(): SwiftNode | null {
    switch (this.nextChar()) {
      case "O":
        return this.demangleOutlinedValueOperation();
      case "l": {
        const conformance: SwiftNode | null = this.popProtocolConformance();
        const type: SwiftNode | null = this.popNodeKind("Type");
        return this.createWithChildren(
          "LazyProtocolWitnessTableAccessor",
          type,
          conformance,
        );
      }
      case "b": {
        const protocolType: SwiftNode | null = this.popNodeKind("Type");
        const conformance: SwiftNode | null = this.popProtocolConformance();
        return this.createWithChildren(
          "BaseWitnessTableAccessor",
          conformance,
          protocolType,
        );
      }
      case "Z": {
        const declList: SwiftNode = this.createNode(
          "GlobalVariableOnceDeclList",
        );
        const variables: Array<SwiftNode> = [];

        while (this.popNodeKind("FirstElementMarker")) {
          const identifier: SwiftNode | null = this.popNodeIf(isDeclNameKind);

          if (!identifier) {
            return null;
          }

          variables.push(identifier);
        }

        for (let index: number = variables.length - 1; index >= 0; index--) {
          declList.children.push(variables[index] as SwiftNode);
        }

        const context: SwiftNode | null = this.popContext();

        if (!context) {
          return null;
        }

        return this.createWithChildren(
          "GlobalVariableOnceFunction",
          context,
          declList,
        );
      }
      default:
        // Witness tables, field offsets and tokens are data, not code.
        return fail();
    }
  }

  private demangleOutlinedValueOperation(): SwiftNode | null {
    const kinds: Record<string, NodeKind> = {
      B: "OutlinedInitializeWithTakeNoValueWitness",
      C: "OutlinedInitializeWithCopyNoValueWitness",
      D: "OutlinedAssignWithTakeNoValueWitness",
      F: "OutlinedAssignWithCopyNoValueWitness",
      H: "OutlinedDestroyNoValueWitness",
      y: "OutlinedCopy",
      e: "OutlinedConsume",
      r: "OutlinedRetain",
      s: "OutlinedRelease",
      b: "OutlinedInitializeWithTake",
      c: "OutlinedInitializeWithCopy",
      d: "OutlinedAssignWithTake",
      f: "OutlinedAssignWithCopy",
      h: "OutlinedDestroy",
    };
    const c: string = this.nextChar();

    if (c === "" || !Object.prototype.hasOwnProperty.call(kinds, c)) {
      // Outlined enum operations: not read here.
      return fail();
    }

    const kind: NodeKind = kinds[c] as NodeKind;
    const genericSignature: SwiftNode | null = this.popNodeKind(
      "DependentGenericSignature",
    );

    if (genericSignature) {
      return this.createWithChildren(
        kind,
        this.popNodeKind("Type"),
        genericSignature,
      );
    }

    return this.createWithChild(kind, this.popNodeKind("Type"));
  }

  private demangleSpecialType(): SwiftNode | null {
    switch (this.nextChar()) {
      case "E":
        return this.popFunctionType("NoEscapeFunctionType");
      case "A":
        return this.popFunctionType("EscapingAutoClosureType");
      case "f":
        return this.popFunctionType("ThinFunctionType");
      case "K":
        return this.popFunctionType("AutoClosureType");
      case "U":
        return this.popFunctionType("UncurriedFunctionType");
      case "L":
        return this.popFunctionType("EscapingObjCBlock");
      case "B":
        return this.popFunctionType("ObjCBlock");
      case "C":
        return this.popFunctionType("CFunctionPointer");
      case "o":
        return this.createType(
          this.createWithChild("Unowned", this.popNodeKind("Type")),
        );
      case "u":
        return this.createType(
          this.createWithChild("Unmanaged", this.popNodeKind("Type")),
        );
      case "w":
        return this.createType(
          this.createWithChild("Weak", this.popNodeKind("Type")),
        );
      case "D":
        return this.createType(
          this.createWithChild("DynamicSelf", this.popNodeKind("Type")),
        );
      case "M": {
        const representation: SwiftNode | null =
          this.demangleMetatypeRepresentation();
        const type: SwiftNode | null = this.popNodeKind("Type");
        return this.createType(
          this.createWithChildren("Metatype", representation, type),
        );
      }
      case "m": {
        const representation: SwiftNode | null =
          this.demangleMetatypeRepresentation();
        const type: SwiftNode | null = this.popNodeKind("Type");
        return this.createType(
          this.createWithChildren("ExistentialMetatype", representation, type),
        );
      }
      case "p":
        return this.createType(
          this.createWithChild("ExistentialMetatype", this.popNodeKind("Type")),
        );
      case "c": {
        const superclass: SwiftNode | null = this.popNodeKind("Type");
        const protocols: SwiftNode | null = this.demangleProtocolList();
        return this.createType(
          this.createWithChildren(
            "ProtocolListWithClass",
            protocols,
            superclass,
          ),
        );
      }
      case "l": {
        const protocols: SwiftNode | null = this.demangleProtocolList();
        return this.createType(
          this.createWithChild("ProtocolListWithAnyObject", protocols),
        );
      }
      default:
        // SIL boxes, yields, shapes, sugar and the rest: not read here.
        return fail();
    }
  }

  private demangleMetatypeRepresentation(): SwiftNode | null {
    switch (this.nextChar()) {
      case "t":
        return this.createTextNode("MetatypeRepresentation", "@thin");
      case "T":
        return this.createTextNode("MetatypeRepresentation", "@thick");
      case "o":
        return this.createTextNode("MetatypeRepresentation", "@objc_metatype");
      default:
        return null;
    }
  }

  private demangleTypeAnnotation(): SwiftNode | null {
    switch (this.nextChar()) {
      case "a":
        return this.createNode("AsyncAnnotation");
      case "A":
        return this.createNode("IsolatedAnyFunctionType");
      case "b":
        return this.createNode("ConcurrentFunctionType");
      case "c":
        return this.createWithChild(
          "GlobalActorFunctionType",
          this.popTypeAndGetChild(),
        );
      case "C":
        return this.createNode("NonIsolatedCallerFunctionType");
      case "i":
        return this.createType(
          this.createWithChild("Isolated", this.popTypeAndGetChild()),
        );
      case "K":
        return this.createWithChild(
          "TypedThrowsAnnotation",
          this.popTypeAndGetChild(),
        );
      case "T":
        return this.createNode("SendingResultFunctionType");
      case "u":
        return this.createType(
          this.createWithChild("Sending", this.popTypeAndGetChild()),
        );
      default:
        // Differentiability and compile-time values: not read here.
        return fail();
    }
  }

  private demangleAccessor(child: SwiftNode | null): SwiftNode | null {
    let kind: NodeKind;

    switch (this.nextChar()) {
      case "m":
        kind = "MaterializeForSet";
        break;
      case "s":
        kind = "Setter";
        break;
      case "g":
        kind = "Getter";
        break;
      case "G":
        kind = "GlobalGetter";
        break;
      case "w":
        kind = "WillSet";
        break;
      case "W":
        kind = "DidSet";
        break;
      case "r":
        kind = "ReadAccessor";
        break;
      case "M":
        kind = "ModifyAccessor";
        break;
      case "i":
        kind = "InitAccessor";
        break;
      case "a":
        switch (this.nextChar()) {
          case "O":
            kind = "OwningMutableAddressor";
            break;
          case "o":
            kind = "NativeOwningMutableAddressor";
            break;
          case "P":
            kind = "NativePinningMutableAddressor";
            break;
          case "u":
            kind = "UnsafeMutableAddressor";
            break;
          default:
            return null;
        }
        break;
      case "l":
        switch (this.nextChar()) {
          case "O":
            kind = "OwningAddressor";
            break;
          case "o":
            kind = "NativeOwningAddressor";
            break;
          case "p":
            kind = "NativePinningAddressor";
            break;
          case "u":
            kind = "UnsafeAddressor";
            break;
          default:
            return null;
        }
        break;
      case "p":
        // The variable or subscript itself.
        return child;
      case "y":
      case "x":
      case "b":
      case "z":
        // The yielding and borrow accessors print differently by version.
        return fail();
      default:
        return null;
    }

    return this.createWithChild(kind, child);
  }

  private demangleFunctionEntity(): SwiftNode | null {
    type Args = "None" | "TypeAndMaybePrivateName" | "TypeAndIndex" | "Index";
    let args: Args;
    let kind: NodeKind;

    switch (this.nextChar()) {
      case "D":
        args = "None";
        kind = "Deallocator";
        break;
      case "d":
        args = "None";
        kind = "Destructor";
        break;
      case "Z":
        args = "None";
        kind = "IsolatedDeallocator";
        break;
      case "E":
        args = "None";
        kind = "IVarDestroyer";
        break;
      case "e":
        args = "None";
        kind = "IVarInitializer";
        break;
      case "i":
        args = "None";
        kind = "Initializer";
        break;
      case "C":
        args = "TypeAndMaybePrivateName";
        kind = "Allocator";
        break;
      case "c":
        args = "TypeAndMaybePrivateName";
        kind = "Constructor";
        break;
      case "U":
        args = "TypeAndIndex";
        kind = "ExplicitClosure";
        break;
      case "u":
        args = "TypeAndIndex";
        kind = "ImplicitClosure";
        break;
      case "A":
        args = "Index";
        kind = "DefaultArgumentInitializer";
        break;
      case "P":
        args = "None";
        kind = "PropertyWrapperBackingInitializer";
        break;
      case "F":
        args = "None";
        kind = "PropertyWrappedFieldInitAccessor";
        break;
      case "W":
        args = "None";
        kind = "PropertyWrapperInitFromProjectedValue";
        break;
      default:
        // Macros and generic parameter declarations: not read here.
        return fail();
    }

    let nameOrIndex: SwiftNode | null = null;
    let paramType: SwiftNode | null = null;
    let labelList: SwiftNode | null = null;

    switch (args) {
      case "TypeAndMaybePrivateName":
        nameOrIndex = this.popNodeKind("PrivateDeclName");
        paramType = this.popNodeKind("Type");
        labelList = this.popFunctionParamLabels(paramType);
        break;
      case "TypeAndIndex":
        nameOrIndex = this.demangleIndexAsNode();
        paramType = this.popNodeKind("Type");
        break;
      case "Index":
        nameOrIndex = this.demangleIndexAsNode();
        break;
      case "None":
        break;
    }

    let entity: SwiftNode | null = this.createWithChild(
      kind,
      this.popContext(),
    );

    switch (args) {
      case "Index":
        entity = this.addChild(entity, nameOrIndex);
        break;
      case "TypeAndMaybePrivateName":
        this.addChild(entity, labelList);
        entity = this.addChild(entity, paramType);
        this.addChild(entity, nameOrIndex);
        break;
      case "TypeAndIndex":
        entity = this.addChild(entity, nameOrIndex);
        entity = this.addChild(entity, paramType);
        break;
      case "None":
        break;
    }

    return entity;
  }

  private demangleEntity(kind: NodeKind): SwiftNode | null {
    const type: SwiftNode | null = this.popNodeKind("Type");
    const labelList: SwiftNode | null = this.popFunctionParamLabels(type);
    const name: SwiftNode | null = this.popNodeIf(isDeclNameKind);
    const context: SwiftNode | null = this.popContext();

    return labelList
      ? this.createWithChildren(kind, context, name, labelList, type)
      : this.createWithChildren(kind, context, name, type);
  }

  private demangleSubscript(): SwiftNode | null {
    const privateName: SwiftNode | null = this.popNodeKind("PrivateDeclName");
    const type: SwiftNode | null = this.popNodeKind("Type");
    const labelList: SwiftNode | null = this.popFunctionParamLabels(type);
    const context: SwiftNode | null = this.popContext();

    if (!type) {
      return null;
    }

    let subscript: SwiftNode | null = this.createNode("Subscript");
    subscript = this.addChild(subscript, context);
    this.addChild(subscript, labelList);
    subscript = this.addChild(subscript, type);
    this.addChild(subscript, privateName);

    return this.demangleAccessor(subscript);
  }

  private demangleProtocolList(): SwiftNode | null {
    const typeList: SwiftNode = this.createNode("TypeList");
    const protocolList: SwiftNode | null = this.createWithChild(
      "ProtocolList",
      typeList,
    );

    if (!this.popNodeKind("EmptyList")) {
      let firstElement: boolean = false;

      do {
        firstElement = this.popNodeKind("FirstElementMarker") !== null;
        const protocol: SwiftNode | null = this.popProtocol();

        if (!protocol) {
          return null;
        }

        typeList.children.push(protocol);
      } while (!firstElement);

      this.reverseChildren(typeList, 0);
    }

    return protocolList;
  }

  private demangleGenericSignature(hasParamCounts: boolean): SwiftNode | null {
    const signature: SwiftNode = this.createNode("DependentGenericSignature");

    if (hasParamCounts) {
      while (!this.nextIf("l")) {
        let count: number = 0;

        if (!this.nextIf("z")) {
          count = this.demangleIndex() + 1;
        }

        if (count < 0) {
          return null;
        }

        signature.children.push(
          this.createIndexNode("DependentGenericParamCount", count),
        );
      }
    } else {
      signature.children.push(
        this.createIndexNode("DependentGenericParamCount", 1),
      );
    }

    const numCounts: number = signature.children.length;

    for (;;) {
      const requirement: SwiftNode | null = this.popNodeIf(
        (kind: NodeKind): boolean => {
          return REQUIREMENT_KINDS.has(kind);
        },
      );

      if (!requirement) {
        break;
      }

      signature.children.push(requirement);
    }

    this.reverseChildren(signature, numCounts);
    return signature;
  }

  private demangleGenericRequirement(): SwiftNode | null {
    type TypeKind = "Generic" | "Assoc" | "CompoundAssoc" | "Substitution";
    type ConstraintKind =
      | "Protocol"
      | "BaseClass"
      | "SameType"
      | "Layout"
      | "Inverse";
    let typeKind: TypeKind;
    let constraintKind: ConstraintKind;
    let inverseKind: SwiftNode | null = null;
    const c: string = this.nextChar();

    switch (c) {
      case "c":
        constraintKind = "BaseClass";
        typeKind = "Assoc";
        break;
      case "C":
        constraintKind = "BaseClass";
        typeKind = "CompoundAssoc";
        break;
      case "b":
        constraintKind = "BaseClass";
        typeKind = "Generic";
        break;
      case "B":
        constraintKind = "BaseClass";
        typeKind = "Substitution";
        break;
      case "t":
        constraintKind = "SameType";
        typeKind = "Assoc";
        break;
      case "T":
        constraintKind = "SameType";
        typeKind = "CompoundAssoc";
        break;
      case "s":
        constraintKind = "SameType";
        typeKind = "Generic";
        break;
      case "S":
        constraintKind = "SameType";
        typeKind = "Substitution";
        break;
      case "m":
        constraintKind = "Layout";
        typeKind = "Assoc";
        break;
      case "M":
        constraintKind = "Layout";
        typeKind = "CompoundAssoc";
        break;
      case "l":
        constraintKind = "Layout";
        typeKind = "Generic";
        break;
      case "L":
        constraintKind = "Layout";
        typeKind = "Substitution";
        break;
      case "p":
        constraintKind = "Protocol";
        typeKind = "Assoc";
        break;
      case "P":
        constraintKind = "Protocol";
        typeKind = "CompoundAssoc";
        break;
      case "Q":
        constraintKind = "Protocol";
        typeKind = "Substitution";
        break;
      case "i":
      case "I":
        constraintKind = "Inverse";
        typeKind = c === "i" ? "Generic" : "Substitution";
        inverseKind = this.demangleIndexAsNode();

        if (!inverseKind) {
          return null;
        }
        break;
      case "V":
      case "v":
      case "h":
      case "j":
      case "J":
        // Value and pack parameters, inverses on associated types.
        return fail();
      default:
        constraintKind = "Protocol";
        typeKind = "Generic";
        this.pushBack(c);
        break;
    }

    let constrainedType: SwiftNode | null = null;

    switch (typeKind) {
      case "Generic":
        constrainedType = this.createType(this.demangleGenericParamIndex());
        break;
      case "Assoc":
        constrainedType = this.demangleAssociatedTypeSimple(
          this.demangleGenericParamIndex(),
        );
        this.addSubstitution(constrainedType);
        break;
      case "CompoundAssoc":
        constrainedType = this.demangleAssociatedTypeCompound(
          this.demangleGenericParamIndex(),
        );
        this.addSubstitution(constrainedType);
        break;
      case "Substitution":
        constrainedType = this.popNodeKind("Type");
        break;
    }

    switch (constraintKind) {
      case "Protocol":
        return this.createWithChildren(
          "DependentGenericConformanceRequirement",
          constrainedType,
          this.popProtocol(),
        );
      case "Inverse":
        return this.createWithChildren(
          "DependentGenericInverseConformanceRequirement",
          constrainedType,
          inverseKind,
        );
      case "BaseClass":
        return this.createWithChildren(
          "DependentGenericConformanceRequirement",
          constrainedType,
          this.popNodeKind("Type"),
        );
      case "SameType":
        return this.createWithChildren(
          "DependentGenericSameTypeRequirement",
          constrainedType,
          this.popNodeKind("Type"),
        );
      case "Layout":
        return this.demangleLayoutRequirement(constrainedType);
    }

    return null;
  }

  private demangleLayoutRequirement(
    constrainedType: SwiftNode | null,
  ): SwiftNode | null {
    const c: string = this.nextChar();
    let size: SwiftNode | null = null;
    let alignment: SwiftNode | null = null;

    if (["U", "R", "N", "C", "D", "T", "B"].includes(c) && c !== "") {
      // A layout without a size.
    } else if (c === "E" || c === "M") {
      size = this.demangleIndexAsNode();

      if (!size) {
        return null;
      }

      alignment = this.demangleIndexAsNode();
    } else if (c === "e" || c === "m" || c === "S") {
      size = this.demangleIndexAsNode();

      if (!size) {
        return null;
      }
    } else {
      return null;
    }

    const requirement: SwiftNode | null = this.createWithChildren(
      "DependentGenericLayoutRequirement",
      constrainedType,
      this.createTextNode("Identifier", c),
    );

    if (size) {
      this.addChild(requirement, size);
    }

    if (alignment) {
      this.addChild(requirement, alignment);
    }

    return requirement;
  }

  private demangleGenericType(): SwiftNode | null {
    const genericSignature: SwiftNode | null = this.popNodeKind(
      "DependentGenericSignature",
    );
    const type: SwiftNode | null = this.popNodeKind("Type");
    return this.createType(
      this.createWithChildren("DependentGenericType", genericSignature, type),
    );
  }

  private demangleValueWitness(): SwiftNode | null {
    const code: string = this.nextChar() + this.nextChar();

    if (
      code.length !== 2 ||
      !Object.prototype.hasOwnProperty.call(VALUE_WITNESSES, code)
    ) {
      return null;
    }

    const witness: SwiftNode = this.createTextNode(
      "ValueWitness",
      VALUE_WITNESSES[code] as string,
    );
    return this.addChild(witness, this.popNodeKind("Type"));
  }
}

function isContextKind(kind: NodeKind): boolean {
  return CONTEXT_KINDS.has(kind);
}

// A declaration, or a static one.
function isDeclaration(node: SwiftNode | undefined): boolean {
  if (!node) {
    return false;
  }

  if (node.kind === "Static") {
    return isDeclaration(node.children[0]);
  }

  return DECLARATION_KINDS.has(node.kind);
}

/*
 * What a symbol may demangle to: code, one entity. Anything else - a bare
 * type, "static" on a type, an identifier the real demangler would print
 * glued on - reads as null.
 */
function isCodeSymbol(node: SwiftNode): boolean {
  switch (node.kind) {
    case "CurryThunk":
    case "DispatchThunk":
      return isDeclaration(node.children[0]);
    case "ProtocolWitness":
      return isDeclaration(node.children[1]);
    case "KeyPathGetterThunkHelper":
    case "KeyPathSetterThunkHelper":
    case "KeyPathUnappliedMethodThunkHelper":
    case "KeyPathAppliedMethodThunkHelper":
      return isDeclaration(node.children[0]);
    default:
      return isDeclaration(node) || GENERATED_CODE_KINDS.has(node.kind);
  }
}

function isEntity(kind: NodeKind): boolean {
  return kind === "Type" || isContextKind(kind);
}

function isDeclNameKind(kind: NodeKind): boolean {
  return DECL_NAME_KINDS.has(kind);
}

function isProtocolNode(node: SwiftNode | undefined): boolean {
  if (!node) {
    return false;
  }

  if (node.kind === "Type") {
    return isProtocolNode(node.children[0]);
  }

  return node.kind === "Protocol";
}

// Demangle::genericParameterName: A, B, ..., Z, AB, ...; A1 one level in.
function genericParameterName(depth: number, index: number): string {
  let name: string = "";
  let rest: number = index;

  do {
    name += String.fromCharCode(65 + (rest % 26));
    rest = Math.floor(rest / 26);
  } while (rest);

  return depth !== 0 ? `${name}${depth}` : name;
}

type TypePrinting = "NoType" | "WithColon" | "FunctionStyle";

// Kinds whose printed form needs no parentheses before "?" or ".Type".
const SIMPLE_TYPE_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "BoundGenericClass",
  "BoundGenericEnum",
  "BoundGenericStructure",
  "BoundGenericProtocol",
  "BoundGenericTypeAlias",
  "BoundGenericFunction",
  "BuiltinTypeName",
  "Class",
  "DependentGenericType",
  "DependentMemberType",
  "DependentGenericParamType",
  "DynamicSelf",
  "Enum",
  "ExistentialMetatype",
  "Metatype",
  "MetatypeRepresentation",
  "Module",
  "Tuple",
  "Protocol",
  "ReturnType",
  "Structure",
  "TupleElementName",
  "TypeAlias",
  "TypeList",
  "LabelList",
]);

// The function types an entity's labels print against.
const FUNCTION_STYLE_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "FunctionType",
  "NoEscapeFunctionType",
  "UncurriedFunctionType",
  "CFunctionPointer",
  "ThinFunctionType",
]);

// Every function type, printed as a type.
const FUNCTION_TYPE_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "FunctionType",
  "UncurriedFunctionType",
  "NoEscapeFunctionType",
  "AutoClosureType",
  "EscapingAutoClosureType",
  "ThinFunctionType",
  "CFunctionPointer",
  "ObjCBlock",
  "EscapingObjCBlock",
]);

const ACCESSOR_NAMES: Partial<Record<NodeKind, string>> = {
  OwningAddressor: "owningAddressor",
  OwningMutableAddressor: "owningMutableAddressor",
  NativeOwningAddressor: "nativeOwningAddressor",
  NativeOwningMutableAddressor: "nativeOwningMutableAddressor",
  NativePinningAddressor: "nativePinningAddressor",
  NativePinningMutableAddressor: "nativePinningMutableAddressor",
  UnsafeAddressor: "unsafeAddressor",
  UnsafeMutableAddressor: "unsafeMutableAddressor",
  GlobalGetter: "getter",
  Getter: "getter",
  Setter: "setter",
  MaterializeForSet: "materializeForSet",
  WillSet: "willset",
  DidSet: "didset",
  ReadAccessor: "read",
  ModifyAccessor: "modify",
  InitAccessor: "init",
};

const OUTLINED_PREFIXES: Partial<Record<NodeKind, string>> = {
  OutlinedRetain: "outlined retain of ",
  OutlinedRelease: "outlined release of ",
  OutlinedInitializeWithTake: "outlined init with take of ",
  OutlinedInitializeWithTakeNoValueWitness: "outlined init with take of ",
  OutlinedInitializeWithCopy: "outlined init with copy of ",
  OutlinedInitializeWithCopyNoValueWitness: "outlined init with copy of ",
  OutlinedAssignWithTake: "outlined assign with take of ",
  OutlinedAssignWithTakeNoValueWitness: "outlined assign with take of ",
  OutlinedAssignWithCopy: "outlined assign with copy of ",
  OutlinedAssignWithCopyNoValueWitness: "outlined assign with copy of ",
  OutlinedDestroy: "outlined destroy of ",
  OutlinedDestroyNoValueWitness: "outlined destroy of ",
};

const PREFIX_THEN_CHILD: Partial<Record<NodeKind, string>> = {
  Static: "static ",
  CurryThunk: "curry thunk of ",
  DispatchThunk: "dispatch thunk of ",
  TypeMetadataAccessFunction: "type metadata accessor for ",
  TypeMetadataInstantiationFunction:
    "type metadata instantiation function for ",
  TypeMetadataCompletionFunction: "type metadata completion function for ",
  MethodLookupFunction: "method lookup function for ",
  InOut: "inout ",
  Isolated: "isolated ",
  Sending: "sending ",
  Shared: "__shared ",
  Owned: "__owned ",
  Weak: "weak ",
  Unowned: "unowned ",
  Unmanaged: "unowned(unsafe) ",
};

const KEY_PATH_PREFIXES: Partial<Record<NodeKind, string>> = {
  KeyPathGetterThunkHelper: "key path getter for ",
  KeyPathSetterThunkHelper: "key path setter for ",
  KeyPathUnappliedMethodThunkHelper: "key path unapplied method ",
  KeyPathAppliedMethodThunkHelper: "key path applied method ",
};

const SPECIALIZATION_KINDS: Set<NodeKind> = new Set<NodeKind>([
  "FunctionSignatureSpecialization",
  "GenericPartialSpecialization",
  "GenericPartialSpecializationNotReAbstracted",
  "GenericSpecialization",
  "GenericSpecializationInResilienceDomain",
  "GenericSpecializationPrespecialized",
  "GenericSpecializationNotReAbstracted",
  "InlinedGenericFunction",
]);

/*
 * NodePrinter.cpp with SimplifiedUIDemangleOptions(): no module names, no
 * extension contexts, no parameter or entity types, no where clauses, no
 * specialization or conformance details, short thunk names, sugar on.
 */
class SimplifiedPrinter {
  private out: string = "";
  private specializationPrefixPrinted: boolean = false;
  private steps: number = 0;

  public printRoot(root: SwiftNode): string {
    this.print(root, 0, false);
    return this.out;
  }

  private write(text: string): void {
    this.out += text;

    if (this.out.length > MAX_OUTPUT_LENGTH) {
      fail();
    }
  }

  private child(node: SwiftNode, index: number): SwiftNode {
    const found: SwiftNode | undefined = node.children[index];

    if (!found) {
      // The real printer prints "<null node pointer>" or worse.
      return fail();
    }

    return found;
  }

  private childIf(node: SwiftNode, kind: NodeKind): SwiftNode | null {
    for (const found of node.children) {
      if (found.kind === kind) {
        return found;
      }
    }

    return null;
  }

  private printChildren(
    node: SwiftNode,
    depth: number,
    separator: string | null,
  ): void {
    node.children.forEach((found: SwiftNode, index: number): void => {
      if (separator !== null && index > 0) {
        this.write(separator);
      }

      this.print(found, depth + 1, false);
    });
  }

  private print(
    node: SwiftNode,
    depth: number,
    asPrefixContext: boolean,
  ): SwiftNode | null {
    this.steps++;

    if (depth > MAX_PRINT_DEPTH || this.steps > MAX_PRINT_STEPS) {
      return fail();
    }

    const prefixThenChild: string | undefined = PREFIX_THEN_CHILD[node.kind];

    if (prefixThenChild !== undefined) {
      this.write(prefixThenChild);
      this.print(this.child(node, 0), depth + 1, false);
      return null;
    }

    const outlinedPrefix: string | undefined = OUTLINED_PREFIXES[node.kind];

    if (outlinedPrefix !== undefined) {
      this.write(outlinedPrefix);
      this.print(this.child(node, 0), depth + 1, false);
      return null;
    }

    const accessorName: string | undefined = ACCESSOR_NAMES[node.kind];

    if (accessorName !== undefined) {
      return this.printAbstractStorage(
        this.child(node, 0),
        depth,
        asPrefixContext,
        accessorName,
      );
    }

    if (SPECIALIZATION_KINDS.has(node.kind)) {
      if (!this.specializationPrefixPrinted) {
        this.write("specialized ");
        this.specializationPrefixPrinted = true;
      }

      return null;
    }

    if (FUNCTION_TYPE_KINDS.has(node.kind)) {
      this.printFunctionType(null, node, depth);
      return null;
    }

    switch (node.kind) {
      case "OutlinedCopy":
      case "OutlinedConsume":
        this.write(
          node.kind === "OutlinedCopy"
            ? "outlined copy of "
            : "outlined consume of ",
        );
        this.print(this.child(node, 0), depth + 1, false);

        if (node.children.length > 1) {
          this.print(this.child(node, 1), depth + 1, false);
        }

        return null;
      case "Extension":
        // Extension contexts are not shown; a constrained one's <A> is.
        this.print(this.child(node, 1), depth + 1, false);

        if (node.children.length === 3) {
          this.print(this.child(node, 2), depth + 1, false);
        }

        return null;
      case "Variable":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "WithColon",
          true,
        );
      case "Function":
      case "BoundGenericFunction":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "FunctionStyle",
          true,
        );
      case "Subscript":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "FunctionStyle",
          false,
          "",
          -1,
          "subscript",
        );
      case "ExplicitClosure":
      case "ImplicitClosure": {
        const index: number = this.indexOf(this.child(node, 1));

        if (index >= INT_MAX) {
          // The real printer's int overflows here.
          return fail();
        }

        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          node.kind === "ExplicitClosure" ? "closure #" : "implicit closure #",
          index + 1,
        );
      }
      case "Global":
        this.printChildren(node, depth, null);
        return null;
      case "Initializer":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          "variable initialization expression",
        );
      case "PropertyWrapperBackingInitializer":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          "property wrapper backing initializer",
        );
      case "PropertyWrappedFieldInitAccessor":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          "property wrapped field init accessor",
        );
      case "PropertyWrapperInitFromProjectedValue":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          "property wrapper init from projected value",
        );
      case "DefaultArgumentInitializer":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          "default argument ",
          this.indexOf(this.child(node, 1)),
        );
      case "Type":
        this.print(this.child(node, 0), depth + 1, false);
        return null;
      case "Class":
      case "Structure":
      case "Enum":
      case "Protocol":
      case "TypeAlias":
        return this.printEntity(node, depth, asPrefixContext, "NoType", true);
      case "LocalDeclName":
        this.print(this.child(node, 1), depth + 1, false);
        this.write(` #${this.indexOf(this.child(node, 0)) + 1}`);
        return null;
      case "PrivateDeclName":
        // The discriminator is not shown.
        if (node.children.length > 1) {
          this.print(this.child(node, 1), depth + 1, false);
        }

        return null;
      case "Module":
        return null;
      case "Identifier":
        this.write(this.textOf(node));
        return null;
      case "Index":
      case "Number":
        this.write(`${this.indexOf(node)}`);
        return null;
      case "ArgumentTuple":
        this.printFunctionParameters(null, node, depth);
        return null;
      case "Tuple":
        this.write("(");
        this.printChildren(node, depth, ", ");
        this.write(")");
        return null;
      case "TupleElement": {
        const label: SwiftNode | null = this.childIf(node, "TupleElementName");

        if (label) {
          this.write(`${this.textOf(label)}: `);
        }

        const type: SwiftNode | null = this.childIf(node, "Type");

        if (!type) {
          return fail();
        }

        this.print(type, depth + 1, false);

        if (this.childIf(node, "VariadicMarker")) {
          this.write("...");
        }

        return null;
      }
      case "TupleElementName":
        this.write(`${this.textOf(node)}: `);
        return null;
      case "ReturnType":
        if (node.children.length === 0) {
          this.write(this.textOf(node));
        } else {
          this.printChildren(node, depth, null);
        }

        return null;
      case "NonObjCAttribute":
        this.write("@nonobjc ");
        return null;
      case "ObjCAttribute":
        this.write("@objc ");
        return null;
      case "DirectMethodReferenceAttribute":
        this.write("super ");
        return null;
      case "DynamicAttribute":
        this.write("dynamic ");
        return null;
      case "BuiltinTypeName":
        this.write(this.textOf(node));
        return null;
      case "InfixOperator":
        this.write(`${this.textOf(node)} infix`);
        return null;
      case "PrefixOperator":
        this.write(`${this.textOf(node)} prefix`);
        return null;
      case "PostfixOperator":
        this.write(`${this.textOf(node)} postfix`);
        return null;
      case "LazyProtocolWitnessTableAccessor":
        this.write("lazy protocol witness table accessor for type ");
        this.print(this.child(node, 0), depth + 1, false);
        this.write(" and conformance ");
        this.print(this.child(node, 1), depth + 1, false);
        return null;
      case "ProtocolWitness":
        this.write("protocol witness for ");
        this.print(this.child(node, 1), depth + 1, false);
        this.write(" in conformance ");
        this.print(this.child(node, 0), depth + 1, false);
        return null;
      case "BaseWitnessTableAccessor":
        this.write("base witness table accessor for ");
        this.print(this.child(node, 1), depth + 1, false);
        this.write(" in ");
        this.print(this.child(node, 0), depth + 1, false);
        return null;
      case "KeyPathGetterThunkHelper":
      case "KeyPathSetterThunkHelper":
      case "KeyPathUnappliedMethodThunkHelper":
      case "KeyPathAppliedMethodThunkHelper":
        this.write(KEY_PATH_PREFIXES[node.kind] as string);
        this.print(this.child(node, 0), depth + 1, false);
        this.write(" : ");

        for (let index: number = 1; index < node.children.length; index++) {
          const found: SwiftNode = this.child(node, index);

          if (found.kind === "IsSerialized") {
            this.write(", serialized");
          } else {
            this.print(found, depth + 1, false);
          }
        }

        return null;
      case "PartialApplyForwarder":
      case "PartialApplyObjCForwarder":
        this.write("partial apply");

        if (node.children.length > 0) {
          this.write(" for ");
          this.printChildren(node, depth, null);
        }

        return null;
      case "MergedFunction":
      case "AsyncAwaitResumePartialFunction":
      case "AsyncSuspendResumePartialFunction":
      case "OpaqueReturnTypeIndex":
        return null;
      case "ValueWitness":
        this.write(`${this.textOf(node)} for `);
        this.print(this.child(node, 0), depth + 1, false);
        return null;
      case "BoundGenericClass":
      case "BoundGenericStructure":
      case "BoundGenericEnum":
      case "BoundGenericProtocol":
      case "BoundGenericTypeAlias":
        this.printBoundGeneric(node, depth);
        return null;
      case "DynamicSelf":
        this.write("Self");
        return null;
      case "Metatype": {
        let index: number = 0;

        if (node.children.length === 2) {
          this.print(this.child(node, 0), depth + 1, false);
          this.write(" ");
          index++;
        }

        const type: SwiftNode = this.child(this.child(node, index), 0);
        this.printWithParens(type, depth);
        this.write(isExistentialType(type) ? ".Protocol" : ".Type");
        return null;
      }
      case "ExistentialMetatype": {
        let index: number = 0;

        if (node.children.length === 2) {
          this.print(this.child(node, 0), depth + 1, false);
          this.write(" ");
          index++;
        }

        this.print(this.child(node, index), depth + 1, false);
        this.write(".Type");
        return null;
      }
      case "MetatypeRepresentation":
        this.write(this.textOf(node));
        return null;
      case "ProtocolList": {
        const typeList: SwiftNode = this.child(node, 0);

        if (typeList.children.length === 0) {
          this.write("Any");
        } else {
          this.printChildren(typeList, depth, " & ");
        }

        return null;
      }
      case "ProtocolListWithClass": {
        const protocols: SwiftNode = this.child(node, 0);
        this.print(this.child(node, 1), depth + 1, false);
        this.write(" & ");
        this.printChildren(this.child(protocols, 0), depth, " & ");
        return null;
      }
      case "ProtocolListWithAnyObject": {
        const protocols: SwiftNode = this.child(node, 0);
        const typeList: SwiftNode = this.child(protocols, 0);

        if (typeList.children.length > 0) {
          this.printChildren(typeList, depth, " & ");
          this.write(" & ");
        }

        // QualifyEntities and DisplayStdlibModule stay on when simplified.
        this.write("Swift.AnyObject");
        return null;
      }
      case "Allocator":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "FunctionStyle",
          false,
          this.child(node, 0).kind === "Class" ? "__allocating_init" : "init",
        );
      case "Constructor":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "FunctionStyle",
          node.children.length > 2,
          "init",
        );
      case "Destructor":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          "deinit",
        );
      case "Deallocator":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          this.child(node, 0).kind === "Class"
            ? "__deallocating_deinit"
            : "deinit",
        );
      case "IsolatedDeallocator":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          this.child(node, 0).kind === "Class"
            ? "__isolated_deallocating_deinit"
            : "deinit",
        );
      case "IVarInitializer":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          "__ivar_initializer",
        );
      case "IVarDestroyer":
        return this.printEntity(
          node,
          depth,
          asPrefixContext,
          "NoType",
          false,
          "__ivar_destroyer",
        );
      case "ProtocolConformance":
        // The conforming type only: the protocol and module are not shown.
        this.print(this.child(node, 0), depth + 1, false);
        return null;
      case "TypeList":
        this.printChildren(node, depth, null);
        return null;
      case "LabelList":
        return null;
      case "DependentGenericSignature":
        this.printGenericSignature(node);
        return null;
      case "DependentGenericParamType":
        this.write(
          genericParameterName(
            this.indexOf(this.child(node, 0)),
            this.indexOf(this.child(node, 1)),
          ),
        );
        return null;
      case "DependentGenericType": {
        const dependentType: SwiftNode = this.child(node, 1);
        this.print(this.child(node, 0), depth + 1, false);

        if (needSpaceBeforeType(dependentType)) {
          this.write(" ");
        }

        this.print(dependentType, depth + 1, false);
        return null;
      }
      case "DependentMemberType":
        this.print(this.child(node, 0), depth + 1, false);
        this.write(".");
        this.print(this.child(node, 1), depth + 1, false);
        return null;
      case "DependentAssociatedTypeRef":
        if (node.children.length > 1) {
          this.print(this.child(node, 1), depth + 1, false);
          this.write(".");
        }

        this.print(this.child(node, 0), depth + 1, false);
        return null;
      case "ConcurrentFunctionType":
        this.write("@Sendable ");
        return null;
      case "GlobalActorFunctionType":
        if (node.children.length > 0) {
          this.write("@");
          this.print(this.child(node, 0), depth + 1, false);
          this.write(" ");
        }

        return null;
      case "IsolatedAnyFunctionType":
        this.write("@isolated(any) ");
        return null;
      case "NonIsolatedCallerFunctionType":
        this.write("nonisolated(nonsending) ");
        return null;
      case "OpaqueReturnType":
        this.write("some");
        return null;
      case "OpaqueReturnTypeOf":
        this.write("<<opaque return type of ");
        this.printChildren(node, depth, null);
        this.write(">>");
        return null;
      case "OpaqueType":
        this.print(this.child(node, 0), depth + 1, false);
        this.write(".");
        this.print(this.child(node, 1), depth + 1, false);
        return null;
      case "GlobalVariableOnceFunction":
        // printContext() prints nothing here; the variables' names do.
        this.write("one-time initialization function for ");
        this.print(this.child(node, 1), depth + 1, false);
        return null;
      case "GlobalVariableOnceDeclList":
        if (node.children.length === 1) {
          this.print(this.child(node, 0), depth + 1, false);
        } else {
          this.write("(");
          this.printChildren(node, depth, ", ");
          this.write(")");
        }

        return null;
      default:
        /*
         * Markers, requirements, specialization details and reference
         * storage: never printed with these options, or not worth a guess.
         */
        return fail();
    }
  }

  private textOf(node: SwiftNode): string {
    if (node.text === null) {
      return fail();
    }

    return node.text;
  }

  private indexOf(node: SwiftNode): number {
    if (node.index === null) {
      return fail();
    }

    return node.index;
  }

  private printAbstractStorage(
    node: SwiftNode,
    depth: number,
    asPrefixContext: boolean,
    extraName: string,
  ): SwiftNode | null {
    if (node.kind === "Variable") {
      return this.printEntity(
        node,
        depth,
        asPrefixContext,
        "WithColon",
        true,
        extraName,
      );
    }

    if (node.kind === "Subscript") {
      return this.printEntity(
        node,
        depth,
        asPrefixContext,
        "WithColon",
        false,
        extraName,
        -1,
        "subscript",
      );
    }

    return fail();
  }

  // NodePrinter::printEntity: "<context>.<name>" or "<name> in <context>".
  private printEntity(
    entityNode: SwiftNode,
    depth: number,
    asPrefixContext: boolean,
    typePrintingStart: TypePrinting,
    hasName: boolean,
    extraNameStart: string = "",
    extraIndexStart: number = -1,
    overwriteName: string = "",
  ): SwiftNode | null {
    let entity: SwiftNode = entityNode;
    let typePrinting: TypePrinting = typePrintingStart;
    let genericFunctionTypeList: SwiftNode | null = null;

    if (entity.kind === "BoundGenericFunction") {
      genericFunctionTypeList = this.child(entity, 1);
      entity = this.child(entity, 0);
    }

    let multiWordName: boolean = extraNameStart.includes(" ");
    const localName: boolean =
      hasName && this.child(entity, 1).kind === "LocalDeclName";

    if (localName) {
      multiWordName = true;
    }

    if (asPrefixContext && (typePrinting !== "NoType" || multiWordName)) {
      return entity;
    }

    let postfixContext: SwiftNode | null = null;
    const context: SwiftNode = this.child(entity, 0);

    if (multiWordName) {
      postfixContext = context;
    } else {
      const currentLength: number = this.out.length;
      postfixContext = this.print(context, depth + 1, true);

      if (this.out.length !== currentLength) {
        this.write(".");
      }
    }

    let extraName: string = extraNameStart;
    let extraIndex: number = extraIndexStart;

    if (hasName || overwriteName !== "") {
      if (extraName !== "" && multiWordName) {
        this.write(extraName);

        if (extraIndex >= 0) {
          this.write(`${extraIndex}`);
        }

        this.write(" of ");
        extraName = "";
        extraIndex = -1;
      }

      const currentLength: number = this.out.length;

      if (overwriteName !== "") {
        this.write(overwriteName);
      } else {
        const name: SwiftNode = this.child(entity, 1);

        if (name.kind !== "PrivateDeclName") {
          this.print(name, depth + 1, false);
        }

        const privateName: SwiftNode | null = this.childIf(
          entity,
          "PrivateDeclName",
        );

        if (privateName) {
          this.print(privateName, depth + 1, false);
        }
      }

      if (this.out.length !== currentLength && extraName !== "") {
        this.write(".");
      }
    }

    if (extraName !== "") {
      this.write(extraName);

      if (extraIndex >= 0) {
        this.write(`${extraIndex}`);
      }
    }

    if (typePrinting !== "NoType") {
      const typeNode: SwiftNode | null = this.childIf(entity, "Type");

      if (!typeNode) {
        return fail();
      }

      const type: SwiftNode = this.child(typeNode, 0);

      if (typePrinting === "FunctionStyle") {
        let t: SwiftNode = type;

        while (t.kind === "DependentGenericType") {
          t = this.child(this.child(t, 1), 0);
        }

        if (!FUNCTION_STYLE_KINDS.has(t.kind)) {
          typePrinting = "WithColon";
        }
      }

      // Entity types are not shown; a function-style entity's labels are.
      if (typePrinting === "FunctionStyle") {
        if (multiWordName || needSpaceBeforeType(type)) {
          this.write(" ");
        }

        this.printEntityType(entity, type, genericFunctionTypeList, depth);
      }
    }

    if (!asPrefixContext && postfixContext) {
      if (
        entity.kind === "DefaultArgumentInitializer" ||
        entity.kind === "Initializer" ||
        entity.kind === "PropertyWrapperBackingInitializer" ||
        entity.kind === "PropertyWrappedFieldInitAccessor" ||
        entity.kind === "PropertyWrapperInitFromProjectedValue"
      ) {
        this.write(" of ");
      } else {
        this.write(" in ");
      }

      this.print(postfixContext, depth + 1, false);
      postfixContext = null;
    }

    return postfixContext;
  }

  private printEntityType(
    entity: SwiftNode,
    typeStart: SwiftNode,
    genericFunctionTypeList: SwiftNode | null,
    depth: number,
  ): void {
    let type: SwiftNode = typeStart;
    const labelList: SwiftNode | null = this.childIf(entity, "LabelList");

    if (labelList || genericFunctionTypeList) {
      if (genericFunctionTypeList) {
        this.write("<");
        this.printChildren(genericFunctionTypeList, depth, ", ");
        this.write(">");
      }

      if (type.kind === "DependentGenericType") {
        if (!genericFunctionTypeList) {
          this.print(this.child(type, 0), depth + 1, false);
        }

        const dependentType: SwiftNode = this.child(type, 1);

        if (needSpaceBeforeType(dependentType)) {
          this.write(" ");
        }

        type = this.child(dependentType, 0);
      }

      this.printFunctionType(labelList, type, depth);
    } else {
      this.print(type, depth + 1, false);
    }
  }

  private printFunctionType(
    labelList: SwiftNode | null,
    node: SwiftNode,
    depth: number,
  ): void {
    if (node.children.length < 2) {
      fail();
    }

    switch (node.kind) {
      case "FunctionType":
      case "UncurriedFunctionType":
      case "NoEscapeFunctionType":
        break;
      case "AutoClosureType":
      case "EscapingAutoClosureType":
        this.write("@autoclosure ");
        break;
      case "ThinFunctionType":
        this.write("@convention(thin) ");
        break;
      case "CFunctionPointer":
        this.write("@convention(c) ");
        break;
      case "EscapingObjCBlock":
        this.write("@escaping @convention(block) ");
        break;
      case "ObjCBlock":
        this.write("@convention(block) ");
        break;
      default:
        fail();
    }

    const argIndex: number = node.children.length - 2;
    let startIndex: number = 0;
    let isSendable: boolean = false;
    let nonIsolatedCaller: SwiftNode | null = null;

    if (this.child(node, startIndex).kind === "SendingResultFunctionType") {
      startIndex++;
    }

    if (this.child(node, startIndex).kind === "IsolatedAnyFunctionType") {
      this.print(this.child(node, startIndex), depth + 1, false);
      startIndex++;
    }

    if (this.child(node, startIndex).kind === "NonIsolatedCallerFunctionType") {
      nonIsolatedCaller = this.child(node, startIndex);
      startIndex++;
    }

    if (this.child(node, startIndex).kind === "GlobalActorFunctionType") {
      this.print(this.child(node, startIndex), depth + 1, false);
      startIndex++;
    }

    const throwsKind: NodeKind = this.child(node, startIndex).kind;

    if (
      throwsKind === "ThrowsAnnotation" ||
      throwsKind === "TypedThrowsAnnotation"
    ) {
      startIndex++;
    }

    if (this.child(node, startIndex).kind === "ConcurrentFunctionType") {
      startIndex++;
      isSendable = true;
    }

    if (nonIsolatedCaller) {
      this.print(nonIsolatedCaller, depth + 1, false);
    }

    if (isSendable) {
      this.write("@Sendable ");
    }

    // Parameter types, async, throws and the result are not shown.
    this.printFunctionParameters(labelList, this.child(node, argIndex), depth);
  }

  private printFunctionParameters(
    labelList: SwiftNode | null,
    parameterType: SwiftNode,
    _depth: number,
  ): void {
    if (parameterType.kind !== "ArgumentTuple") {
      fail();
    }

    const parameters: SwiftNode = this.child(this.child(parameterType, 0), 0);

    if (parameters.kind !== "Tuple") {
      this.write("(_:)");
      return;
    }

    const hasLabels: boolean =
      labelList !== null && labelList.children.length > 0;
    this.write("(");

    parameters.children.forEach((param: SwiftNode, index: number): void => {
      if (hasLabels && labelList) {
        const label: SwiftNode = this.child(labelList, index);
        this.write(
          `${label.kind === "Identifier" ? this.textOf(label) : "_"}:`,
        );
      } else {
        const name: SwiftNode | null = this.childIf(param, "TupleElementName");
        this.write(name ? `${this.textOf(name)}:` : "_:");
      }
    });

    this.write(")");
  }

  private printWithParens(type: SwiftNode, depth: number): void {
    const needsParens: boolean = !isSimpleType(type);

    if (needsParens) {
      this.write("(");
    }

    this.print(type, depth + 1, false);

    if (needsParens) {
      this.write(")");
    }
  }

  private printBoundGeneric(node: SwiftNode, depth: number): void {
    if (node.children.length < 2) {
      return;
    }

    if (node.children.length !== 2 || node.kind === "BoundGenericClass") {
      this.printBoundGenericNoSugar(node, depth);
      return;
    }

    if (node.kind === "BoundGenericProtocol") {
      this.printChildren(this.child(node, 1), depth, null);
      this.write(" as ");
      this.print(this.child(node, 0), depth + 1, false);
      return;
    }

    const sugar: string = findSugar(node);
    const typeArgs: SwiftNode = this.child(node, 1);

    if (sugar === "Optional" || sugar === "ImplicitlyUnwrappedOptional") {
      this.printWithParens(this.child(typeArgs, 0), depth);
      this.write(sugar === "Optional" ? "?" : "!");
    } else if (sugar === "Array") {
      this.write("[");
      this.print(this.child(typeArgs, 0), depth + 1, false);
      this.write("]");
    } else if (sugar === "Dictionary") {
      this.write("[");
      this.print(this.child(typeArgs, 0), depth + 1, false);
      this.write(" : ");
      this.print(this.child(typeArgs, 1), depth + 1, false);
      this.write("]");
    } else {
      this.printBoundGenericNoSugar(node, depth);
    }
  }

  private printBoundGenericNoSugar(node: SwiftNode, depth: number): void {
    this.print(this.child(node, 0), depth + 1, false);
    this.write("<");
    this.printChildren(this.child(node, 1), depth, ", ");
    this.write(">");
  }

  // Where clauses are not shown: the parameters, as <A, B><A1>.
  private printGenericSignature(node: SwiftNode): void {
    this.write("<");
    let numGenericParams: number = 0;

    while (
      numGenericParams < node.children.length &&
      this.child(node, numGenericParams).kind === "DependentGenericParamCount"
    ) {
      numGenericParams++;
    }

    for (let depth: number = 0; depth < numGenericParams; depth++) {
      if (depth !== 0) {
        this.write("><");
      }

      const count: number = this.indexOf(this.child(node, depth));

      for (let index: number = 0; index < count; index++) {
        if (index !== 0) {
          this.write(", ");
        }

        if (index >= 128) {
          this.write("...");
          break;
        }

        this.write(genericParameterName(depth, index));
      }
    }

    this.write(">");
  }
}

function needSpaceBeforeType(type: SwiftNode): boolean {
  switch (type.kind) {
    case "Type":
      return type.children[0] ? needSpaceBeforeType(type.children[0]) : true;
    case "FunctionType":
    case "NoEscapeFunctionType":
    case "UncurriedFunctionType":
    case "DependentGenericType":
      return false;
    default:
      return true;
  }
}

function isSimpleType(node: SwiftNode): boolean {
  switch (node.kind) {
    case "Type":
      return node.children[0] ? isSimpleType(node.children[0]) : false;
    case "ProtocolList":
      return (node.children[0]?.children.length || 0) <= 1;
    case "ProtocolListWithAnyObject":
      return node.children[0]?.children[0]?.children.length === 0;
    default:
      return SIMPLE_TYPE_KINDS.has(node.kind);
  }
}

function isExistentialType(node: SwiftNode): boolean {
  return (
    node.kind === "ExistentialMetatype" ||
    node.kind === "ProtocolList" ||
    node.kind === "ProtocolListWithClass" ||
    node.kind === "ProtocolListWithAnyObject"
  );
}

function isSwiftModule(node: SwiftNode | undefined): boolean {
  return Boolean(node && node.kind === "Module" && node.text === STDLIB_NAME);
}

function isIdentifier(node: SwiftNode | undefined, text: string): boolean {
  return Boolean(node && node.kind === "Identifier" && node.text === text);
}

// NodePrinter::findSugar: Swift's Optional, Array and Dictionary.
function findSugar(node: SwiftNode): string {
  if (node.children.length === 1 && node.kind === "Type") {
    return node.children[0] ? findSugar(node.children[0]) : "None";
  }

  if (node.children.length !== 2) {
    return "None";
  }

  if (
    node.kind !== "BoundGenericEnum" &&
    node.kind !== "BoundGenericStructure"
  ) {
    return "None";
  }

  const unboundType: SwiftNode | undefined = node.children[0]?.children[0];
  const typeArgs: SwiftNode | undefined = node.children[1];

  if (!unboundType || !typeArgs) {
    return "None";
  }

  const name: SwiftNode | undefined = unboundType.children[1];
  const module: SwiftNode | undefined = unboundType.children[0];

  if (node.kind === "BoundGenericEnum") {
    if (
      isIdentifier(name, "Optional") &&
      typeArgs.children.length === 1 &&
      isSwiftModule(module)
    ) {
      return "Optional";
    }

    if (
      isIdentifier(name, "ImplicitlyUnwrappedOptional") &&
      typeArgs.children.length === 1 &&
      isSwiftModule(module)
    ) {
      return "ImplicitlyUnwrappedOptional";
    }

    return "None";
  }

  if (
    isIdentifier(name, "Array") &&
    typeArgs.children.length === 1 &&
    isSwiftModule(module)
  ) {
    return "Array";
  }

  if (
    isIdentifier(name, "Dictionary") &&
    typeArgs.children.length === 2 &&
    isSwiftModule(module)
  ) {
    return "Dictionary";
  }

  return "None";
}

function manglingPrefixLength(symbol: string): number {
  for (const prefix of MANGLING_PREFIXES) {
    if (symbol.startsWith(prefix)) {
      return prefix.length;
    }
  }

  return 0;
}

// The simplified form swift-demangle --simplified prints, or null.
export function demangleSwiftSymbol(symbol: string): string | null {
  try {
    if (typeof symbol !== "string") {
      return null;
    }

    const name: string = symbol.trim();

    if (name.length > MAX_SYMBOL_LENGTH || !MANGLED_NAME_PATTERN.test(name)) {
      return null;
    }

    const prefixLength: number = manglingPrefixLength(name);

    if (prefixLength === 0 || prefixLength === name.length) {
      return null;
    }

    const root: SwiftNode = new Demangler(name).demangleSymbol(prefixLength);
    const printed: string = new SimplifiedPrinter().printRoot(root);

    /*
     * A context that prints as nothing - a closure directly in a module
     * reads "closure #1 in " - leaves the name dangling: not a name.
     */
    if (printed.length === 0 || printed.trim() !== printed) {
      return null;
    }

    return printed;
  } catch {
    return null;
  }
}

/*
 * How a symbol reads to a person: a Swift name demangled, anything else
 * (Objective-C "-[CartViewController checkout]", C "main", C++ "_ZN...", a Swift name
 * this cannot read) as given, trimmed. Never empty for a non-empty name.
 */
export function toAppleSymbolDisplayName(symbol: string): string {
  try {
    if (typeof symbol !== "string") {
      return "";
    }

    const name: string = symbol.trim();

    if (name === "") {
      return symbol;
    }

    return demangleSwiftSymbol(name) ?? name;
  } catch {
    return typeof symbol === "string" ? symbol : "";
  }
}
