export type MockFunction = jest.Mock<any, any>;

type GetJestMockFunction = () => MockFunction;

const getJestMockFunction: GetJestMockFunction = (): MockFunction => {
  return jest.fn() as MockFunction;
};

export default getJestMockFunction;
