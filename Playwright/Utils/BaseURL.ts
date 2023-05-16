const BASE_URL: string =
    process.env['BASE_URL' as keyof typeof process.env] || 'http://localhost';

export default BASE_URL;
