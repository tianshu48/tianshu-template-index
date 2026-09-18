import test from "node:test";
import assert from "node:assert/strict";
import { zstdCompressSync } from "node:zlib";
import {
  buildShards,
  listableTemplateId,
  openTianshuPack,
  parseProposal,
  sanitizeTarRel,
  SHARD_MAX_BYTES,
  WS_MAGIC,
} from "./lib.mjs";

test("community ids reject tianshu", () => {
  assert.equal(listableTemplateId("alice.av-axis"), true);
  assert.equal(listableTemplateId("tianshu.combat"), false);
});

test("sanitize allows workspace layout only", () => {
  assert.equal(sanitizeTarRel("workspace.json"), "workspace.json");
  assert.equal(sanitizeTarRel("graphs/a.json"), "graphs/a.json");
  assert.throws(() => sanitizeTarRel("graphs/.trash/x.json"));
  assert.throws(() => sanitizeTarRel("etc/passwd"));
});

test("proposal requires release .tianshu url", () => {
  assert.throws(() =>
    parseProposal(
      {
        template_id: "alice.av",
        version: "1.0.0",
        user_id: "0123456789abcdef0123456789abcdef",
        pack_url: "https://github.com/alice/x/releases/download/v1/a.tsz",
      },
      "alice.av",
      "1.0.0",
    ),
  );
  const p = parseProposal(
    {
      template_id: "alice.av",
      version: "1.0.0",
      user_id: "0123456789abcdef0123456789abcdef",
      pack_url: "https://github.com/alice/x/releases/download/v1/a.tianshu",
    },
    "alice.av",
    "1.0.0",
  );
  assert.equal(p.plugin_id, "alice.av");
});

function tarFile(name, body) {
  const header = Buffer.alloc(512);
  header.write(name);
  const size = body.length.toString(8).padStart(11, "0");
  header.write(`${size}\0`, 124);
  header.write("0", 156);
  let sum = 0;
  header.fill(0x20, 148, 156);
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, pad]);
}

test("openTianshuPack reads magic and workspace.json", () => {
  const tar = Buffer.concat([
    tarFile("workspace.json", Buffer.from("{}")),
    Buffer.alloc(1024),
  ]);
  const packed = Buffer.concat([WS_MAGIC, zstdCompressSync(tar)]);
  assert.deepEqual(openTianshuPack(packed), ["workspace.json"]);
  assert.throws(() => openTianshuPack(Buffer.from("TSP2xxxx")));
});

test("buildShards splits at 512 but keeps one plugin_id together", () => {
  const many = Array.from({ length: 513 }, (_, i) => ({
    plugin_id: `p${String(i).padStart(4, "0")}`,
    version: "1",
  }));
  const shards = buildShards(many);
  assert.equal(shards.length, 2);
  const same = Array.from({ length: 600 }, (_, i) => ({ plugin_id: "alice.av", version: String(i) }));
  assert.equal(buildShards(same).length, 1);
  const fat = { plugin_id: "aaa.big", version: "1", description: "x".repeat(SHARD_MAX_BYTES) };
  assert.equal(buildShards([fat, { plugin_id: "bbb.small", version: "1" }]).length, 2);
});
