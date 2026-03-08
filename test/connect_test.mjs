import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { connect, disconnect, GrpcWebClient } from "../src/index.mjs";

describe("connect", () => {
    it('returns a gRPC-Web client for "host:port"', () => {
        const client = connect("localhost:9090");

        assert.ok(client);
        assert.ok(client instanceof GrpcWebClient);
        assert.equal(client.baseUrl, "http://localhost:9090");
    });

    it("throws for bare slug targets", () => {
        assert.throws(
            () => connect("my-holon"),
            /direct host:port targets; slug resolution is unavailable in js-web-holons/i,
        );
    });

    it("disconnects a valid client without throwing", () => {
        const client = connect("localhost:9090");
        assert.doesNotThrow(() => disconnect(client));
    });
});
