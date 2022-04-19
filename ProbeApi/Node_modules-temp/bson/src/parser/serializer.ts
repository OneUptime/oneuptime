import type { Buffer } from 'buffer';
import { Binary } from '../binary';
import type { BSONSymbol, DBRef, Document, MaxKey } from '../bson';
import type { Code } from '../code';
import * as constants from '../constants';
import type { DBRefLike } from '../db_ref';
import type { Decimal128 } from '../decimal128';
import type { Double } from '../double';
import { ensureBuffer } from '../ensure_buffer';
import { BSONError, BSONTypeError } from '../error';
import { isBSONType } from '../extended_json';
import { writeIEEE754 } from '../float_parser';
import type { Int32 } from '../int_32';
import { Long } from '../long';
import { Map } from '../map';
import type { MinKey } from '../min_key';
import type { ObjectId } from '../objectid';
import type { BSONRegExp } from '../regexp';
import {
  isBigInt64Array,
  isBigUInt64Array,
  isDate,
  isMap,
  isRegExp,
  isUint8Array,
  normalizedFunctionString
} from './utils';

/** @public */
export interface SerializeOptions {
  /** the serializer will check if keys are valid. */
  checkKeys?: boolean;
  /** serialize the javascript functions **(default:false)**. */
  serializeFunctions?: boolean;
  /** serialize will not emit undefined fields **(default:true)** */
  ignoreUndefined?: boolean;
  /** @internal Resize internal buffer */
  minInternalBufferSize?: number;
  /** the index in the buffer where we wish to start serializing into */
  index?: number;
}

const regexp = /\x00/; // eslint-disable-line no-control-regex
const ignoreKeys = new Set(['$db', '$ref', '$id', '$clusterTime']);

/*
 * isArray indicates if we are writing to a BSON array (type 0x04)
 * which forces the "key" which really an array index as a string to be written as ascii
 * This will catch any errors in index as a string generation
 */

function serializeString(
  buffer: Buffer,
  key: string,
  value: string,
  index: number,
  isArray?: boolean
) {
  // Encode String type
  buffer[index++] = constants.BSON_DATA_STRING;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes + 1;
  buffer[index - 1] = 0;
  // Write the string
  const size = buffer.write(value, index + 4, undefined, 'utf8');
  // Write the size of the string to buffer
  buffer[index + 3] = ((size + 1) >> 24) & 0xff;
  buffer[index + 2] = ((size + 1) >> 16) & 0xff;
  buffer[index + 1] = ((size + 1) >> 8) & 0xff;
  buffer[index] = (size + 1) & 0xff;
  // Update index
  index = index + 4 + size;
  // Write zero
  buffer[index++] = 0;
  return index;
}

function serializeNumber(
  buffer: Buffer,
  key: string,
  value: number,
  index: number,
  isArray?: boolean
) {
  // We have an integer value
  // TODO(NODE-2529): Add support for big int
  if (
    Number.isInteger(value) &&
    value >= constants.BSON_INT32_MIN &&
    value <= constants.BSON_INT32_MAX
  ) {
    // If the value fits in 32 bits encode as int32
    // Set int type 32 bits or less
    buffer[index++] = constants.BSON_DATA_INT;
    // Number of written bytes
    const numberOfWrittenBytes = !isArray
      ? buffer.write(key, index, undefined, 'utf8')
      : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write the int value
    buffer[index++] = value & 0xff;
    buffer[index++] = (value >> 8) & 0xff;
    buffer[index++] = (value >> 16) & 0xff;
    buffer[index++] = (value >> 24) & 0xff;
  } else {
    // Encode as double
    buffer[index++] = constants.BSON_DATA_NUMBER;
    // Number of written bytes
    const numberOfWrittenBytes = !isArray
      ? buffer.write(key, index, undefined, 'utf8')
      : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Write float
    writeIEEE754(buffer, value, index, 'little', 52, 8);
    // Adjust index
    index = index + 8;
  }

  return index;
}

function serializeNull(buffer: Buffer, key: string, _: unknown, index: number, isArray?: boolean) {
  // Set long type
  buffer[index++] = constants.BSON_DATA_NULL;

  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');

  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  return index;
}

