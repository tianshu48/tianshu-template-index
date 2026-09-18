#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fetchBytes, fetchUserPk, openTianshuPack, parseProposal, verifyRelease } from "./lib.mjs";

function changedFiles(base, head) {
  const out = execSync(`git diff --name-only ${base} ${head}`, { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function communityPath(file) {
  const m = /^proposals\/([^/]+)\/([^/]+)\.json$/.exec(file);
  return m ? { id: m[1], ver: m[2] } : null;
}

async function checkCommunity(file, id, ver, origin) {
  if (!origin) throw new Error("TIANSHU_ORIGIN required");
  const p = parseProposal(readFileSync(file, "utf8"), id, ver);
  await fetchUserPk(origin, p.user_id);
  const artifact = await fetchBytes(p.pack_url);
  openTianshuPack(artifact);
  if (p.release_url) {
    const env = JSON.parse((await fetchBytes(p.release_url)).toString("utf8"));
    const pk = await fetchUserPk(origin, p.user_id);
    if (!verifyRelease(env, pk, artifact)) throw new Error("signature does not match user key");
  }
  console.log("template pack ok", id, ver);
}

async function main() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  const origin = (process.env.TIANSHU_ORIGIN || "").replace(/\/$/, "");
  if (!base || !head) throw new Error("BASE_SHA and HEAD_SHA required");
  const files = changedFiles(base, head);
  const community = files.map(communityPath).filter(Boolean);
  if (files.length === 0 || files.length !== community.length) {
    throw new Error("pull request may only add proposals/<id>/<version>.json");
  }
  if (community.length !== 1) throw new Error("one proposal per pull request");
  await checkCommunity(files[0], community[0].id, community[0].ver, origin);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
