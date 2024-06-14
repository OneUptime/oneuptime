export type MockFunction = jest.Mock<any, any>;

const getJestMockFunction = (): MockFunction => {
  return jest.fn() as MockFunction;
};

export default getJestMockFunction;
