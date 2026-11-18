// Tests for hints and init.lua: node --test hints.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./hints");

const brief = (items) => items.map(({ kind, text, row, col }) => [kind, text, row, col]);

// --- Task 1: matching, hints, actions, paths

test("findItems finds each kind, in reading order", () => {
  const items = h.findItems([
    "open https://example.com/a?b=1 now",
    "at src/app.js:12:5 and ~/notes/todo.md",
    "commit 3f2a1bc9 by",
    "id 123e4567-e89b-12d3-a456-426614174000 ip 10.0.0.12",
  ]);
  assert.deepEqual(brief(items), [
    ["url", "https://example.com/a?b=1", 0, 5],
    ["path", "src/app.js:12:5", 1, 3],
    ["path", "~/notes/todo.md", 1, 23],
    ["hash", "3f2a1bc9", 2, 7],
    ["uuid", "123e4567-e89b-12d3-a456-426614174000", 3, 3],
    ["ipv4", "10.0.0.12", 3, 43],
  ]);
});

test("findItems: a URL wins over the path inside it", () => {
  assert.deepEqual(brief(h.findItems(["https://x.io/a/b"])), [["url", "https://x.io/a/b", 0, 0]]);
});

test("findItems: no plain numbers or words as hashes", () => {
  assert.deepEqual(h.findItems(["1234567 defaced 2026"]), []);
});

test("findItems trims trailing punctuation and backticks", () => {
  const texts = h.findItems(["see https://x.io/a. or (src/a.js:3) and `https://x.io/b`"]).map((i) => i.text);
  assert.deepEqual(texts, ["https://x.io/a", "src/a.js:3", "https://x.io/b"]);
});

test("findItems matches non-ASCII paths whole", () => {
  const texts = h.findItems(["~/Música/canción.mp3 src/café.js:3"]).map((i) => i.text);
  assert.deepEqual(texts, ["~/Música/canción.mp3", "src/café.js:3"]);
});

test("findItems counts cells: wide CJK and emoji are 2, combining marks 0", () => {
  assert.equal(h.findItems(["日本 /tmp/a.txt"])[0].col, 5);
  assert.equal(h.findItems(["✅ src/a.js"])[0].col, 3);
  assert.equal(h.findItems(["café /tmp/x"])[0].col, 5);
});

test("assignHints: one letter up to 26, bottom rows first", () => {
  const items = h.assignHints([0, 1, 2].map((row) => ({ row, col: 0, text: "x/y", kind: "path" })));
  assert.deepEqual(items.map((i) => [i.row, i.hint]).sort(), [[0, "d"], [1, "s"], [2, "a"]]);
});

test("assignHints: two letters past 26, unique, none a prefix of another", () => {
  const items = h.assignHints(Array.from({ length: 30 }, (_, row) => ({ row, col: 0, text: "x/y", kind: "path" })));
  const hints = items.map((i) => i.hint);
  assert.equal(hints.length, 30);
  assert.ok(hints.every((x) => x.length === 2));
  assert.equal(new Set(hints).size, 30);
  assert.ok(hints.every((a) => hints.every((b) => a === b || !b.startsWith(a))));
});

test("actionsFor lists only the actions that fit", () => {
  const keys = (kind) => h.actionsFor({ kind }).map((a) => a.key).join(",");
  assert.equal(keys("url"), "c,o,m");
  assert.equal(keys("path"), "c,o,e,t,m");
  for (const kind of ["hash", "uuid", "ipv4"]) assert.equal(keys(kind), "c,m");
});

test("parseTarget resolves paths and reads :LINE:COL", () => {
  assert.deepEqual(h.parseTarget("src/a.js:12:5", "/r", "/h"), { file: "/r/src/a.js", line: 12, col: 5 });
  assert.deepEqual(h.parseTarget("~/n.md", "/r", "/h"), { file: "/h/n.md" });
  assert.deepEqual(h.parseTarget("/abs/b.rs:7", "/r", "/h"), { file: "/abs/b.rs", line: 7 });
});

