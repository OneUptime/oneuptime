type GetJestSpyOnFunction = (
  obj: any,
  method: string,
) => jest.SpyInstance<any, any>;

export const getJestSpyOn: GetJestSpyOnFunction = (
  obj: any,
  method: string,
): jest.SpyInstance<any, any> => {
  return jest.spyOn(obj, method) as jest.SpyInstance<any, any>;
};