function serializeBoolean(
  buffer: Buffer,
  key: string,
  value: boolean,
  index: number,
  isArray?: boolean
) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_BOOLEAN;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  // Encode the boolean value
  buffer[index++] = value ? 1 : 0;
  return index;
}

function serializeDate(buffer: Buffer, key: string, value: Date, index: number, isArray?: boolean) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_DATE;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;

  // Write the date
  const dateInMilis = Long.fromNumber(value.getTime());
  const lowBits = dateInMilis.getLowBits();
  const highBits = dateInMilis.getHighBits();
  // Encode low bits
  buffer[index++] = lowBits & 0xff;
  buffer[index++] = (lowBits >> 8) & 0xff;
  buffer[index++] = (lowBits >> 16) & 0xff;
  buffer[index++] = (lowBits >> 24) & 0xff;
  // Encode high bits
  buffer[index++] = highBits & 0xff;
  buffer[index++] = (highBits >> 8) & 0xff;
  buffer[index++] = (highBits >> 16) & 0xff;
  buffer[index++] = (highBits >> 24) & 0xff;
  return index;
}

function serializeRegExp(
  buffer: Buffer,
  key: string,
  value: RegExp,
  index: number,
  isArray?: boolean
) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_REGEXP;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');

  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  if (value.source && value.source.match(regexp) != null) {
    throw Error('value ' + value.source + ' must not contain null bytes');
  }
  // Adjust the index
  index = index + buffer.write(value.source, index, undefined, 'utf8');
  // Write zero
  buffer[index++] = 0x00;
  // Write the parameters
  if (value.ignoreCase) buffer[index++] = 0x69; // i
  if (value.global) buffer[index++] = 0x73; // s
  if (value.multiline) buffer[index++] = 0x6d; // m

  // Add ending zero
  buffer[index++] = 0x00;
  return index;
}

function serializeBSONRegExp(
  buffer: Buffer,
  key: string,
  value: BSONRegExp,
  index: number,
  isArray?: boolean
) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_REGEXP;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;

  // Check the pattern for 0 bytes
  if (value.pattern.match(regexp) != null) {
    // The BSON spec doesn't allow keys with null bytes because keys are
    // null-terminated.
    throw Error('pattern ' + value.pattern + ' must not contain null bytes');
  }

  // Adjust the index
  index = index + buffer.write(value.pattern, index, undefined, 'utf8');
  // Write zero
  buffer[index++] = 0x00;
  // Write the options
  index = index + buffer.write(value.options.split('').sort().join(''), index, undefined, 'utf8');
  // Add ending zero
  buffer[index++] = 0x00;
  return index;
}

function serializeMinMax(
  buffer: Buffer,
  key: string,
  value: MinKey | MaxKey,
  index: number,
  isArray?: boolean
) {
  // Write the type of either min or max key
  if (value === null) {
    buffer[index++] = constants.BSON_DATA_NULL;
  } else if (value._bsontype === 'MinKey') {
    buffer[index++] = constants.BSON_DATA_MIN_KEY;
  } else {
    buffer[index++] = constants.BSON_DATA_MAX_KEY;
  }

  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  return index;
}

function serializeObjectId(
  buffer: Buffer,
  key: string,
  value: ObjectId,
  index: number,
  isArray?: boolean
) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_OID;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');

  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;

  // Write the objectId into the shared buffer
  if (typeof value.id === 'string') {
    buffer.write(value.id, index, undefined, 'binary');
  } else if (isUint8Array(value.id)) {
    // Use the standard JS methods here because buffer.copy() is buggy with the
    // browser polyfill
    buffer.set(value.id.subarray(0, 12), index);
  } else {
    throw new BSONTypeError('object [' + JSON.stringify(value) + '] is not a valid ObjectId');
  }

  // Adjust index
  return index + 12;
}

function serializeBuffer(
  buffer: Buffer,
  key: string,
  value: Buffer | Uint8Array,
  index: number,
  isArray?: boolean
) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_BINARY;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  // Get size of the buffer (current write point)
  const size = value.length;
  // Write the size of the string to buffer
  buffer[index++] = size & 0xff;
  buffer[index++] = (size >> 8) & 0xff;
  buffer[index++] = (size >> 16) & 0xff;
  buffer[index++] = (size >> 24) & 0xff;
  // Write the default subtype
  buffer[index++] = constants.BSON_BINARY_SUBTYPE_DEFAULT;
  // Copy the content form the binary field to the buffer
  buffer.set(ensureBuffer(value), index);
  // Adjust the index
  index = index + size;
  return index;
}

