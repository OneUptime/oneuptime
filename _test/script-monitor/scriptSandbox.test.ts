import { expect } from "chai"

import { runScript } from "./scriptSandbox"
import axios from 'axios';


describe('ScriptMonitor V2', function() {
  this.timeout(10000);
  
  describe("runScript function", function(){
    let server: $TSFixMe;
    
    // create a quick express server
    
    before(function(){
      
      import express from "express"
      const app = express();
      app.get("/test", (req: $TSFixMe, res: $TSFixMe) => res.send("yipee!"));
      server = app.listen(5050);
    });

    // close express server
    
    after(function(){
      server.close();
    });

    
    it("should return success for a valid script", async function() {     
      const someFunction = async (done: $TSFixMe) => {

        

        const res = await axios.get("http://localhost:5050/test");
        
        done();
      }
      
      const result = await runScript(someFunction.toString(), true);      
      expect(result).to.not.be.undefined;
      expect(result.success).to.be.true;
      expect(result.status).eq("completed");
      expect(result.executionTime).to.be.a('number');
      console.log(result.executionTime);
      
      expect(result.consoleLogs.length).eql(2);
      expect(result.consoleLogs).to.include('[log]: hello');
      expect(result.consoleLogs).to.include('[log]: world!');

    });

    
    it("should return false for error thrown in script", async function() {
      const someFunction = async (done: $TSFixMe) => {
        console.log('Error log');
        console.error('Bad Error');
        throw new Error("Bad error");
      }
      const result = await runScript(someFunction.toString(), true);
      
      expect(result).to.not.be.undefined;
      expect(result.success).to.be.false;
      expect(result.status).eq("error");
      expect(result.executionTime).to.be.a('number');
      
      console.log(result.executionTime);

      expect(result.consoleLogs.length).eql(2);
      expect(result.consoleLogs).to.include('[error]: Bad Error');
      expect(result.consoleLogs).to.include('[log]: Error log');
    });

    
    it("should return scriptMonitor error when script returns a value in cb", async function() {
      const someFunction = async (done: $TSFixMe) => {
        done("Some Error");
      }
      const result = await runScript(someFunction.toString(), true);
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).to.be.string("Script monitor resource error");
      expect(result.errors).to.be.ok;
      expect(result.status).eq("nonEmptyCallback");
      expect(result.executionTime).to.be.a('number');
      console.log(result.executionTime);
    });

    
    it("should return timeout error when script takes too long", async function() {
      const someFunction = async (done: $TSFixMe) => {
        return new Promise((resolve) => {
          setTimeout(() => "All timed out", 7000);
        })
      }
      const result = await runScript(someFunction.toString(), true, {maxScriptRunTime: 1500});
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).contains("Max. script execution time exceeded");
      expect(result.status).eq("timeout");
      expect(result.executionTime).to.be.a('number');
      console.log(result.executionTime);
    });

    
    it("should return timeout error when statement takes too long", async function() {
      const someFunction = async (done: $TSFixMe) => {
        while(true){
          // statement stuck in loop or too busy
        }
      }
      const result = await runScript(someFunction.toString(), true, {maxSyncStatementDuration: 300});
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).contains("Max. synchronous statement execution time exceeded");
      expect(result.status).eq("timeout");
      expect(result.executionTime).to.be.a('number');
      console.log(result.executionTime);
    });
  });
  
});
