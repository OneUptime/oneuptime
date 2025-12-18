import { JSONObject } from "Common/Types/JSON";

export interface CodeExamples {
  curl: string;
  javascript: string;
  typescript: string;
  python: string;
  go: string;
  java: string;
  csharp: string;
  php: string;
  ruby: string;
  rust: string;
  powershell: string;
}

export interface ApiRequestParams {
  method: "GET" | "POST" | "PUT" | "DELETE";
  endpoint: string;
  body?: JSONObject;
  description?: string;
}

export default class CodeExampleGenerator {
  private static readonly API_KEY_PLACEHOLDER: string = "YOUR_API_KEY";
  private static readonly PROJECT_ID_PLACEHOLDER: string = "YOUR_PROJECT_ID";
  private static readonly BASE_URL: string = "https://oneuptime.com";

  public static generate(params: ApiRequestParams): CodeExamples {
    return {
      curl: this.generateCurl(params),
      javascript: this.generateJavaScript(params),
      typescript: this.generateTypeScript(params),
      python: this.generatePython(params),
      go: this.generateGo(params),
      java: this.generateJava(params),
      csharp: this.generateCSharp(params),
      php: this.generatePHP(params),
      ruby: this.generateRuby(params),
      rust: this.generateRust(params),
      powershell: this.generatePowerShell(params),
    };
  }

  private static generateCurl(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let curlCmd: string = `curl -X ${method} "${url}"`;
    curlCmd += ` \\\n  -H "Content-Type: application/json"`;
    curlCmd += ` \\\n  -H "ApiKey: ${this.API_KEY_PLACEHOLDER}"`;
    curlCmd += ` \\\n  -H "ProjectID: ${this.PROJECT_ID_PLACEHOLDER}"`;

    if (body && Object.keys(body).length > 0) {
      const jsonBody: string = JSON.stringify(body, null, 2)
        .split("\n")
        .map((line: string, index: number) =>
          index === 0 ? line : `  ${line}`,
        )
        .join("\n");
      curlCmd += ` \\\n  -d '${jsonBody}'`;
    }

    return curlCmd;
  }

  private static generateJavaScript(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `const response = await fetch("${url}", {
  method: "${method}",
  headers: {
    "Content-Type": "application/json",
    "ApiKey": "${this.API_KEY_PLACEHOLDER}",
    "ProjectID": "${this.PROJECT_ID_PLACEHOLDER}"
  }`;

    if (body && Object.keys(body).length > 0) {
      const jsonBody: string = JSON.stringify(body, null, 2)
        .split("\n")
        .map((line: string, index: number) =>
          index === 0 ? line : `  ${line}`,
        )
        .join("\n");
      code += `,\n  body: JSON.stringify(${jsonBody})`;
    }

    code += `
});

const data = await response.json();
console.log(data);`;

    return code;
  }

  private static generateTypeScript(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `interface ApiResponse {
  // Define your response type here
  [key: string]: unknown;
}

const response = await fetch("${url}", {
  method: "${method}",
  headers: {
    "Content-Type": "application/json",
    "ApiKey": "${this.API_KEY_PLACEHOLDER}",
    "ProjectID": "${this.PROJECT_ID_PLACEHOLDER}"
  }`;

    if (body && Object.keys(body).length > 0) {
      const jsonBody: string = JSON.stringify(body, null, 2)
        .split("\n")
        .map((line: string, index: number) =>
          index === 0 ? line : `  ${line}`,
        )
        .join("\n");
      code += `,\n  body: JSON.stringify(${jsonBody})`;
    }

    code += `
});

const data: ApiResponse = await response.json();
console.log(data);`;

    return code;
  }

  private static generatePython(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `import requests

url = "${url}"
headers = {
    "Content-Type": "application/json",
    "ApiKey": "${this.API_KEY_PLACEHOLDER}",
    "ProjectID": "${this.PROJECT_ID_PLACEHOLDER}"
}`;

    if (body && Object.keys(body).length > 0) {
      const pythonBody: string = this.jsonToPython(body);
      code += `

payload = ${pythonBody}

response = requests.${method.toLowerCase()}(url, json=payload, headers=headers)`;
    } else {
      code += `

response = requests.${method.toLowerCase()}(url, headers=headers)`;
    }

    code += `
print(response.json())`;

    return code;
  }

