import { Request, Response } from 'common-server/utils/express';

const version = (req: Request, res: Response) => {
    res.send({ docsVersion: process.env.npm_package_version });
};

export default version;
