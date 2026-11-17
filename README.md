# rex-hints

Keyboard hints over a [Rex](https://www.superlogical.com/rex) pane, tmux-fingers and
ace-jump style. No mouse needed to grab or reach what's on screen.

- **Hints** (`shift+cmd+j`): every URL, file path (with `:LINE:COL`), git hash, UUID and
  IPv4 address on the focused pane gets a one- or two-letter hint. Type the hint, then:
  `c` (or Enter) copy · `o` open (URLs in the browser; PDF, EPUB, Markdown and pictures in
  [leaf](https://leaf.dipxsy.app) when it's installed; the rest with macOS `open`) ·
  `e` edit in Emacs in a split on the right · `t` edit in Emacs in a new tab ·
  `m` move (click there). The menu only offers what fits the item.
- **Jump** (`ctrl+cmd+j`): ace-jump. Type a word's first character (any case), then the
  hint on the word you want; the cursor goes there. One match jumps at once.

Escape cancels, Backspace takes back a letter. The picker is a floating pane laid exactly
over the source pane, showing its visible screen dimmed with the hints on top (plain text,
not the original colors). It reads only the tail of the pane's output, so a huge
scrollback still opens in about 300 ms.

## Needs

- Rex for macOS (tested with Preview 0.1.0 build 1853) and node 20+ (built-ins only).
- macOS `open`. Copy goes through the terminal (OSC 52), so it lands on the clipboard of
  the Mac running the Rex app.
- Optional: [leaf](https://leaf.dipxsy.app) on `PATH`. Open then reads documents and pictures
  in leaf, placed the way its Rex plugin does (at an idle prompt, or in a pane beside).
  URLs still go to the browser.
- For edit: a zsh function `ec` in your interactive shell that opens files in a terminal
  Emacs, e.g. `ec() { emacsclient -t "$@"; }`. It's called as `ec +LINE:COL FILE`.
- Move and Jump send a mouse click, so they move the cursor in programs that take clicks
  (Emacs with `xterm-mouse-mode`, vim, most TUIs). A plain shell prompt ignores them.

## Install

```sh
git clone https://github.com/jmayaalv/rex-hints ~/Developer/rex-hints
ln -s ~/Developer/rex-hints/hints ~/.config/rex/hints
```

Then add this to `~/.config/rex/init.lua` and run `rex config reload`:

```lua
local terminal = "com.superlogical.terminal"

-- The folder of the program in the pane (shells may not report theirs to Rex).
local function pane_folder(ctx)
  local p = rex.block.call(terminal, "process", { block_id = ctx.block_id })
  return p and p.foreground and p.foreground.cwd or os.getenv("HOME")
end

local function find_rect(node, id)
  if node.block_id == id then return node.rect end
  if node.split then return find_rect(node.split.before, id) or find_rect(node.split.after, id) end
end

-- For panes on another Rex host: open_url opens a URL on this Mac, and the picker
-- there calls it back at this server's Tailscale address (nil when Tailscale is off).
rex.action{
  name  = "open_url",
  title = "Open URL on This Mac",
  args  = { url = "string" },
  run   = function(_, args)
    if not args.url:match("^https?://") then error("open_url: only http(s) URLs", 0) end
    local r, err = rex.exec({ "/usr/bin/open", args.url })
    if r == nil then error(err, 0) end
    if not r.ok then error(r.stderr, 0) end
  end,
}

local function own_address()  -- the server's PATH has no rex; use its own CLI
  local cli = os.getenv("HOME") .. "/Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex"
  local r = rex.exec({ cli, "api", "call", "server.status" }, { timeout = 5 })
  local s = r and r.ok and rex.json.decode(r.stdout)
  return s and s.tailscale and s.tailscale.https and s.tailscale.https.url
end

-- The picker over ctx's pane; mode "jump" is the ace-jump variant. ctx.server is set
-- when the pane is on another host: the picker runs there.
local function open_hints(ctx, mode)
  local view, err = rex.session.view{}
  if view == nil then error(err, 0) end
  for _, w in ipairs(view.windows) do
    for _, layer in ipairs(w.layers) do
      local rect = layer.layout and find_rect(layer.layout, ctx.block_id)
      if rect then
        local size = rex.block.call(terminal, "size", { block_id = ctx.block_id }) or {}
        local _, e = rex.session.new_layer{
          window_id = w.window_id,
          bounds    = rect,  -- layout rects are window fractions in every layer
          focus     = true,  -- ends a zoom; hints puts it back (the "1" below)
          layout    = rex.layout.block{
            flavor  = terminal .. ".shell",
            label   = "hints",
            options = {
              cwd          = pane_folder(ctx),
              command      = { os.getenv("HOME") .. "/.config/rex/hints", ctx.session_id, ctx.block_id,
                               w.zoomed_block_id == ctx.block_id and "1" or "0", mode,
                               ctx.server and (own_address() or "remote") or "local" },
              path_prepend = { "/opt/homebrew/bin" },  -- where node is
              size         = size.columns and { columns = size.columns, rows = size.rows } or nil,
            },
          },
        }
        if e ~= nil then error(e, 0) end
        return
      end
    end
  end
  error("Hints: the focused pane isn't in this session's layout.", 0)
end

rex.action{ name = "hints", title = "Hints: Copy, Open, Edit or Move…", run = function(ctx) open_hints(ctx, "items") end }
rex.action{ name = "jump", title = "Jump to a Word…", run = function(ctx) open_hints(ctx, "jump") end }
rex.bind("shift+cmd+j", "hints")
rex.bind("ctrl+cmd+j", "jump")
```

Pick other keys if those are taken; `rex keymap` shows what's bound.

## Tests

```sh
node --test hints.test.js
```

## Known limits

- A URL that wraps onto the next row becomes two items. A path broken at the pane's edge
  (Claude Code breaks long ones itself) is joined with the run that starts the next row,
  so a path that ends exactly at the edge also takes the next row's first word.
- Only the visible screen is hinted, not scrollback; a pane scrolled up in the app shows
  its live screen.
- F1–F4 can type a hint letter; the menu row covers a picked item on the last row; hint
  letters are misdrawn over an item starting with a combining mark or a wide character;
  an emoji with VS16 (⚠️) counts as one cell, so Move after it lands one cell left.
- A pane on another Rex host runs the picker there, so the script must be installed there
  too, and its actions act on that machine: Edit opens its files. Copy still reaches your
  Mac's clipboard (OSC 52).
  Open reads documents and pictures in leaf there when it's installed, sends http(s) URLs
  back to your Mac through `open_url` (that host's `rex` must reach this server over
  Tailscale), and is hidden for other paths.

## License

MIT
