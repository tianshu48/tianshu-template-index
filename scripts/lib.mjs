import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";

export const WS_MAGIC = Buffer.from("TSU1ZST\n");
export const MAX_PACK = 64 * 1024 * 1024;
export const MAX_UNCOMPRESSED = 128 * 1024 * 1024;
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const EXPORT_DIRS = new Set(["graphs", "nodes", "time-configs", "sheets"]);
const PACK_URL =
  /^https:\/\/(github\.com|gitcode\.com)\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/?#]+\.tianshu$/;

export function listableTemplateId(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(id)) return false;
  const low = id.toLowerCase();
  for (const part of low.split(".")) {
    if (part === "tianshu" || part === "tianshu48" || part.startsWith("tianshu-") || part.startsWith("tianshu48-")) {
      return false;
    }
  }
  return true;
}

export function userIdOk(id) {
  return typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
}

export function packUrlOk(url) {
  return typeof url === "string" && PACK_URL.test(url);
}

export function sanitizeTarRel(name) {
  const n = String(name || "").replaceAll("\\", "/");
  if (!n || n.includes("\0") || n.startsWith("/")) throw new Error("pack path");
  const parts = [];
  for (const p of n.split("/")) {
    if (!p || p === ".") continue;
    if (p === ".." || p.startsWith(".")) throw new Error("pack path");
    parts.push(p);
  }
  if (parts.length === 1 && parts[0] === "workspace.json") return "workspace.json";
  if (parts.length === 2 && EXPORT_DIRS.has(parts[0]) && !parts[1].includes("/")) {
    return `${parts[0]}/${parts[1]}`;
  }
  throw new Error(`pack path ${n}`);
}

export function openTianshuPack(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < WS_MAGIC.length || !buf.subarray(0, WS_MAGIC.length).equals(WS_MAGIC)) {
    throw new Error("not a .tianshu pack");
  }
  if (buf.length > MAX_PACK) throw new Error("pack too large");
  const tar = zstdDecompressSync(buf.subarray(WS_MAGIC.length));
  if (tar.length > MAX_UNCOMPRESSED) throw new Error("pack too large");
  const names = [];
  let o = 0;
  while (o + 512 <= tar.length) {
    const block = tar.subarray(o, o + 512);
    if (block.every((b) => b === 0)) break;
    const name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "").trim();
    const sizeOct = block.subarray(124, 136).toString("utf8").replace(/\0/g, "").trim();
    const size = Number.parseInt(sizeOct, 8) || 0;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (rel) names.push(sanitizeTarRel(rel));
    o += 512 + Math.ceil(size / 512) * 512;
  }
  if (!names.includes("workspace.json")) throw new Error("pack missing workspace.json");
  return names;
}

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function verifyRelease(envelope, publicKeyHex, artifact) {
  const pk = Buffer.from(publicKeyHex, "hex");
  if (pk.length !== 32) return false;
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, pk]),
    format: "der",
    type: "spki",
  });
  if (
    !verify(
      null,
      Buffer.from(envelope.payload_json, "utf8"),
      key,
      Buffer.from(envelope.signature_hex, "hex"),
    )
  ) {
    return false;
  }
  const payload = JSON.parse(envelope.payload_json);
  return payload.artifact_sha256_hex === sha256Hex(artifact);
}

export function signPayload(seed, payload) {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const payload_json = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    payload_json,
    signature_hex: sign(null, Buffer.from(payload_json, "utf8"), key).toString("hex"),
  };
}

export async function fetchUserPk(origin, userId) {
  const base = origin.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/users/${userId}/key`);
  if (res.status === 404) throw new Error("unknown user or no user key");
  if (!res.ok) throw new Error(`user key http ${res.status}`);
  const body = await res.json();
  if (body.user_id !== userId || !/^[0-9a-f]{64}$/.test(body.pk_hex || "")) {
    throw new Error("bad user key response");
  }
  return body.pk_hex;
}

export async function fetchBytes(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`pack http ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PACK) throw new Error("pack too large");
  return buf;
}

export function authorIdFromTemplateId(id) {
  const i = id.indexOf(".");
  return i === -1 ? id : id.slice(0, i);
}

export function parseProposal(raw, pathId, pathVer) {
  const p = typeof raw === "string" ? JSON.parse(raw) : raw;
  const id = p.template_id || p.plugin_id;
  if (id !== pathId || p.version !== pathVer) {
    throw new Error("proposal path does not match template_id/version");
  }
  if (!listableTemplateId(id)) throw new Error("id is not listable");
  if (!userIdOk(p.user_id)) throw new Error("user_id must be 32 lowercase hex chars");
  if (!packUrlOk(p.pack_url)) throw new Error("pack_url must be a GitHub or GitCode release .tianshu");
  return { ...p, template_id: id, plugin_id: id };
}

export const SHARD_MAX_PLUGINS = 512;
export const SHARD_MAX_BYTES = 256 * 1024;

export function sortPlugins(plugins) {
  plugins.sort((a, b) => {
    const id = a.plugin_id < b.plugin_id ? -1 : a.plugin_id > b.plugin_id ? 1 : 0;
    if (id !== 0) return id;
    return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
  });
}

export function listingBytes(plugins) {
  return Buffer.from(JSON.stringify({ schema: 1, plugins }));
}

export function buildShards(pluginsIn) {
  const plugins = [...pluginsIn];
  sortPlugins(plugins);
  const groups = [];
  let cur = [];
  for (const p of plugins) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      if (
        last.plugin_id !== p.plugin_id &&
        (cur.length >= SHARD_MAX_PLUGINS || listingBytes(cur).length >= SHARD_MAX_BYTES)
      ) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(p);
  }
  groups.push(cur);
  return groups.map((g, i) => {
    const bytes = listingBytes(g);
    return {
      path: `index/p${String(i).padStart(4, "0")}.json`,
      bytes,
      sha256: sha256Hex(bytes),
      id_lo: g[0]?.plugin_id ?? "",
      id_hi: g.at(-1)?.plugin_id ?? "",
    };
  });
}