function serializeObject(
  buffer: Buffer,
  key: string,
  value: Document,
  index: number,
  checkKeys = false,
  depth = 0,
  serializeFunctions = false,
  ignoreUndefined = true,
  isArray = false,
  path: Document[] = []
) {
  for (let i = 0; i < path.length; i++) {
    if (path[i] === value) throw new BSONError('cyclic dependency detected');
  }

  // Push value to stack
  path.push(value);
  // Write the type
  buffer[index++] = Array.isArray(value) ? constants.BSON_DATA_ARRAY : constants.BSON_DATA_OBJECT;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  const endIndex = serializeInto(
    buffer,
    value,
    checkKeys,
    index,
    depth + 1,
    serializeFunctions,
    ignoreUndefined,
    path
  );
  // Pop stack
  path.pop();
  return endIndex;
}

function serializeDecimal128(
  buffer: Buffer,
  key: string,
  value: Decimal128,
  index: number,
  isArray?: boolean
) {
  buffer[index++] = constants.BSON_DATA_DECIMAL128;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  // Write the data from the value
  // Prefer the standard JS methods because their typechecking is not buggy,
  // unlike the `buffer` polyfill's.
  buffer.set(value.bytes.subarray(0, 16), index);
  return index + 16;
}

function serializeLong(buffer: Buffer, key: string, value: Long, index: number, isArray?: boolean) {
  // Write the type
  buffer[index++] =
    value._bsontype === 'Long' ? constants.BSON_DATA_LONG : constants.BSON_DATA_TIMESTAMP;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  // Write the date
  const lowBits = value.getLowBits();
  const highBits = value.getHighBits();
  // Encode low bits
  buffer[index++] = lowBits & 0xff;
  buffer[index++] = (lowBits >> 8) & 0xff;
  buffer[index++] = (lowBits >> 16) & 0xff;
  buffer[index++] = (lowBits >> 24) & 0xff;
  // Encode high bits
  buffer[index++] = highBits & 0xff;
  buffer[index++] = (highBits >> 8) & 0xff;
  buffer[index++] = (highBits >> 16) & 0xff;
  buffer[index++] = (highBits >> 24) & 0xff;
  return index;
}

function serializeInt32(
  buffer: Buffer,
  key: string,
  value: Int32 | number,
  index: number,
  isArray?: boolean
) {
  value = value.valueOf();
  // Set int type 32 bits or less
  buffer[index++] = constants.BSON_DATA_INT;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  // Write the int value
  buffer[index++] = value & 0xff;
  buffer[index++] = (value >> 8) & 0xff;
  buffer[index++] = (value >> 16) & 0xff;
  buffer[index++] = (value >> 24) & 0xff;
  return index;
}

function serializeDouble(
  buffer: Buffer,
  key: string,
  value: Double,
  index: number,
  isArray?: boolean
) {
  // Encode as double
  buffer[index++] = constants.BSON_DATA_NUMBER;

  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');

  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;

  // Write float
  writeIEEE754(buffer, value.value, index, 'little', 52, 8);

  // Adjust index
  index = index + 8;
  return index;
}

function serializeFunction(
  buffer: Buffer,
  key: string,
  value: Function,
  index: number,
  _checkKeys = false,
  _depth = 0,
  isArray?: boolean
) {
  buffer[index++] = constants.BSON_DATA_CODE;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  // Function string
  const functionString = normalizedFunctionString(value);

  // Write the string
  const size = buffer.write(functionString, index + 4, undefined, 'utf8') + 1;
  // Write the size of the string to buffer
  buffer[index] = size & 0xff;
  buffer[index + 1] = (size >> 8) & 0xff;
  buffer[index + 2] = (size >> 16) & 0xff;
  buffer[index + 3] = (size >> 24) & 0xff;
  // Update index
  index = index + 4 + size - 1;
  // Write zero
  buffer[index++] = 0;
  return index;
}

