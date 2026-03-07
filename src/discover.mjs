function sanitizeValue(raw) {
    let value = String(raw || "").trim();
    const hash = value.indexOf("#");
    if (hash >= 0) {
        value = value.slice(0, hash).trim();
    }
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.slice(1, -1);
    }
    return value;
}

function parseManifestText(text, sourceURL) {
    let sawMapping = false;
    let section = "";
    const identity = {
        uuid: "",
        given_name: "",
        family_name: "",
        motto: "",
        composer: "",
        clade: "",
        status: "",
        born: "",
        lang: "",
        parents: [],
        reproduction: "",
        generated_by: "",
        proto_status: "",
        aliases: [],
    };
    const manifest = {
        kind: "",
        build: { runner: "", main: "" },
        artifacts: { binary: "", primary: "" },
    };

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const colon = trimmed.indexOf(":");
        if (colon < 0) {
            continue;
        }

        sawMapping = true;
        const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
        const key = trimmed.slice(0, colon).trim();
        const value = sanitizeValue(trimmed.slice(colon + 1));

        if (indent === 0) {
            if ((key === "build" || key === "artifacts") && value === "") {
                section = key;
            } else {
                section = "";
                if (key in identity) {
                    identity[key] = value;
                } else if (key === "kind") {
                    manifest.kind = value;
                }
            }
            continue;
        }

        if (section === "build") {
            if (key === "runner") manifest.build.runner = value;
            if (key === "main") manifest.build.main = value;
        } else if (section === "artifacts") {
            if (key === "binary") manifest.artifacts.binary = value;
            if (key === "primary") manifest.artifacts.primary = value;
        }
    }

    if (!sawMapping) {
        throw new Error(`${sourceURL}: holon.yaml must be a YAML mapping`);
    }

    return { identity, manifest };
}

function slugFor(identity) {
    const given = String(identity.given_name || "").trim();
    const family = String(identity.family_name || "").trim().replace(/\?$/, "");
    if (!given && !family) {
        return "";
    }
    return `${given}-${family}`
        .trim()
        .toLowerCase()
        .replace(/ /g, "-")
        .replace(/^-+|-+$/g, "");
}

function toEntry(document, sourceURL) {
    const url = new URL(sourceURL);
    const relativePath = url.pathname.replace(/^\/+/, "") || ".";
    return {
        slug: slugFor(document.identity),
        uuid: document.identity.uuid || "",
        dir: sourceURL,
        relative_path: relativePath,
        origin: "remote",
        identity: document.identity,
        manifest: document.manifest,
    };
}

export async function discoverFromManifest(url, options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
        throw new Error("fetch implementation required");
    }

    const response = await fetchImpl(url, {
        headers: {
            Accept: "application/yaml, text/yaml, text/plain, application/json",
        },
    });
    if (!response.ok) {
        throw new Error(`failed to fetch manifest: ${response.status} ${response.statusText}`);
    }

    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    const text = await response.text();
    if (contentType.includes("application/json")) {
        const parsed = JSON.parse(text);
        const docs = Array.isArray(parsed) ? parsed : [parsed];
        return docs.map((doc) => toEntry({
            identity: {
                uuid: String(doc.uuid || ""),
                given_name: String(doc.given_name || ""),
                family_name: String(doc.family_name || ""),
                motto: String(doc.motto || ""),
                composer: String(doc.composer || ""),
                clade: String(doc.clade || ""),
                status: String(doc.status || ""),
                born: String(doc.born || ""),
                lang: String(doc.lang || ""),
                parents: Array.isArray(doc.parents) ? doc.parents.map(String) : [],
                reproduction: String(doc.reproduction || ""),
                generated_by: String(doc.generated_by || ""),
                proto_status: String(doc.proto_status || ""),
                aliases: Array.isArray(doc.aliases) ? doc.aliases.map(String) : [],
            },
            manifest: {
                kind: String(doc.kind || ""),
                build: {
                    runner: String(doc.build?.runner || ""),
                    main: String(doc.build?.main || ""),
                },
                artifacts: {
                    binary: String(doc.artifacts?.binary || ""),
                    primary: String(doc.artifacts?.primary || ""),
                },
            },
        }, url));
    }

    return [toEntry(parseManifestText(text, url), url)];
}

export function findBySlug(entries, slug) {
    const needle = String(slug || "").trim();
    if (!needle) {
        return null;
    }

    let match = null;
    for (const entry of entries || []) {
        if (entry?.slug !== needle) {
            continue;
        }
        if (match && match.uuid !== entry.uuid) {
            throw new Error(`ambiguous holon "${needle}"`);
        }
        match = entry;
    }
    return match;
}
