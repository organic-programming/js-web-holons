import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

import { HolonClient, describe as holonDescribe } from "../src/index.mjs";
import { HolonServer } from "../src/server.mjs";

const ECHO_PROTO = `syntax = "proto3";
package echo.v1;

// Echo echoes request payloads for documentation tests.
service Echo {
  // Ping echoes the inbound message.
  // @example {"message":"hello","sdk":"go-holons"}
  rpc Ping(PingRequest) returns (PingResponse);
}

message PingRequest {
  // Message to echo back.
  // @required
  // @example "hello"
  string message = 1;

  // SDK marker included in the response.
  // @example "go-holons"
  string sdk = 2;
}

message PingResponse {
  // Echoed message.
  string message = 1;

  // SDK marker from the server.
  string sdk = 2;
}
`;

const HOLON_PROTO = `syntax = "proto3";

package holons.test.v1;

option (holons.v1.manifest) = {
  identity: {
    uuid: "echo-server-0000"
    given_name: "Echo"
    family_name: "Server"
    motto: "Reply precisely."
    composer: "describe-test"
    status: "draft"
    born: "2026-03-17"
  }
  lang: "javascript"
};
`;

function makeHolonDir(includeProto = true) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "js-web-describe-"));
    fs.writeFileSync(path.join(root, "holon.proto"), HOLON_PROTO);
    if (includeProto) {
        const protoDir = path.join(root, "protos", "echo", "v1");
        fs.mkdirSync(protoDir, { recursive: true });
        fs.writeFileSync(path.join(protoDir, "echo.proto"), ECHO_PROTO);
    }
    return root;
}

function removeDir(root) {
    fs.rmSync(root, { recursive: true, force: true });
}

describe("describe", () => {
    it("buildResponse() extracts docs from echo proto", () => {
        const root = makeHolonDir(true);
        try {
            const response = holonDescribe.buildResponse(
                path.join(root, "protos"),
            );

            assert.equal(response.manifest.identity.given_name, "Echo");
            assert.equal(response.manifest.identity.family_name, "Server");
            assert.equal(response.manifest.identity.motto, "Reply precisely.");
            assert.equal(response.services.length, 1);
            assert.equal(response.services[0].name, "echo.v1.Echo");
            assert.equal(response.services[0].methods[0].name, "Ping");
            assert.equal(
                response.services[0].methods[0].example_input,
                '{"message":"hello","sdk":"go-holons"}',
            );
        } finally {
            removeDir(root);
        }
    });

    it("register() exposes HolonMeta Describe on HolonServer", async () => {
        const root = makeHolonDir(true);
        const server = new HolonServer("ws://127.0.0.1:0/rpc", { maxConnections: 1 });
        holonDescribe.register(server, path.join(root, "protos"));

        const uri = await server.start();
        const client = new HolonClient(uri, {
            WebSocket,
            reconnect: false,
            heartbeat: false,
        });

        try {
            const response = await client.invoke(holonDescribe.HOLON_META_METHOD, {});
            assert.equal(response.manifest.identity.given_name, "Echo");
            assert.equal(response.manifest.identity.motto, "Reply precisely.");
            assert.deepEqual(response.services.map((service) => service.name), ["echo.v1.Echo"]);
        } finally {
            client.close();
            await server.close();
            removeDir(root);
        }
    });

    it("buildResponse() degrades gracefully when protos are missing", () => {
        const root = makeHolonDir(false);
        try {
            const response = holonDescribe.buildResponse(
                path.join(root, "protos"),
            );

            assert.equal(response.manifest.identity.given_name, "Echo");
            assert.equal(response.manifest.identity.motto, "Reply precisely.");
            assert.deepEqual(response.services, []);
        } finally {
            removeDir(root);
        }
    });
});
