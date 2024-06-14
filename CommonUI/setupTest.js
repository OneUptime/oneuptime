import { jest } from "globals";

jest.mock("remark-gfm", () => {
  return () => {};
});