// --- Task 2: screen reading, keys, state, rendering

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const frameRows = (s) => strip(s).split("\r\n");
const item = (over) => ({ row: 0, col: 0, text: "src/a.js", kind: "path", hint: "a", ...over });
const thirty = () => h.assignHints(Array.from({ length: 30 }, (_, row) => ({ row, col: 0, text: "x/y", kind: "path" })));

test("visibleScreen adds the blank rows the text format drops", () => {
  assert.deepEqual(h.visibleScreen("s1\ns2\nl1", "s1\r\ns2\r\nl1\r\n\r\n", 3, false), ["l1", "", ""]);
  assert.deepEqual(h.visibleScreen("a\nb\nc", "a\r\nb\r\nc\x1b[3;1H\n", 3, false), ["a", "b", "c"]);
  assert.deepEqual(h.visibleScreen("tial\nx\ny", "…\r\nx\r\ny", 2, true), ["x", "y"]);
});

test("visibleItems keeps what the picker shows, clipped items too while their hint fits", () => {
  const items = [item({ row: 0 }), item({ row: 4 }), item({ row: 4, col: 17, text: "abcdefgh/x" }), item({ row: 4, col: 19 })];
  assert.deepEqual(h.visibleItems(items, 5, 20, 3).map((i) => [i.row, i.col]), [[4, 0], [4, 17]]);
});

test("decodeKeys names keys and drops sequences", () => {
  assert.deepEqual(h.decodeKeys("ab\r"), ["a", "b", "enter"]);
  assert.deepEqual(h.decodeKeys("\x1b"), ["escape"]);
  assert.deepEqual(h.decodeKeys("\x1b[A"), []);
  assert.deepEqual(h.decodeKeys("\x7fA"), ["backspace", "a"]);
  assert.deepEqual(h.decodeKeys("\x03"), ["escape"]);
});

test("step picks on a full hint", () => {
  const s = h.step(h.initialState([item({ hint: "a" }), item({ hint: "s", row: 1 })]), "s");
  assert.equal(s.picked.hint, "s");
  assert.equal(s.done, null);
});

test("step with two-letter hints waits for the second letter", () => {
  const items = thirty();
  const s1 = h.step(h.initialState(items), "a");
  assert.equal(s1.picked, null);
  assert.equal(s1.typed, "a");
  const s2 = h.step(s1, items[0].hint[1]);
  assert.equal(s2.picked.hint, items[0].hint);
});

test("step ignores letters that match no hint", () => {
  const s0 = h.initialState([item({ hint: "a" })]);
  assert.deepEqual(h.step(s0, "z"), s0);
});

test("step runs the action keys that fit the picked item", () => {
  const path = h.step(h.initialState([item({ hint: "a" })]), "a");
  assert.deepEqual(h.step(path, "e").done, { action: "edit", item: path.picked });
  assert.equal(h.step(path, "enter").done.action, "copy");
  const hash = h.step(h.initialState([item({ hint: "a", kind: "hash", text: "3f2a1bc9" })]), "a");
  assert.equal(h.step(hash, "e").done, null);
});

test("step backspace takes back the last letter", () => {
  const one = h.step(h.step(h.initialState([item({ hint: "s" })]), "s"), "backspace");
  assert.equal(one.typed, "");
  assert.equal(one.picked, null);
  const items = thirty();
  const picked = h.step(h.step(h.initialState(items), "a"), items[0].hint[1]);
  const back = h.step(picked, "backspace");
  assert.equal(back.typed, "a");
  assert.equal(back.picked, null);
});

test("step escape cancels from any state", () => {
  const s0 = h.initialState([item({ hint: "a" })]);
  assert.equal(h.step(s0, "escape").done.action, "cancel");
  assert.equal(h.step(h.step(s0, "a"), "escape").done.action, "cancel");
});

test("step with no items: any key cancels", () => {
  assert.equal(h.step(h.initialState([]), "a").done.action, "cancel");
});

test("render draws the hint over the item's first cells", () => {
  const s = h.initialState([item({ col: 2, text: "https://a.io", kind: "url", hint: "a" })]);
  assert.equal(frameRows(h.render(s, ["x https://a.io"], 40, 3))[0], "x attps://a.io");
});

