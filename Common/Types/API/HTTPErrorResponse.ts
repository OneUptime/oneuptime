import BaseModel from '../../Models/BaseModel';
import { JSONObjectOrArray } from '../JSON';
import HTTPResponse from './HTTPResponse';

export default class HTTPErrorResponse<T extends JSONObjectOrArray | BaseModel | Array<BaseModel>> extends HTTPResponse<T> {}
