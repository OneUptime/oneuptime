import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';

export type ExpressAPIFunction = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
) => Promise<void>;