test("render clips to the picker and shows the bottom lines", () => {
  const lines = [0, 1, 2, 3, 4].map((n) => `l${n}`.padEnd(40, "-"));
  const s = h.initialState([item({ row: 4, col: 3, text: "a/b", hint: "a" })]);
  const rows = frameRows(h.render(s, lines, 20, 3));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => [...r].length <= 20));
  assert.ok(rows[0].startsWith("l2"));
});

test("render shows the menu on the last row once an item is picked", () => {
  const s = h.step(h.initialState([item({ hint: "a" })]), "a");
  const rows = frameRows(h.render(s, ["src/a.js", "", ""], 60, 3));
  assert.ok(rows[2].startsWith(" copy c/⏎"), rows[2]);
});

test("a pane on another machine offers no open: it would open there, out of sight", () => {
  const keys = (kind) => h.actionsFor({ kind }, { remote: true }).map((a) => a.key).join(",");
  assert.equal(keys("url"), "c,m");
  assert.equal(keys("path"), "c,e,t,m");
  const s = h.step({ ...h.initialState([item({ hint: "a" })]), where: { remote: true } }, "a");
  assert.equal(h.step(s, "o").done, null);
  assert.ok(!frameRows(h.render(s, ["src/a.js", "", ""], 60, 3))[2].includes("open"));
});

test("with the viewer's Rex address, a remote pane still opens URLs: on the viewer's machine", () => {
  const keys = (kind, text) => h.actionsFor({ kind, text }, { remote: true, viewer: "https://viewer" }).map((a) => a.key).join(",");
  assert.equal(keys("url", "https://x.io"), "c,o,m");
  assert.equal(keys("url", "file:///etc/hosts"), "c,m");
  assert.equal(keys("path", "src/a.js"), "c,e,t,m");
});

test("with leaf, open offers what leaf reads, on a remote pane too", () => {
  const keys = (kind, text, where) => h.actionsFor({ kind, text }, where).map((a) => a.key).join(",");
  const remoteLeaf = { remote: true, leaf: true };
  assert.equal(keys("path", "docs/a.md:3", remoteLeaf), "c,o,e,t,m");
  assert.equal(keys("path", "paper.PDF", remoteLeaf), "c,o,e,t,m");
  assert.equal(keys("url", "https://x.io", remoteLeaf), "c,m"); // URLs never go to leaf
  assert.equal(keys("url", "https://x.io", { ...remoteLeaf, viewer: "https://v" }), "c,o,m");
  assert.equal(keys("path", "src/a.js", remoteLeaf), "c,e,t,m");
  assert.equal(keys("path", "src/a.js", { leaf: true }), "c,o,e,t,m");
});

test("render says when there is nothing to hint", () => {
  assert.equal(frameRows(h.render(h.initialState([]), ["plain text"], 60, 3))[0], " No items here — any key closes");
});

// --- Task 3: actions

const S = "session:s", B = "block:b";
const ctx = { session: S, block: B, cwd: "/r", home: "/h" };
function record(action, it) {
  const calls = [];
  h.runAction(action, it, ctx, (cmd, args, input) => calls.push([cmd, args, input]));
  return calls;
}
const shell = (command) => ({
  block: {
    flavor: "com.superlogical.terminal.shell", label: "edit",
    options: { cwd: "/r", shell: "none", command, path_prepend: ["/opt/homebrew/bin"] },
  },
});

test("runAction copy asks the terminal to copy (OSC 52), running nothing", () => {
  const writes = [];
  const calls = [];
  h.runAction("copy", item({ text: "abc/d é" }), ctx, (...c) => calls.push(c), (s) => writes.push(s));
  assert.deepEqual(calls, []);
  assert.deepEqual(writes, [`\x1b]52;c;${Buffer.from("abc/d é").toString("base64")}\x07`]);
});

test("runAction open: URLs as they are, paths resolved without :LINE", () => {
  assert.deepEqual(record("open", item({ kind: "url", text: "https://x.io" }))[0].slice(0, 2), ["open", ["https://x.io"]]);
  assert.deepEqual(record("open", item({ text: "src/a.js:3" }))[0].slice(0, 2), ["open", ["/r/src/a.js"]]);
});

