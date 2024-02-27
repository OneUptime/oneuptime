import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';

export type ExpressAPIFunctionType = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
) => Promise<void>;
