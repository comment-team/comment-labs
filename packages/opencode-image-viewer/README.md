# @comment-labs/opencode-image-viewer

`viewimage` tool: outsources image viewing to a vision subagent, for coding agents whose main model cannot see images.

Most terminal-coding models have no vision. This plugin gives them a way to actually *look* at a screenshot, a photo, a diagram, or a UI mock anyway: `viewimage` sends the images to a dedicated vision-model agent session and returns its answer into the conversation.

- First call: `images` (absolute paths, max 6 per session, png/jpg/jpeg/gif/webp, ≤3.8MB each) + a `question` about them.
- Followups: just a `question` — the vision session remembers the images, nothing is re-sent.
- State: `~/.local/share/opencode/image-viewer-state.json` (session → vision session mapping, atomically persisted).

## Installation

```bash
pnpm add @comment-labs/opencode-image-viewer
```

Add it to opencode's `plugins` array (entries accept package names or directories, not files):

```json
{
  "plugins": [ "@comment-labs/opencode-image-viewer" ]
}
```

## Configuration: the vision model lives in your config, not this plugin

The plugin never picks a model. It creates a session, switches it onto the
`image-viewer` **agent**, and that agent's `model` decides what answers.
Configure the agent block in your opencode config — this is required:

```json
{
  "agents": {
    "image-viewer": {
      "mode": "subagent",
      "model": "your-provider/your-vision-model",
      "tools": { "write": false, "edit": false, "bash": false }
    }
  }
}
```

Any vision-capable model your opencode can route to works — the plugin has
no hardcoded default and no `model` option of its own.

Options: `{ disabled: boolean }` — set `disabled: true` to turn the tool off
without removing the plugin.

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
