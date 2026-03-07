# js-web-holons

**Browser-side Holon-RPC client with remote-manifest discovery helpers
and a Node test/server harness.**

This SDK is the browser counterpart to the Go WebBridge and other
Holon-RPC servers. It does not scan the local filesystem and it does not
provide a process-launching `connect()` helper in the browser.

## Discovery helpers

```js
import { discoverFromManifest, findBySlug } from "./src/index.mjs";

const entries = await discoverFromManifest("/holon.yaml");
const entry = findBySlug(entries, "atlas-daemon");
```

- `discoverFromManifest(url, options?)` fetches a remote `holon.yaml` or
  JSON manifest document and normalizes it into `HolonEntry` records.
- `findBySlug(entries, slug)` resolves a specific entry from that set.

## Holon-RPC usage

```js
import { HolonClient } from "./src/index.mjs";

const client = new HolonClient("ws://localhost:8080/ws");
const resp = await client.invoke("hello.v1.HelloService/Greet", { name: "Alice" });
console.log(resp.message);
client.close();
```

## API

- `discoverFromManifest(url, options?)`
- `findBySlug(entries, slug)`
- `new HolonClient(url, options?)`
- `client.connect()`
- `client.invoke(method, payload?, options?)`
- `client.register(method, handler)`
- `client.close()`
- `new HolonServer(uri, options?)` for Node-based testing and certification

## Test and sync

```bash
npm install
npm test
```

`examples/web-hello-world/static/holons.mjs` is a synced copy of this
SDK surface.
