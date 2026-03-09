/**
 * Browser environments cannot spawn processes or scan the filesystem.
 * connect() in js-web-holons only supports direct host:port addressing.
 * For slug-based resolution, use a Node.js environment with js-holons.
 */

import { HolonClient } from "./index.mjs";

const GRPC_WEB_CONTENT_TYPE = "application/grpc-web+proto";

export class GrpcWebClient {
    #baseUrl;
    #fetch;
    #closed = false;
    #controllers = new Set();

    constructor(baseUrl, options = {}) {
        this.#baseUrl = normalizeBaseUrl(baseUrl);
        this.#fetch = options.fetch ?? defaultFetch();
        if (typeof this.#fetch !== "function") {
            throw new Error("fetch implementation required");
        }
    }

    get baseUrl() {
        return this.#baseUrl;
    }

    makeUnaryRequest(path, serialize, deserialize, request, metadata, callback) {
        const normalized = normalizeCallbackArgs(metadata, callback);
        const controller = new AbortController();

        if (this.#closed) {
            queueMicrotask(() => {
                normalized.callback(new Error("client is closed"), null);
            });
            return { cancel() {} };
        }

        this.#controllers.add(controller);

        void this.unary(path, serialize, deserialize, request, normalized.metadata, {
            signal: controller.signal,
        }).then(
            (response) => {
                normalized.callback(null, response);
            },
            (err) => {
                normalized.callback(err, null);
            },
        ).finally(() => {
            this.#controllers.delete(controller);
        });

        return {
            cancel: () => {
                controller.abort();
            },
        };
    }

    async unary(path, serialize, deserialize, request, metadata = {}, options = {}) {
        if (this.#closed) {
            throw new Error("client is closed");
        }
        if (typeof serialize !== "function") {
            throw new TypeError("serialize must be a function");
        }
        if (typeof deserialize !== "function") {
            throw new TypeError("deserialize must be a function");
        }

        const response = await this.#fetch(joinURL(this.#baseUrl, normalizeMethodPath(path)), {
            method: "POST",
            headers: buildRequestHeaders(metadata),
            body: encodeGrpcWebRequest(serialize(request)),
            signal: options.signal,
        });

        const body = new Uint8Array(await response.arrayBuffer());
        const parsed = parseGrpcWebResponse(body);
        const status = parsed.grpcStatus ?? parseInteger(response.headers?.get?.("grpc-status"), 0);
        const message = parsed.grpcMessage
            || decodeGrpcMessage(response.headers?.get?.("grpc-message"))
            || response.statusText
            || "request failed";

        if (!response.ok && status === 0) {
            throw new Error(`gRPC-Web HTTP ${response.status}: ${message}`);
        }
        if (status !== 0) {
            const err = new Error(`gRPC-Web ${status}: ${message}`);
            err.code = status;
            throw err;
        }

        return deserialize(parsed.message ?? new Uint8Array());
    }

    close() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        for (const controller of this.#controllers) {
            controller.abort();
        }
        this.#controllers.clear();
    }
}

export function connect(hostPort) {
    const target = normalizeTarget(hostPort);
    if (target.kind === "holon-rpc") {
        return new HolonClient(target.url);
    }
    return new GrpcWebClient(target.baseUrl);
}

export function disconnect(client) {
    if (!client) {
        return;
    }
    if (typeof client.close === "function") {
        client.close();
    }
}

function defaultFetch() {
    if (typeof globalThis.fetch !== "function") {
        return undefined;
    }
    return globalThis.fetch.bind(globalThis);
}

function normalizeTarget(hostPort) {
    const value = String(hostPort || "").trim();
    if (!value) {
        throw new Error("target is required");
    }

    if (/^wss?:\/\//i.test(value)) {
        return { kind: "holon-rpc", url: normalizeSocketUrl(value) };
    }

    if (/^https?:\/\//i.test(value)) {
        return { kind: "grpc-web", baseUrl: normalizeBaseUrl(value) };
    }

    if (value.includes("://")) {
        throw new Error(`unsupported browser connect target: ${value}`);
    }

    const direct = tryParseHttpTarget(value);
    if (direct) {
        return { kind: "grpc-web", baseUrl: direct };
    }

    throw new Error(
        `browser connect() only supports direct host:port targets; slug resolution is unavailable in js-web-holons. Use js-holons in Node.js for slug-based resolution: ${JSON.stringify(value)}`,
    );
}

function normalizeBaseUrl(value) {
    let parsed;
    try {
        parsed = new URL(String(value));
    } catch {
        throw new Error(`invalid gRPC-Web target: ${value}`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`gRPC-Web targets must use http:// or https://: ${value}`);
    }

    if (!parsed.hostname) {
        throw new Error(`invalid gRPC-Web target: ${value}`);
    }

    return stripTrailingSlash(parsed.toString());
}

