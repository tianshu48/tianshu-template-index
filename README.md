# Tianshu template index

[中文](README.zh.md)

Community workspace templates are listed with a pull request. Put one file at `proposals/<template-id>/<version>.json` against `main`.

The JSON needs `template_id` (or `plugin_id`), `version`, `user_id` (your Tianshu account id), `source`, `source_tag`, and `pack_url` (a GitHub or GitCode Release asset ending in `.tianshu`). Unsigned PRs are allowed. After review, a pack signed with that account is merged; an unsigned pack gets a request to sign.

Ids that use `tianshu` are rejected on this path.