test("runAction open with a viewer asks the viewer's server to open the URL", () => {
  const calls = [];
  h.runAction("open", item({ kind: "url", text: "https://x.io/?a=1" }), { ...ctx, viewer: "https://v" }, (...c) => calls.push(c));
  assert.deepEqual(calls[0].slice(0, 2), ["rex", ["-S", "https://v", "do", "open_url", "--args", '{"url":"https://x.io/?a=1"}']]);
});

test("runAction open with leaf places the files leaf reads; URLs and the rest open as before", () => {
  const run = (it) => {
    const calls = [];
    h.runAction("open", it, { ...ctx, leaf: "/bin/leaf" }, (...c) => calls.push(c));
    return calls[0].slice(0, 2);
  };
  assert.deepEqual(run(item({ text: "docs/a.md:3" })), ["/bin/leaf", ["rex", "place", B, "a.md", "--", "open", "/r/docs/a.md"]]);
  assert.deepEqual(run(item({ kind: "url", text: "https://x.io/post" })), ["open", ["https://x.io/post"]]);
  assert.deepEqual(run(item({ text: "src/a.js" })), ["open", ["/r/src/a.js"]]);
});

// The default editor: the shell's `ec` if it has one, else vim.
const byDefault = (file, ec, vim) => ["/bin/zsh", "-ic", 'if whence ec >/dev/null; then ec ${2:+"$2"} "$1"; else vim ${3:+"$3"} "$1"; fi', "edit", file, ec, vim];

test("runAction edit opens the editor in a split on the right, at the line", () => {
  const calls = record("edit", item({ text: "src/a.js:12:5" }));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["rex", ["api", "call", "-s", S, "session.new_split", "-"]]);
  assert.deepEqual(JSON.parse(calls[0][2]), {
    session_id: S, anchor_id: B, direction: "horizontal", side: "after", focus: true,
    layout: shell(byDefault("/r/src/a.js", "+12:5", "+call cursor(12,5)")),
  });
  const plain = JSON.parse(record("edit", item({ text: "src/a.js" }))[0][2]);
  assert.deepEqual(plain.layout.block.options.command, byDefault("/r/src/a.js", "", ""));
});

test("runAction tab opens the editor in a new window", () => {
  const calls = record("tab", item({ text: "src/a.js:12" }));
  assert.deepEqual(calls[0].slice(0, 2), ["rex", ["api", "call", "-s", S, "session.new_window", "-"]]);
  assert.deepEqual(JSON.parse(calls[0][2]), {
    session_id: S, focus: true, layout: shell(byDefault("/r/src/a.js", "+12", "+call cursor(12,1)")),
  });
});

test("editCommand: a configured editor gets the line the way it reads it", () => {
  const t = { file: "/r/a.js", line: 12, col: 5 };
  const run = (editor, at = t) => h.editCommand(editor, at).slice(2);
  assert.deepEqual(run("nvim"), ['nvim "$@"', "edit", "+call cursor(12,5)", "/r/a.js"]);
  assert.deepEqual(run("/opt/homebrew/bin/vim"), ['/opt/homebrew/bin/vim "$@"', "edit", "+call cursor(12,5)", "/r/a.js"]);
  assert.deepEqual(run("emacsclient -t"), ['emacsclient -t "$@"', "edit", "+12:5", "/r/a.js"]);
  assert.deepEqual(run("nano"), ['nano "$@"', "edit", "+12", "/r/a.js"]);
  assert.deepEqual(run("nvim", { file: "/r/a.js" }), ['nvim "$@"', "edit", "/r/a.js"]);
});

