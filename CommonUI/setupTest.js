import jest from "jest";

jest.mock("remark-gfm", () => {
  return () => {};
});
