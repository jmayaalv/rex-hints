-- rex-hints for Rex: the actions and keys that open the picker (`hints`, the
-- script beside this file) over the focused pane. Load it from
-- ~/.config/rex/init.lua:
--
--   require("rex-hints").setup()                -- this folder at ~/.config/rex/rex-hints
--   dofile("/path/to/rex-hints/init.lua").setup()  -- or anywhere else
--
-- setup{ hints = KEY, jump = KEY } changes the keys; false leaves one unbound.
-- setup{ editor = "nvim" } picks the editor for edit and tab, run in an
-- interactive zsh. By default it's the shell's `ec` when it has one, else vim.

local M = {}

local terminal = "com.superlogical.terminal"
local editor = ""  -- setup's; empty: ec or vim
local HINTS = debug.getinfo(1, "S").source:gsub("^@", ""):match("^(.*)/") .. "/hints"
M.script = HINTS

-- The folder of the program in the pane (shells may not report theirs to Rex).
local function pane_folder(ctx)
  local p = rex.block.call(terminal, "process", { block_id = ctx.block_id })
  return p and p.foreground and p.foreground.cwd or os.getenv("HOME")
end

local function find_rect(node, id)
  if node.block_id == id then return node.rect end
  if node.split then return find_rect(node.split.before, id) or find_rect(node.split.after, id) end
end

-- This server's Tailscale address, for the picker on another host to call
-- open_url back. The server's PATH has no rex, so ask through its own CLI.
local function own_address()
  local cli = os.getenv("HOME") .. "/Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex"
  local r = rex.exec({ cli, "api", "call", "server.status" }, { timeout = 5 })
  local s = r and r.ok and rex.json.decode(r.stdout)
  return s and s.tailscale and s.tailscale.https and s.tailscale.https.url
end

-- The picker over ctx's pane; mode "jump" is the ace-jump variant. ctx.server is
-- set when the pane is on another host: the picker runs there.
local function open_hints(ctx, mode)
  local view, err = rex.session.view{}
  if view == nil then error(err, 0) end
  for _, w in ipairs(view.windows) do
    for _, layer in ipairs(w.layers) do
      local rect = layer.layout and find_rect(layer.layout, ctx.block_id)
      if rect then
        local size = rex.block.call(terminal, "size", { block_id = ctx.block_id }) or {}
        -- A pane on another host runs the picker there: send it this copy's code,
        -- so that host needs node but not rex-hints.
        local command = { HINTS }
        if ctx.server then
          local f = assert(io.open(HINTS))
          command = { "/usr/bin/env", "node", "-e", f:read("*a"), "hints" }
          f:close()
        end
        for _, a in ipairs({ ctx.session_id, ctx.block_id, w.zoomed_block_id == ctx.block_id and "1" or "0", mode,
                             ctx.server and (own_address() or "remote") or "local", editor }) do
          command[#command + 1] = a
        end
        local _, e = rex.session.new_layer{
          window_id = w.window_id,
          bounds    = rect,  -- layout rects are window fractions in every layer
          focus     = true,  -- ends a zoom; hints puts it back (the "1" below)
          layout    = rex.layout.block{
            flavor  = terminal .. ".shell",
            label   = "hints",
            options = {
              cwd          = pane_folder(ctx),
              command      = command,
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

function M.setup(opts)
  opts = opts or {}
  editor = opts.editor or ""

  -- Opens an http(s) URL on this Mac. The picker on another host calls it back
  -- here, so a URL opens where you are.
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
  rex.action{ name = "hints", title = "Hints: Copy, Open, Edit or Move…", run = function(ctx) open_hints(ctx, "items") end }
  rex.action{ name = "jump", title = "Jump to a Word…", run = function(ctx) open_hints(ctx, "jump") end }

  local hints, jump = opts.hints == nil and "super+shift+j" or opts.hints, opts.jump == nil and "super+ctrl+j" or opts.jump
  if hints then rex.bind(hints, "hints") end
  if jump then rex.bind(jump, "jump") end
end

return M
