import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("targets Chrome 116 MV3 with only MVP permissions", async () => {
    const raw = await readFile("public/manifest.json", "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.permissions.sort()).toEqual(["sidePanel", "storage"]);
    expect(manifest.host_permissions.sort()).toEqual([
      "https://*.liepin.com/*",
      "https://api.deepseek.com/*"
    ]);
  });
});
