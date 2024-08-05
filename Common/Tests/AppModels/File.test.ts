import File from "../../AppModels/Models/File";
import { describe, expect, it } from "@jest/globals";
import BaseModel from "../../Models/BaseModel";

describe("File", () => {
  it("should be an instance of BaseModel", () => {
    const file: File = new File();
    expect(file).toBeInstanceOf(BaseModel);
  });
});