function serializeCode(
  buffer: Buffer,
  key: string,
  value: Code,
  index: number,
  checkKeys = false,
  depth = 0,
  serializeFunctions = false,
  ignoreUndefined = true,
  isArray = false
) {
  if (value.scope && typeof value.scope === 'object') {
    // Write the type
    buffer[index++] = constants.BSON_DATA_CODE_W_SCOPE;
    // Number of written bytes
    const numberOfWrittenBytes = !isArray
      ? buffer.write(key, index, undefined, 'utf8')
      : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;

    // Starting index
    let startIndex = index;

    // Serialize the function
    // Get the function string
    const functionString = typeof value.code === 'string' ? value.code : value.code.toString();
    // Index adjustment
    index = index + 4;
    // Write string into buffer
    const codeSize = buffer.write(functionString, index + 4, undefined, 'utf8') + 1;
    // Write the size of the string to buffer
    buffer[index] = codeSize & 0xff;
    buffer[index + 1] = (codeSize >> 8) & 0xff;
    buffer[index + 2] = (codeSize >> 16) & 0xff;
    buffer[index + 3] = (codeSize >> 24) & 0xff;
    // Write end 0
    buffer[index + 4 + codeSize - 1] = 0;
    // Write the
    index = index + codeSize + 4;

    //
    // Serialize the scope value
    const endIndex = serializeInto(
      buffer,
      value.scope,
      checkKeys,
      index,
      depth + 1,
      serializeFunctions,
      ignoreUndefined
    );
    index = endIndex - 1;

    // Writ the total
    const totalSize = endIndex - startIndex;

    // Write the total size of the object
    buffer[startIndex++] = totalSize & 0xff;
    buffer[startIndex++] = (totalSize >> 8) & 0xff;
    buffer[startIndex++] = (totalSize >> 16) & 0xff;
    buffer[startIndex++] = (totalSize >> 24) & 0xff;
    // Write trailing zero
    buffer[index++] = 0;
  } else {
    buffer[index++] = constants.BSON_DATA_CODE;
    // Number of written bytes
    const numberOfWrittenBytes = !isArray
      ? buffer.write(key, index, undefined, 'utf8')
      : buffer.write(key, index, undefined, 'ascii');
    // Encode the name
    index = index + numberOfWrittenBytes;
    buffer[index++] = 0;
    // Function string
    const functionString = value.code.toString();
    // Write the string
    const size = buffer.write(functionString, index + 4, undefined, 'utf8') + 1;
    // Write the size of the string to buffer
    buffer[index] = size & 0xff;
    buffer[index + 1] = (size >> 8) & 0xff;
    buffer[index + 2] = (size >> 16) & 0xff;
    buffer[index + 3] = (size >> 24) & 0xff;
    // Update index
    index = index + 4 + size - 1;
    // Write zero
    buffer[index++] = 0;
  }

  return index;
}

function serializeBinary(
  buffer: Buffer,
  key: string,
  value: Binary,
  index: number,
  isArray?: boolean
) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_BINARY;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  // Extract the buffer
  const data = value.value(true) as Buffer | Uint8Array;
  // Calculate size
  let size = value.position;
  // Add the deprecated 02 type 4 bytes of size to total
  if (value.sub_type === Binary.SUBTYPE_BYTE_ARRAY) size = size + 4;
  // Write the size of the string to buffer
  buffer[index++] = size & 0xff;
  buffer[index++] = (size >> 8) & 0xff;
  buffer[index++] = (size >> 16) & 0xff;
  buffer[index++] = (size >> 24) & 0xff;
  // Write the subtype to the buffer
  buffer[index++] = value.sub_type;

  // If we have binary type 2 the 4 first bytes are the size
  if (value.sub_type === Binary.SUBTYPE_BYTE_ARRAY) {
    size = size - 4;
    buffer[index++] = size & 0xff;
    buffer[index++] = (size >> 8) & 0xff;
    buffer[index++] = (size >> 16) & 0xff;
    buffer[index++] = (size >> 24) & 0xff;
  }

  // Write the data to the object
  buffer.set(data, index);
  // Adjust the index
  index = index + value.position;
  return index;
}

function serializeSymbol(
  buffer: Buffer,
  key: string,
  value: BSONSymbol,
  index: number,
  isArray?: boolean
) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_SYMBOL;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');
  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;
  // Write the string
  const size = buffer.write(value.value, index + 4, undefined, 'utf8') + 1;
  // Write the size of the string to buffer
  buffer[index] = size & 0xff;
  buffer[index + 1] = (size >> 8) & 0xff;
  buffer[index + 2] = (size >> 16) & 0xff;
  buffer[index + 3] = (size >> 24) & 0xff;
  // Update index
  index = index + 4 + size - 1;
  // Write zero
  buffer[index++] = 0x00;
  return index;
}