  private static generateGo(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

func main() {`;

    if (body && Object.keys(body).length > 0) {
      code += `
    payload := map[string]interface{}{`;
      const entries: Array<string> = Object.entries(body).map(
        ([key, value]: [string, unknown]) => {
          return `        "${key}": ${this.goValue(value)}`;
        },
      );
      code += `\n${entries.join(",\n")},
    }
    jsonData, _ := json.Marshal(payload)

    req, _ := http.NewRequest("${method}", "${url}", bytes.NewBuffer(jsonData))`;
    } else {
      code += `
    req, _ := http.NewRequest("${method}", "${url}", nil)`;
    }

    code += `
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("ApiKey", "${this.API_KEY_PLACEHOLDER}")
    req.Header.Set("ProjectID", "${this.PROJECT_ID_PLACEHOLDER}")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    fmt.Println(string(body))
}`;

    return code;
  }

  private static generateJava(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class ApiRequest {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newHttpClient();
`;

    if (body && Object.keys(body).length > 0) {
      const jsonBody: string = JSON.stringify(body, null, 12).replace(
        /"/g,
        '\\"',
      );
      code += `
        String jsonBody = "${jsonBody.replace(/\n/g, "\\n")}";

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("${url}"))
            .header("Content-Type", "application/json")
            .header("ApiKey", "${this.API_KEY_PLACEHOLDER}")
            .header("ProjectID", "${this.PROJECT_ID_PLACEHOLDER}")
            .method("${method}", HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();`;
    } else {
      code += `
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("${url}"))
            .header("Content-Type", "application/json")
            .header("ApiKey", "${this.API_KEY_PLACEHOLDER}")
            .header("ProjectID", "${this.PROJECT_ID_PLACEHOLDER}")
            .method("${method}", HttpRequest.BodyPublishers.noBody())
            .build();`;
    }

    code += `

        HttpResponse<String> response = client.send(request,
            HttpResponse.BodyHandlers.ofString());

        System.out.println(response.body());
    }
}`;

    return code;
  }

  private static generateCSharp(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

class Program
{
    static async Task Main()
    {
        using var client = new HttpClient();

        client.DefaultRequestHeaders.Add("ApiKey", "${this.API_KEY_PLACEHOLDER}");
        client.DefaultRequestHeaders.Add("ProjectID", "${this.PROJECT_ID_PLACEHOLDER}");
`;

    if (body && Object.keys(body).length > 0) {
      const jsonBody: string = JSON.stringify(body, null, 8);
      code += `
        var json = @"${jsonBody.replace(/"/g, '""')}";
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await client.${this.csharpMethod(method)}Async(
            "${url}"${method !== "GET" && method !== "DELETE" ? ", content" : ""});`;
    } else {
      code += `
        var response = await client.${this.csharpMethod(method)}Async("${url}");`;
    }

    code += `

        var result = await response.Content.ReadAsStringAsync();
        Console.WriteLine(result);
    }
}`;

    return code;
  }

  private static generatePHP(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `<?php

$url = "${url}";

$headers = [
    "Content-Type: application/json",
    "ApiKey: ${this.API_KEY_PLACEHOLDER}",
    "ProjectID: ${this.PROJECT_ID_PLACEHOLDER}"
];
`;

    if (body && Object.keys(body).length > 0) {
      code += `
$data = ${this.jsonToPhp(body)};

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${method}");
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));`;
    } else {
      code += `
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${method}");`;
    }

    code += `

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
print_r($result);
?>`;

    return code;
  }

  private static generateRuby(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `require 'net/http'
require 'uri'
require 'json'

uri = URI.parse("${url}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::${this.rubyMethodClass(method)}.new(uri.request_uri)
request["Content-Type"] = "application/json"
request["ApiKey"] = "${this.API_KEY_PLACEHOLDER}"
request["ProjectID"] = "${this.PROJECT_ID_PLACEHOLDER}"`;

    if (body && Object.keys(body).length > 0) {
      const rubyBody: string = this.jsonToRuby(body);
      code += `

request.body = ${rubyBody}.to_json`;
    }

    code += `

response = http.request(request)
puts JSON.parse(response.body)`;

    return code;
  }

  private static generateRust(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert("ApiKey", HeaderValue::from_static("${this.API_KEY_PLACEHOLDER}"));
    headers.insert("ProjectID", HeaderValue::from_static("${this.PROJECT_ID_PLACEHOLDER}"));`;

    if (body && Object.keys(body).length > 0) {
      const rustBody: string = this.jsonToRust(body);
      code += `

    let body = ${rustBody};

    let response = client
        .${method.toLowerCase()}("${url}")
        .headers(headers)
        .json(&body)
        .send()
        .await?;`;
    } else {
      code += `

    let response = client
        .${method.toLowerCase()}("${url}")
        .headers(headers)
        .send()
        .await?;`;
    }

    code += `

    let result: serde_json::Value = response.json().await?;
    println!("{:#?}", result);

    Ok(())
}`;

    return code;
  }

  private static generatePowerShell(params: ApiRequestParams): string {
    const { method, endpoint, body } = params;
    const url: string = `${this.BASE_URL}${endpoint}`;

    let code: string = `$headers = @{
    "Content-Type" = "application/json"
    "ApiKey" = "${this.API_KEY_PLACEHOLDER}"
    "ProjectID" = "${this.PROJECT_ID_PLACEHOLDER}"
}`;

    if (body && Object.keys(body).length > 0) {
      const psBody: string = this.jsonToPowerShell(body);
      code += `

