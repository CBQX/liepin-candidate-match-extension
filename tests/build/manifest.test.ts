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

  it("does not request broad browsing or wildcard host access", async () => {
    // Break caught: a future manifest edit could silently widen access beyond the
    // user-opened Liepin page and the DeepSeek API required by this MVP.
    const raw = await readFile("public/manifest.json", "utf8");
    const manifest = JSON.parse(raw) as {
      permissions?: string[];
      optional_permissions?: string[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };
    const forbiddenPermissions = [
      "tabs",
      "history",
      "cookies",
      "webRequest",
      "unlimitedStorage"
    ];
    const wildcardHosts = ["<all_urls>", "*://*/*", "http://*/*", "https://*/*"];

    const requestedPermissions = [
      ...(manifest.permissions ?? []),
      ...(manifest.optional_permissions ?? [])
    ];
    const requestedHosts = [
      ...(manifest.host_permissions ?? []),
      ...(manifest.optional_host_permissions ?? [])
    ];

    expect(requestedPermissions).not.toEqual(
      expect.arrayContaining(forbiddenPermissions)
    );
    expect(requestedHosts).not.toEqual(
      expect.arrayContaining(wildcardHosts)
    );
  });
});
