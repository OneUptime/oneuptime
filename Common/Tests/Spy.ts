export const getJestSpyOn = (obj: any, method: string): jest.SpyInstance<any, any>  => {
    return jest.spyOn(obj, method) as jest.SpyInstance<any, any>;
}