function serializeDBRef(
  buffer: Buffer,
  key: string,
  value: DBRef,
  index: number,
  depth: number,
  serializeFunctions: boolean,
  isArray?: boolean
) {
  // Write the type
  buffer[index++] = constants.BSON_DATA_OBJECT;
  // Number of written bytes
  const numberOfWrittenBytes = !isArray
    ? buffer.write(key, index, undefined, 'utf8')
    : buffer.write(key, index, undefined, 'ascii');

  // Encode the name
  index = index + numberOfWrittenBytes;
  buffer[index++] = 0;

  let startIndex = index;
  let output: DBRefLike = {
    $ref: value.collection || value.namespace, // "namespace" was what library 1.x called "collection"
    $id: value.oid
  };

  if (value.db != null) {
    output.$db = value.db;
  }

  output = Object.assign(output, value.fields);
  const endIndex = serializeInto(buffer, output, false, index, depth + 1, serializeFunctions);

  // Calculate object size
  const size = endIndex - startIndex;
  // Write the size
  buffer[startIndex++] = size & 0xff;
  buffer[startIndex++] = (size >> 8) & 0xff;
  buffer[startIndex++] = (size >> 16) & 0xff;
  buffer[startIndex++] = (size >> 24) & 0xff;
  // Set index
  return endIndex;
}