test("editCommand's default runs ec when the shell has it, else vim", () => {
  const { execFileSync } = require("node:child_process");
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "rex-hints-bin-"));
  fs.writeFileSync(path.join(bin, "vim"), '#!/bin/sh\nprintf "vim"; printf " [%s]" "$@"\n', { mode: 0o755 });
  const [, , script, ...args] = h.editCommand(undefined, { file: "/r/a b.js", line: 12, col: 5 });
  // -f: no zshrc; the test defines ec itself, as zshrc would.
  const zsh = (pre, a = args) => execFileSync("/bin/zsh", ["-fc", pre + script, ...a], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin` } });
  try {
    assert.equal(zsh('ec() { printf "ec"; printf " [%s]" "$@"; }; '), "ec [+12:5] [/r/a b.js]");
    assert.equal(zsh(""), "vim [+call cursor(12,5)] [/r/a b.js]");
    const [, , , ...plain] = h.editCommand(undefined, { file: "/r/a.js" });
    assert.equal(zsh("", plain), "vim [/r/a.js]");
  } finally { fs.rmSync(bin, { recursive: true }); }
});

test("runAction move clicks the item's first cell, press then release", () => {
  const calls = record("move", item({ row: 4, col: 9 }));
  assert.equal(calls.length, 2);
  for (const [i, action] of [[0, "press"], [1, "release"]]) {
    assert.deepEqual(calls[i].slice(0, 2), ["rex", ["api", "call", "-s", S, "block.event", "-"]]);
    assert.deepEqual(JSON.parse(calls[i][2]), {
      session_id: S, block_id: B, event: { type: "mouse", payload: { action, button: "left", x: 9, y: 4 } },
    });
  }
});

// --- Jump/Move at a shell prompt: arrow keys, since a shell takes no clicks

const modes = (screen, mouse) => ({ screen, modes: [
  { name: "mouse_event_normal", set: mouse }, { name: "mouse_event_any", set: false }, { name: "wraparound", set: true },
] });

test("promptOf reads the cursor of a primary screen that takes no clicks", () => {
  const lines = ["out", " ❯ echo hi"];
  assert.deepEqual(h.promptOf("\r\n\x1b[2;11H", modes("primary", false), lines), { row: 1, col: 10, line: " ❯ echo hi" });
  assert.equal(h.promptOf("\x1b[2;11H", modes("primary", true), lines), undefined);    // the program takes clicks
  assert.equal(h.promptOf("\x1b[2;11H", modes("alternate", false), lines), undefined); // a full-screen program
  assert.equal(h.promptOf("no cursor", modes("primary", false), lines), undefined);
});

test("arrowsTo counts characters, not cells, and blank cells past the text", () => {
  assert.deepEqual(h.arrowsTo("❯ echo hello world", 18, 12), Array(6).fill("left"));
  assert.deepEqual(h.arrowsTo("❯ echo hello world", 7, 12), Array(5).fill("right"));
  assert.deepEqual(h.arrowsTo("❯ echo 日本 x", 12, 7), Array(3).fill("left")); // 日本 are 2 cells each
  assert.deepEqual(h.arrowsTo("❯ ls", 6, 2), Array(4).fill("left"));          // 2 typed spaces after "ls"
  assert.deepEqual(h.arrowsTo("❯ ls", 2, 2), []);
});

test("runAction move at a shell prompt sends arrow keys on the cursor's row, and clicks elsewhere", () => {
  const prompt = { row: 4, col: 18, line: "❯ echo hello world" };
  const calls = [];
  h.runAction("move", item({ row: 4, col: 7 }), { ...ctx, prompt }, (...c) => calls.push(c));
  assert.deepEqual(calls, [["rex", ["send-key", "-s", S, "-b", B, ...Array(11).fill("left")]]]);
  const elsewhere = [];
  h.runAction("move", item({ row: 2, col: 7 }), { ...ctx, prompt }, (...c) => elsewhere.push(c));
  assert.equal(elsewhere.length, 2);
  assert.equal(JSON.parse(elsewhere[0][2]).event.type, "mouse");
  const none = [];
  h.runAction("move", item({ row: 4, col: 18 }), { ...ctx, prompt }, (...c) => none.push(c));
  assert.deepEqual(none, []);
});

// --- e2e finding: blob_read answers with `data`, not `content`

test("readTail reads a large output's tail from blob_read's data", () => {
  const calls = [];
  const call = (method, args) => {
    calls.push([method, args]);
    if (method === "format") return { content: "head…", id: 4, total: 1000 };
    return { data: "tial\nx\ny", eof: true, id: 4, total: 1000 };
  };
  assert.deepEqual(h.readTail(call, "text", 100), { text: "tial\nx\ny", truncated: true });
  assert.deepEqual(calls[1], ["blob_read", { id: 4, offset: 900, max_bytes: 983040 }]);
});

test("readTail uses format's content when it fits", () => {
  const call = () => ({ content: "a\nb", eof: true, total: 3 });
  assert.deepEqual(h.readTail(call, "text", 100), { text: "a\nb", truncated: false });
});

// --- final review fixes

test("readTail asks blob_read for the whole tail in one reply", () => {
  const calls = [];
  const call = (method, args) => {
    calls.push([method, args]);
    return method === "format" ? { content: "h", id: 4, total: 100000 } : { data: "x", eof: true };
  };
  h.readTail(call, "text", 60000);
  assert.ok(calls[1][1].max_bytes >= 60000, JSON.stringify(calls[1][1]));
});

test("prepare hints only what a picker of the current size shows", () => {
  const lines = ["a/b row0", "", "", "", "c/d row4 then x/y"];
  const small = h.prepare(lines, 10, 3);
  assert.deepEqual(small.items.map((i) => [i.row, i.text]), [[4, "c/d"]]);
  const big = h.prepare(lines, 40, 5);
  assert.deepEqual(big.items.map((i) => i.text).sort(), ["a/b", "c/d", "x/y"]);
});

test("findItems keeps decomposed (NFD) accented paths whole", () => {
  const line = "~/Música/canción.mp3 src/café.js:3".normalize("NFD");
  const texts = h.findItems([line]).map((i) => i.text);
  assert.deepEqual(texts, ["~/Música/canción.mp3".normalize("NFD"), "src/café.js:3".normalize("NFD")]);
});

test("readTail survives a tail that starts mid-character (U+FFFD replies)", () => {
  // Like Rex: blob_read decodes raw bytes from `offset`, a partial character
  // becomes U+FFFD per byte, and a reply's data stays within max_bytes.
  const raw = Buffer.from("⏺ línea 1\r\nsee x/y\r\n\r\n\r\n\r\n");
  const call = (method, args) => {
    if (method === "format") return { content: "", id: 1, total: raw.length };
    let n = raw.length - args.offset;
    const decode = (k) => new TextDecoder().decode(raw.subarray(args.offset, args.offset + k));
    while (Buffer.byteLength(decode(n)) > args.max_bytes) n--;
    return { data: decode(n), eof: args.offset + n >= raw.length, id: 1, total: raw.length };
  };
  const bytes = raw.length - 1; // starts inside "⏺"
  const { text } = h.readTail(call, "vt", bytes);
  assert.ok(text.endsWith("see x/y\r\n\r\n\r\n\r\n"), JSON.stringify(text));
});

// --- jump mode (ace-jump): a first character, then hints on the words starting with it

const jumpState = (lines, cols = 80, rows = 24) => h.prepareJump(lines, cols, rows);

test("findWords finds word starts by first character, any case", () => {
  const words = h.findWords(["foo bar Fizz f_oo x.fun 9f"], "f").map((i) => [i.text, i.col]);
  assert.deepEqual(words, [["foo", 0], ["Fizz", 8], ["f_oo", 13], ["fun", 20]]);
});

test("decodeKeys passes digits and underscore for the first character", () => {
  assert.deepEqual(h.decodeKeys("9_"), ["9", "_"]);
});

test("jump: a first character hints its words, then a hint jumps", () => {
  const s1 = h.step(jumpState(["foo bar", "fizz"]), "f");
  assert.equal(s1.query, "f");
  assert.deepEqual(s1.items.map((i) => i.text).sort(), ["fizz", "foo"]);
  const target = s1.items.find((i) => i.text === "foo");
  assert.deepEqual(h.step(s1, target.hint).done, { action: "move", item: target });
});

test("jump: a single match jumps straight away", () => {
  const done = h.step(jumpState(["foo bar"]), "b").done;
  assert.equal(done.action, "move");
  assert.equal(done.item.text, "bar");
});

test("jump: no match keeps waiting and says so", () => {
  const s = h.step(jumpState(["foo bar"]), "z");
  assert.equal(s.done, null);
  assert.equal(s.query, null);
  assert.match(s.notice, /z/);
  assert.equal(h.step(s, "b").done.item.text, "bar");
});

test("jump: backspace goes back to the first character", () => {
  const s = h.step(h.step(jumpState(["foo bar", "fizz"]), "f"), "backspace");
  assert.equal(s.query, null);
  assert.equal(s.items.length, 0);
});

test("jump: render waits quietly for the first character", () => {
  const rows = frameRows(h.render(jumpState(["plain text"]), ["plain text"], 40, 3));
  assert.equal(rows[0], "plain text");
});

test("render resets the hint's background and bold right after the hint letters", () => {
  const s = h.initialState([item({ col: 2, text: "https://a.io", kind: "url", hint: "a" })]);
  const raw = h.render(s, ["x https://a.io tail"], 40, 1);
  const after = raw.match(/a((?:\x1b\[[0-9;]*m)+)t/);
  assert.ok(after, "the hint letter is followed by styled text");
  assert.ok(after[1].includes("\x1b[0m"), JSON.stringify(after[1]));
});

// --- Paths broken at the pane's edge (Claude Code wraps long paths itself)

const WRAPPED = ["  - Script: /tmp/s/sql/20261117-leftover", "    -PLL402875.up.sql", "next"];
const EDGE = WRAPPED[0].length;

test("findItems joins a path broken at the edge with the next row's run", () => {
  assert.deepEqual(brief(h.findItems(WRAPPED, EDGE)), [["path", "/tmp/s/sql/20261117-leftover-PLL402875.up.sql", 0, 12]]);
});

test("findItems leaves a path that stops short of the edge alone", () => {
  assert.deepEqual(brief(h.findItems(WRAPPED, EDGE + 1)), [["path", "/tmp/s/sql/20261117-leftover", 0, 12]]);
});

test("findItems: the joined run is no item of its own; trailing punctuation still goes", () => {
  assert.deepEqual(brief(h.findItems(["x /a/b/c", "  d/e.md."], 8)), [["path", "/a/b/cd/e.md", 0, 2]]);
  assert.deepEqual(brief(h.findItems(["x /a/b.", "md done"], 7)), [["path", "/a/b.md", 0, 2]]);
  assert.deepEqual(brief(h.findItems(["x /a/b", "/c/d/e", "f.md"], 6)), [["path", "/a/b/c/d/ef.md", 0, 2]]);
});

test("a wrapped path shows its hint once and lights up its rest", () => {
  const s = h.prepare(WRAPPED, EDGE, 3);
  assert.equal(s.items.length, 1);
  const raw = h.render(s, WRAPPED, EDGE, 3).split("\r\n");
  assert.equal(strip(raw[1]), WRAPPED[1]);
  assert.ok(raw[1].includes("\x1b[38;2;205;214;244m-"), JSON.stringify(raw[1]));
});

test("a floating picker narrower than its pane still joins and hints the broken path", () => {
  const s = h.prepare(WRAPPED, EDGE - 2, 3, EDGE);
  assert.deepEqual(brief(s.items), [["path", "/tmp/s/sql/20261117-leftover-PLL402875.up.sql", 0, 12]]);
});

// --- init.lua, loaded the way Rex loads it (skipped without the rex CLI)

test("init.lua: require(\"rex-hints\").setup{} defines the actions, binds the keys, finds the script", (t) => {
  const { execFileSync } = require("node:child_process");
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-hints-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  fs.symlinkSync(__dirname, path.join(dir, "rex-hints"));
  fs.writeFileSync(path.join(dir, "init.lua"), 'local m = require("rex-hints")\nm.setup{ jump = false }\n'
    + 'rex.action{ name = "script", title = m.script, run = function() end }\n');
  let out;
  try { out = execFileSync("rex", ["config", "check", "--json", path.join(dir, "init.lua")], { encoding: "utf8" }); }
  catch (e) { if (e.code === "ENOENT") return t.skip("no rex on PATH"); throw e; }
  const r = JSON.parse(out);
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.bindings, 1); // jump = false leaves ctrl+cmd+j unbound
  const titles = Object.fromEntries(r.actions.map((a) => [a.name, a.title]));
  assert.deepEqual(Object.keys(titles), ["open_url", "hints", "jump", "script"]);
  assert.equal(titles.script, path.join(dir, "rex-hints", "hints"));
});
