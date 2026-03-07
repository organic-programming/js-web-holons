import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { discoverFromManifest, findBySlug } from "../src/discover.mjs";

describe("discoverFromManifest", () => {
    it("parses a remote holon manifest and resolves by slug", async () => {
        const yaml = [
            "schema: holon/v0",
            'uuid: "abc-123"',
            'given_name: "Rob"',
            'family_name: "Go"',
            "kind: native",
            "build:",
            "  runner: go-module",
            "artifacts:",
            "  binary: rob-go",
            "",
        ].join("\n");
        const url = `data:text/plain,${encodeURIComponent(yaml)}`;

        const entries = await discoverFromManifest(url);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].slug, "rob-go");
        assert.equal(entries[0].manifest.build.runner, "go-module");
        assert.equal(findBySlug(entries, "rob-go")?.uuid, "abc-123");
    });
});