export function serializeInto(
  buffer: Buffer,
  object: Document,
  checkKeys = false,
  startingIndex = 0,
  depth = 0,
  serializeFunctions = false,
  ignoreUndefined = true,
  path: Document[] = []
): number {
  startingIndex = startingIndex || 0;
  path = path || [];

  // Push the object to the path
  path.push(object);

  // Start place to serialize into
  let index = startingIndex + 4;

  // Special case isArray
  if (Array.isArray(object)) {
    // Get object keys
    for (let i = 0; i < object.length; i++) {
      const key = '' + i;
      let value = object[i];

      // Is there an override value
      if (typeof value?.toBSON === 'function') {
        value = value.toBSON();
      }

      if (typeof value === 'string') {
        index = serializeString(buffer, key, value, index, true);
      } else if (typeof value === 'number') {
        index = serializeNumber(buffer, key, value, index, true);
      } else if (typeof value === 'bigint') {
        throw new BSONTypeError('Unsupported type BigInt, please use Decimal128');
      } else if (typeof value === 'boolean') {
        index = serializeBoolean(buffer, key, value, index, true);
      } else if (value instanceof Date || isDate(value)) {
        index = serializeDate(buffer, key, value, index, true);
      } else if (value === undefined) {
        index = serializeNull(buffer, key, value, index, true);
      } else if (value === null) {
        index = serializeNull(buffer, key, value, index, true);
      } else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
        index = serializeObjectId(buffer, key, value, index, true);
      } else if (isUint8Array(value)) {
        index = serializeBuffer(buffer, key, value, index, true);
      } else if (value instanceof RegExp || isRegExp(value)) {
        index = serializeRegExp(buffer, key, value, index, true);
      } else if (typeof value === 'object' && value['_bsontype'] == null) {
        index = serializeObject(
          buffer,
          key,
          value,
          index,
          checkKeys,
          depth,
          serializeFunctions,
          ignoreUndefined,
          true,
          path
        );
      } else if (
        typeof value === 'object' &&
        isBSONType(value) &&
        value._bsontype === 'Decimal128'
      ) {
        index = serializeDecimal128(buffer, key, value, index, true);
      } else if (value['_bsontype'] === 'Long' || value['_bsontype'] === 'Timestamp') {
        index = serializeLong(buffer, key, value, index, true);
      } else if (value['_bsontype'] === 'Double') {
        index = serializeDouble(buffer, key, value, index, true);
      } else if (typeof value === 'function' && serializeFunctions) {
        index = serializeFunction(buffer, key, value, index, checkKeys, depth, true);
      } else if (value['_bsontype'] === 'Code') {
        index = serializeCode(
          buffer,
          key,
          value,
          index,
          checkKeys,
          depth,
          serializeFunctions,
          ignoreUndefined,
          true
        );
      } else if (value['_bsontype'] === 'Binary') {
        index = serializeBinary(buffer, key, value, index, true);
      } else if (value['_bsontype'] === 'Symbol') {
        index = serializeSymbol(buffer, key, value, index, true);
      } else if (value['_bsontype'] === 'DBRef') {
        index = serializeDBRef(buffer, key, value, index, depth, serializeFunctions, true);
      } else if (value['_bsontype'] === 'BSONRegExp') {
        index = serializeBSONRegExp(buffer, key, value, index, true);
      } else if (value['_bsontype'] === 'Int32') {
        index = serializeInt32(buffer, key, value, index, true);
      } else if (value['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
        index = serializeMinMax(buffer, key, value, index, true);
      } else if (typeof value['_bsontype'] !== 'undefined') {
        throw new BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
      }
    }
  } else if (object instanceof Map || isMap(object)) {
    const iterator = object.entries();
    let done = false;

    while (!done) {
      // Unpack the next entry
      const entry = iterator.next();
      done = !!entry.done;
      // Are we done, then skip and terminate
      if (done) continue;

      // Get the entry values
      const key = entry.value[0];
      const value = entry.value[1];

      // Check the type of the value
      const type = typeof value;

      // Check the key and throw error if it's illegal
      if (typeof key === 'string' && !ignoreKeys.has(key)) {
        if (key.match(regexp) != null) {
          // The BSON spec doesn't allow keys with null bytes because keys are
          // null-terminated.
          throw Error('key ' + key + ' must not contain null bytes');
        }

        if (checkKeys) {
          if ('$' === key[0]) {
            throw Error('key ' + key + " must not start with '$'");
          } else if (~key.indexOf('.')) {
            throw Error('key ' + key + " must not contain '.'");
          }
        }
      }

      if (type === 'string') {
        index = serializeString(buffer, key, value, index);
      } else if (type === 'number') {
        index = serializeNumber(buffer, key, value, index);
      } else if (type === 'bigint' || isBigInt64Array(value) || isBigUInt64Array(value)) {
        throw new BSONTypeError('Unsupported type BigInt, please use Decimal128');
      } else if (type === 'boolean') {
        index = serializeBoolean(buffer, key, value, index);
      } else if (value instanceof Date || isDate(value)) {
        index = serializeDate(buffer, key, value, index);
      } else if (value === null || (value === undefined && ignoreUndefined === false)) {
        index = serializeNull(buffer, key, value, index);
      } else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
        index = serializeObjectId(buffer, key, value, index);
      } else if (isUint8Array(value)) {
        index = serializeBuffer(buffer, key, value, index);
      } else if (value instanceof RegExp || isRegExp(value)) {
        index = serializeRegExp(buffer, key, value, index);
      } else if (type === 'object' && value['_bsontype'] == null) {
        index = serializeObject(
          buffer,
          key,
          value,
          index,
          checkKeys,
          depth,
          serializeFunctions,
          ignoreUndefined,
          false,
          path
        );
      } else if (type === 'object' && value['_bsontype'] === 'Decimal128') {
        index = serializeDecimal128(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Long' || value['_bsontype'] === 'Timestamp') {
        index = serializeLong(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Double') {
        index = serializeDouble(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Code') {
        index = serializeCode(
          buffer,
          key,
          value,
          index,
          checkKeys,
          depth,
          serializeFunctions,
          ignoreUndefined
        );
      } else if (typeof value === 'function' && serializeFunctions) {
        index = serializeFunction(buffer, key, value, index, checkKeys, depth, serializeFunctions);
      } else if (value['_bsontype'] === 'Binary') {
        index = serializeBinary(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Symbol') {
        index = serializeSymbol(buffer, key, value, index);
      } else if (value['_bsontype'] === 'DBRef') {
        index = serializeDBRef(buffer, key, value, index, depth, serializeFunctions);
      } else if (value['_bsontype'] === 'BSONRegExp') {
        index = serializeBSONRegExp(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Int32') {
        index = serializeInt32(buffer, key, value, index);
      } else if (value['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
        index = serializeMinMax(buffer, key, value, index);
      } else if (typeof value['_bsontype'] !== 'undefined') {
        throw new BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
      }
    }
  } else {
    if (typeof object?.toBSON === 'function') {
      // Provided a custom serialization method
      object = object.toBSON();
      if (object != null && typeof object !== 'object') {
        throw new BSONTypeError('toBSON function did not return an object');
      }
    }

    // Iterate over all the keys
    for (const key in object) {
      let value = object[key];
      // Is there an override value
      if (typeof value?.toBSON === 'function') {
        value = value.toBSON();
      }

      // Check the type of the value
      const type = typeof value;

      // Check the key and throw error if it's illegal
      if (typeof key === 'string' && !ignoreKeys.has(key)) {
        if (key.match(regexp) != null) {
          // The BSON spec doesn't allow keys with null bytes because keys are
          // null-terminated.
          throw Error('key ' + key + ' must not contain null bytes');
        }

        if (checkKeys) {
          if ('$' === key[0]) {
            throw Error('key ' + key + " must not start with '$'");
          } else if (~key.indexOf('.')) {
            throw Error('key ' + key + " must not contain '.'");
          }
        }
      }

      if (type === 'string') {
        index = serializeString(buffer, key, value, index);
      } else if (type === 'number') {
        index = serializeNumber(buffer, key, value, index);
      } else if (type === 'bigint') {
        throw new BSONTypeError('Unsupported type BigInt, please use Decimal128');
      } else if (type === 'boolean') {
        index = serializeBoolean(buffer, key, value, index);
      } else if (value instanceof Date || isDate(value)) {
        index = serializeDate(buffer, key, value, index);
      } else if (value === undefined) {
        if (ignoreUndefined === false) index = serializeNull(buffer, key, value, index);
      } else if (value === null) {
        index = serializeNull(buffer, key, value, index);
      } else if (value['_bsontype'] === 'ObjectId' || value['_bsontype'] === 'ObjectID') {
        index = serializeObjectId(buffer, key, value, index);
      } else if (isUint8Array(value)) {
        index = serializeBuffer(buffer, key, value, index);
      } else if (value instanceof RegExp || isRegExp(value)) {
        index = serializeRegExp(buffer, key, value, index);
      } else if (type === 'object' && value['_bsontype'] == null) {
        index = serializeObject(
          buffer,
          key,
          value,
          index,
          checkKeys,
          depth,
          serializeFunctions,
          ignoreUndefined,
          false,
          path
        );
      } else if (type === 'object' && value['_bsontype'] === 'Decimal128') {
        index = serializeDecimal128(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Long' || value['_bsontype'] === 'Timestamp') {
        index = serializeLong(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Double') {
        index = serializeDouble(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Code') {
        index = serializeCode(
          buffer,
          key,
          value,
          index,
          checkKeys,
          depth,
          serializeFunctions,
          ignoreUndefined
        );
      } else if (typeof value === 'function' && serializeFunctions) {
        index = serializeFunction(buffer, key, value, index, checkKeys, depth, serializeFunctions);
      } else if (value['_bsontype'] === 'Binary') {
        index = serializeBinary(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Symbol') {
        index = serializeSymbol(buffer, key, value, index);
      } else if (value['_bsontype'] === 'DBRef') {
        index = serializeDBRef(buffer, key, value, index, depth, serializeFunctions);
      } else if (value['_bsontype'] === 'BSONRegExp') {
        index = serializeBSONRegExp(buffer, key, value, index);
      } else if (value['_bsontype'] === 'Int32') {
        index = serializeInt32(buffer, key, value, index);
      } else if (value['_bsontype'] === 'MinKey' || value['_bsontype'] === 'MaxKey') {
        index = serializeMinMax(buffer, key, value, index);
      } else if (typeof value['_bsontype'] !== 'undefined') {
        throw new BSONTypeError('Unrecognized or invalid _bsontype: ' + value['_bsontype']);
      }
    }
  }

  // Remove the path
  path.pop();

  // Final padding byte for object
  buffer[index++] = 0x00;

  // Final size
  const size = index - startingIndex;
  // Write the size of the object
  buffer[startingIndex++] = size & 0xff;
  buffer[startingIndex++] = (size >> 8) & 0xff;
  buffer[startingIndex++] = (size >> 16) & 0xff;
  buffer[startingIndex++] = (size >> 24) & 0xff;
  return index;
}