$body = ${psBody} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod -Uri "${url}" -Method ${method} -Headers $headers -Body $body`;
    } else {
      code += `

$response = Invoke-RestMethod -Uri "${url}" -Method ${method} -Headers $headers`;
    }

    code += `
$response | ConvertTo-Json -Depth 10`;

    return code;
  }

  // Helper methods for language-specific formatting

  private static jsonToPython(obj: JSONObject, indent: number = 0): string {
    const spaces: string = "    ".repeat(indent);
    const innerSpaces: string = "    ".repeat(indent + 1);

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return "[]";
      }
      const items: Array<string> = obj.map((item: unknown) =>
        this.jsonToPython(item as JSONObject, indent + 1),
      );
      return `[\n${innerSpaces}${items.join(`,\n${innerSpaces}`)}\n${spaces}]`;
    }

    if (typeof obj === "object" && obj !== null) {
      const entries: Array<string> = Object.entries(obj).map(
        ([key, value]: [string, unknown]) => {
          return `${innerSpaces}"${key}": ${this.pythonValue(value, indent + 1)}`;
        },
      );
      return `{\n${entries.join(",\n")}\n${spaces}}`;
    }

    return this.pythonValue(obj, indent);
  }

  private static pythonValue(value: unknown, indent: number = 0): string {
    if (value === null) {
      return "None";
    }
    if (typeof value === "boolean") {
      return value ? "True" : "False";
    }
    if (typeof value === "string") {
      return `"${value}"`;
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "object") {
      return this.jsonToPython(value as JSONObject, indent);
    }
    return String(value);
  }

  private static goValue(value: unknown): string {
    if (value === null) {
      return "nil";
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "string") {
      return `"${value}"`;
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[]interface{}{${value.map((v: unknown) => this.goValue(v)).join(", ")}}`;
    }
    if (typeof value === "object") {
      const entries: Array<string> = Object.entries(
        value as Record<string, unknown>,
      ).map(([k, v]: [string, unknown]) => {
        return `"${k}": ${this.goValue(v)}`;
      });
      return `map[string]interface{}{${entries.join(", ")}}`;
    }
    return String(value);
  }

  private static jsonToRuby(obj: JSONObject, indent: number = 0): string {
    const spaces: string = "  ".repeat(indent);
    const innerSpaces: string = "  ".repeat(indent + 1);

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return "[]";
      }
      const items: Array<string> = obj.map((item: unknown) =>
        this.jsonToRuby(item as JSONObject, indent + 1),
      );
      return `[\n${innerSpaces}${items.join(`,\n${innerSpaces}`)}\n${spaces}]`;
    }

    if (typeof obj === "object" && obj !== null) {
      const entries: Array<string> = Object.entries(obj).map(
        ([key, value]: [string, unknown]) => {
          return `${innerSpaces}"${key}" => ${this.rubyValue(value, indent + 1)}`;
        },
      );
      return `{\n${entries.join(",\n")}\n${spaces}}`;
    }

    return this.rubyValue(obj, indent);
  }

  private static rubyValue(value: unknown, indent: number = 0): string {
    if (value === null) {
      return "nil";
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "string") {
      return `"${value}"`;
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "object") {
      return this.jsonToRuby(value as JSONObject, indent);
    }
    return String(value);
  }

  private static rubyMethodClass(method: string): string {
    const methodMap: Record<string, string> = {
      GET: "Get",
      POST: "Post",
      PUT: "Put",
      DELETE: "Delete",
    };
    return methodMap[method] || "Get";
  }

  private static csharpMethod(method: string): string {
    const methodMap: Record<string, string> = {
      GET: "Get",
      POST: "Post",
      PUT: "Put",
      DELETE: "Delete",
    };
    return methodMap[method] || "Get";
  }

  private static jsonToRust(obj: JSONObject, indent: number = 0): string {
    const spaces: string = "    ".repeat(indent);
    const innerSpaces: string = "    ".repeat(indent + 1);

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return "json!([])";
      }
      const items: Array<string> = obj.map((item: unknown) =>
        this.rustInnerValue(item, indent + 1),
      );
      return `json!([\n${innerSpaces}${items.join(`,\n${innerSpaces}`)}\n${spaces}])`;
    }

    if (typeof obj === "object" && obj !== null) {
      const entries: Array<string> = Object.entries(obj).map(
        ([key, value]: [string, unknown]) => {
          return `${innerSpaces}"${key}": ${this.rustInnerValue(value, indent + 1)}`;
        },
      );
      return `json!({\n${entries.join(",\n")}\n${spaces}})`;
    }

    return `json!(${this.rustInnerValue(obj, indent)})`;
  }

  private static rustInnerValue(value: unknown, indent: number = 0): string {
    if (value === null) {
      return "null";
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "string") {
      return `"${value}"`;
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (Array.isArray(value)) {
      const spaces: string = "    ".repeat(indent);
      const innerSpaces: string = "    ".repeat(indent + 1);
      const items: Array<string> = value.map((v: unknown) =>
        this.rustInnerValue(v, indent + 1),
      );
      return `[\n${innerSpaces}${items.join(`,\n${innerSpaces}`)}\n${spaces}]`;
    }
    if (typeof value === "object") {
      const spaces: string = "    ".repeat(indent);
      const innerSpaces: string = "    ".repeat(indent + 1);
      const entries: Array<string> = Object.entries(
        value as Record<string, unknown>,
      ).map(([k, v]: [string, unknown]) => {
        return `${innerSpaces}"${k}": ${this.rustInnerValue(v, indent + 1)}`;
      });
      return `{\n${entries.join(",\n")}\n${spaces}}`;
    }
    return String(value);
  }

  private static jsonToPowerShell(
    obj: JSONObject,
    indent: number = 0,
  ): string {
    const spaces: string = "    ".repeat(indent);
    const innerSpaces: string = "    ".repeat(indent + 1);

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return "@()";
      }
      const items: Array<string> = obj.map((item: unknown) =>
        this.jsonToPowerShell(item as JSONObject, indent + 1),
      );
      return `@(\n${innerSpaces}${items.join(`,\n${innerSpaces}`)}\n${spaces})`;
    }

    if (typeof obj === "object" && obj !== null) {
      const entries: Array<string> = Object.entries(obj).map(
        ([key, value]: [string, unknown]) => {
          return `${innerSpaces}${key} = ${this.psValue(value, indent + 1)}`;
        },
      );
      return `@{\n${entries.join("\n")}\n${spaces}}`;
    }

    return this.psValue(obj, indent);
  }

  private static psValue(value: unknown, indent: number = 0): string {
    if (value === null) {
      return "$null";
    }
    if (typeof value === "boolean") {
      return value ? "$true" : "$false";
    }
    if (typeof value === "string") {
      return `"${value}"`;
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "object") {
      return this.jsonToPowerShell(value as JSONObject, indent);
    }
    return String(value);
  }

  private static jsonToPhp(obj: JSONObject, indent: number = 0): string {
    const spaces: string = "    ".repeat(indent);
    const innerSpaces: string = "    ".repeat(indent + 1);

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return "[]";
      }
      const items: Array<string> = obj.map((item: unknown) =>
        this.jsonToPhp(item as JSONObject, indent + 1),
      );
      return `[\n${innerSpaces}${items.join(`,\n${innerSpaces}`)}\n${spaces}]`;
    }

    if (typeof obj === "object" && obj !== null) {
      const entries: Array<string> = Object.entries(obj).map(
        ([key, value]: [string, unknown]) => {
          return `${innerSpaces}"${key}" => ${this.phpValue(value, indent + 1)}`;
        },
      );
      return `[\n${entries.join(",\n")}\n${spaces}]`;
    }

    return this.phpValue(obj, indent);
  }

  private static phpValue(value: unknown, indent: number = 0): string {
    if (value === null) {
      return "null";
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "string") {
      return `"${value}"`;
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "object") {
      return this.jsonToPhp(value as JSONObject, indent);
    }
    return String(value);
  }
}
