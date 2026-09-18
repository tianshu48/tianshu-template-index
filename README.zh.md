# 天枢模板索引

[English](README.md)

社区工作空间模板用 Pull Request 上架。对着 `main` 放一份 `proposals/<模板id>/<版本>.json`。

JSON 里要有 `template_id`（或 `plugin_id`）、`version`、`user_id`（天枢账号 id）、`source`、`source_tag`、`pack_url`（GitHub 或 GitCode 的 Release 文件，后缀 `.tianshu`）。没签名的 PR 可以开。审核通过后，用该账号签过名的包会合并；没签名的会再要你签一份。

占用 `tianshu` 的 id 在这条路上会被拒绝。