function normalizeSocketUrl(value) {
    let parsed;
    try {
        parsed = new URL(String(value));
    } catch {
        throw new Error(`invalid Holon-RPC target: ${value}`);
    }

    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
        throw new Error(`Holon-RPC targets must use ws:// or wss://: ${value}`);
    }

    return parsed.toString();
}

function tryParseHttpTarget(value) {
    let parsed;
    try {
        parsed = new URL(`http://${value}`);
    } catch {
        return null;
    }

    if (!parsed.hostname || parsed.port === "") {
        return null;
    }

    return stripTrailingSlash(parsed.toString());
}

function stripTrailingSlash(value) {
    if (value.endsWith("/")) {
        return value.slice(0, -1);
    }
    return value;
}

function normalizeMethodPath(path) {
    const value = String(path || "").trim();
    if (!value) {
        throw new TypeError("path must be a non-empty string");
    }
    return value.startsWith("/") ? value : `/${value}`;
}

function joinURL(baseUrl, path) {
    if (baseUrl.endsWith("/") && path.startsWith("/")) {
        return `${baseUrl.slice(0, -1)}${path}`;
    }
    if (!baseUrl.endsWith("/") && !path.startsWith("/")) {
        return `${baseUrl}/${path}`;
    }
    return `${baseUrl}${path}`;
}

function normalizeCallbackArgs(metadata, callback) {
    if (typeof metadata === "function") {
        return {
            metadata: {},
            callback: metadata,
        };
    }
    if (typeof callback !== "function") {
        throw new TypeError("callback must be a function");
    }
    return {
        metadata: metadata ?? {},
        callback,
    };
}

function buildRequestHeaders(metadata) {
    const headers = {
        accept: GRPC_WEB_CONTENT_TYPE,
        "content-type": GRPC_WEB_CONTENT_TYPE,
        "x-grpc-web": "1",
        "x-user-agent": "js-web-holons/0.1",
    };

    if (metadata && typeof metadata === "object") {
        for (const [key, value] of readHeaderEntries(metadata)) {
            headers[key] = value;
        }
    }

    return headers;
}

function readHeaderEntries(metadata) {
    if (typeof metadata?.entries === "function") {
        return Array.from(metadata.entries(), ([key, value]) => [String(key).toLowerCase(), String(value)]);
    }
    return Object.entries(metadata).map(([key, value]) => [String(key).toLowerCase(), String(value)]);
}

function encodeGrpcWebRequest(message) {
    const bytes = toUint8Array(message);
    const frame = new Uint8Array(5 + bytes.length);
    const view = new DataView(frame.buffer);
    view.setUint8(0, 0x00);
    view.setUint32(1, bytes.length, false);
    frame.set(bytes, 5);
    return frame;
}

function parseGrpcWebResponse(buffer) {
    let offset = 0;
    let message = null;
    let grpcStatus = null;
    let grpcMessage = "";

    while (offset < buffer.length) {
        if ((offset + 5) > buffer.length) {
            throw new Error("malformed gRPC-Web frame");
        }

        const frameType = buffer[offset];
        const frameLength = readUInt32BE(buffer, offset + 1);
        const frameStart = offset + 5;
        const frameEnd = frameStart + frameLength;

        if (frameEnd > buffer.length) {
            throw new Error("malformed gRPC-Web frame");
        }

        const frame = buffer.slice(frameStart, frameEnd);
        if ((frameType & 0x80) === 0x80) {
            const trailers = parseTrailers(frame);
            grpcStatus = parseInteger(trailers["grpc-status"], grpcStatus);
            grpcMessage = decodeGrpcMessage(trailers["grpc-message"]) || grpcMessage;
        } else {
            message = frame;
        }

        offset = frameEnd;
    }

    return { message, grpcStatus, grpcMessage };
}

function parseTrailers(frame) {
    const text = new TextDecoder().decode(frame);
    const trailers = {};

    for (const line of text.split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon < 0) {
            continue;
        }
        const key = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (key) {
            trailers[key] = value;
        }
    }

    return trailers;
}

function parseInteger(value, fallback) {
    if (value == null || value === "") {
        return fallback;
    }
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function decodeGrpcMessage(value) {
    if (typeof value !== "string" || value === "") {
        return "";
    }

    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function readUInt32BE(buffer, offset) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return view.getUint32(offset, false);
}

function toUint8Array(value) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (typeof value === "string") {
        return new TextEncoder().encode(value);
    }
    throw new TypeError("serialize must return bytes");
}
