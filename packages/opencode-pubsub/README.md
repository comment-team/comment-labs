# @comment-labs/opencode-pubsub

Cross-session pub/sub plugin for [opencode](https://opencode.ai): one session subscribes to a channel, another publishes to it, and the subscriber wakes automatically and treats the message as a task.

## Usage

```
/listen 1
```

Subscribes the current session to channel `1`. Published messages arrive in this session automatically as user messages prefixed with `[pubsub]`.

```
/publish 1 fix the flaky login test
```

Publishes a message to channel `1`; every subscribed session is woken automatically. The `pubsub_publish`, `pubsub_subscribe`, `pubsub_unsubscribe`, and `pubsub_wait` tools are also available to the model directly.

`pubsub_wait` blocks until a new message arrives on a channel (up to `timeoutSeconds`, default 120) and returns it, so an agent that publishes a task can wait for the reply in one step instead of polling with shell commands. Pass the message id returned by `pubsub_publish` as `afterSeq` to only count messages published after yours; messages from your own session are always ignored.

Messages may be up to 16k characters; longer ones are rejected.

## Design

- The bus is a plain directory: `$XDG_STATE_HOME/opencode-pubsub` (default `~/.local/state/opencode-pubsub`), overridable with `OPENCODE_PUBSUB_DIR`.
- Messages are append-only JSON files (`channels/<ch>/messages/NNNNNN.json`); subscriptions, cursors, and claims live alongside them.
- Delivery is gated on `session.idle`, claims are exclusive per message and session, and the cursor advances only after a successful injection, so delivery is at-least-once and consumers must tolerate duplicates in rare crash windows.
- Each opencode instance watches the bus, sweeps for pending messages on startup, on every idle event, and on filesystem changes.

## Development

```sh
pnpm install
pnpm --filter @comment-labs/opencode-pubsub build
pnpm --filter @comment-labs/opencode-pubsub test
```
