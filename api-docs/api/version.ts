import Express from 'common-server/utils/express';
const { Request, Response } = Express.getLibrary();

const version = (req: Request, res: Response) => {
    res.send({ docsVersion: process.env.npm_package_version });
};

export default version;
