import File from "../../Models/DatabaseModels/File";
import { describe, expect, it } from "@jest/globals";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";


describe("File", () => {
  it("should be an instance of BaseModel", () => {
    const file: File = new File();
    expect(file).toBeInstanceOf(BaseModel);
  });
});
