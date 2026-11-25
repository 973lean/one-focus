// Claude ↔ One Focus: an MCP server (JSON-RPC 2.0) so Claude can put its own
// work on the backlog — add a task with a link to the chat, mark it running,
// ask you for something ("Send a reference video of the jump"), finish it.
// Served by the app on 127.0.0.1 (see main.js); Claude Desktop reaches it
// through mcp-bridge.js, Claude Code over HTTP. Pure: actions are injected.

const PROTOCOL = '2025-06-18';

const INSTRUCTIONS = `One Focus is the user's task list on their second monitor. In backlog mode it shows Active tasks (each either "running" — you are working, the user waits — or "needs you" — a request the user must answer), Queued tasks, and Evergreen tasks. The user only ever looks at one thing: the oldest request. Keep it true:
- When you start a piece of work that will take a while or that the user will come back to, add it with one_focus_add_task (status "running", and the link to this chat or session if you know it).
- The moment you need something from the user to continue (a decision, a file, a review, a reference), call one_focus_update_task with a short imperative request, e.g. "Review batch 4 (12 hooks)" or "Send a reference video of the double jump".
- When they've answered and you're working again, set status "running". When the work is finished, set status "done".
- Titles: short, specific, start with the project ("Roblox: jump animation pass"). Details: two short lines at most.
- You can queue follow-up work for later: add it with a prompt and run_when (e.g. "after:<id of this task>"), and One Focus will start it in a new session when the time comes.
Don't add tasks for quick one-reply questions.`;

const STATUS = ['running', 'needs_you', 'queued', 'evergreen', 'done'];

const TOOLS = [
  {
    name: 'one_focus_backlog',
    title: 'Read the backlog',
    description: 'What is active (running or needing the user), queued and evergreen in One Focus, with ids. Use it to find a task before updating it, or to tell the user what needs them next.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'one_focus_add_task',
    title: 'Add a task',
    description: 'Add a task to the user\'s One Focus backlog (it is also added to their Google Tasks list). Use status "running" for work you are doing now, "needs_you" with a request when the user must act, "queued" (default) for later.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short and specific, starting with the project, e.g. "Copy: hooks batch 4 for the serum ad".' },
        status: { type: 'string', enum: ['running', 'needs_you', 'queued', 'evergreen'], description: 'Default "queued". "running"/"needs_you" take an active slot if one is free; otherwise it is queued.' },
        request: { type: 'string', description: 'What you need from the user, as a short instruction. Implies status "needs_you".' },
        link: { type: 'string', description: 'URL of this chat or session (https), if you know it, so the user can jump back in.' },
        top: { type: 'boolean', description: 'Put it at the top of the queue instead of the end.' },
        group: { type: 'string', description: 'Group name from one_focus_backlog (each group has its own active slots). If One Focus started this session for a group, use that one. Leave out to let One Focus sort it by its words.' },
        due: { type: 'string', description: 'Deadline as YYYY-MM-DD, if the task has one.' },
        details: { type: 'string', description: 'At most two short lines: only what is needed to act. Longer material belongs in the chat, not the task.' },
        prompt: { type: 'string', description: 'A prompt One Focus sends to a new Claude session when this task is started (by hand or by run_when).' },
        run_when: { type: 'string', description: 'When One Focus should start this task by itself (auto mode): "slot" (a slot in its group is free), "empty" (nothing active in its group), "after:<task id>" (that task is done), or "at:<ISO time>".' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'one_focus_update_task',
    title: 'Update a task',
    description: 'Change a task in the backlog: ask the user for something (request), say you are working again (status "running"), move it, link it, or finish it (status "done", which completes it in Google Tasks).',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task id from one_focus_backlog, or its exact title.' },
        status: { type: 'string', enum: STATUS },
        request: { type: 'string', description: 'What you need from the user now. Sets status "needs_you". Empty string clears it.' },
        link: { type: 'string', description: 'URL of the chat or session (https). Empty string removes it.' },
        title: { type: 'string', description: 'A new title.' },
        group: { type: 'string', description: 'Move it to this group (name from one_focus_backlog).' },
        due: { type: 'string', description: 'Deadline as YYYY-MM-DD; empty string removes it.' },
        details: { type: 'string', description: 'New details (Google Tasks notes). At most two short lines: only what is needed to act. Longer material belongs in the chat, not the task.' },
        prompt: { type: 'string', description: 'A prompt One Focus sends to a new Claude session when this task is started (by hand or by run_when).' },
        run_when: { type: 'string', description: 'When One Focus should start this task by itself (auto mode): "slot" (a slot in its group is free), "empty" (nothing active in its group), "after:<task id>" (that task is done), or "at:<ISO time>"; empty string removes it.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
];

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const text = (s, isError = false) => ({ content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) });

// Find a task by id, else by title (exact, then a unique partial match).
function findTask(open, ref) {
  const r = String(ref || '').trim();
  if (!r) return null;
  const byId = open.find((t) => t.id === r);
  if (byId) return byId;
  const low = r.toLowerCase();
  const exact = open.filter((t) => t.title.trim().toLowerCase() === low);
  if (exact.length === 1) return exact[0];
  const part = open.filter((t) => t.title.toLowerCase().includes(low));
  return part.length === 1 ? part[0] : null;
}

function describe(view) {
  if (!view.on) return 'Backlog mode is off in One Focus (adding a task turns it on).';
  const lines = [];
  const need = view.active.filter((r) => r.turn === 'you');
  const groups = view.groups || [];
  const gname = (r) => (groups.length > 1 ? ` [${(groups.find((g) => g.id === r.group) || {}).name || ''}]` : '');
  lines.push(`Active ${view.active.length}/${view.slots}${view.auto ? ' (auto fills from the queue)' : ''}:`);
  if (groups.length > 1) lines.push('  Groups: ' + groups.map((g) => `${g.name} ${g.active}/${g.slots}`).join(', '));
  if (!view.active.length) lines.push('  (none)');
  const due = (r) => (r.deadline ? ` (due ${r.deadline})` : '') + (r.when ? ` (runs: ${r.when})` : '') + (r.task.notes ? ` — details: ${r.task.notes.replace(/\s+/g, ' ').slice(0, 160)}` : '');
  for (const r of view.active) lines.push(`  - [${r.turn === 'you' ? 'needs you' : 'running'}]${gname(r)} ${r.task.title} (id ${r.task.id})${due(r)}${r.ask ? ` — request: ${r.ask}` : ''}${r.link ? ` — ${r.link}` : ''}`);
  lines.push(`Queued ${view.queued.length}:`);
  for (const r of view.queued) lines.push(`  -${gname(r)} ${r.task.title} (id ${r.task.id})${due(r)}`);
  if (view.evergreen.length) {
    lines.push('Evergreen:');
    for (const r of view.evergreen) lines.push(`  - ${r.task.title} (id ${r.task.id})`);
  }
  lines.push(need.length ? `The one thing for the user now: ${need[0].task.title}${need[0].ask ? ` — ${need[0].ask}` : ''}.` : 'Nothing needs the user right now.');
  return lines.join('\n');
}

// deps: { view() -> { on, auto, slots, active, queued, evergreen, open },
//         add({ title, status, request, link, top }) -> task,
//         update(task, { status, request, link, title }) -> void,
//         version }
async function handle(msg, deps) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg && msg.id != null ? msg.id : null, -32600, 'Invalid request');
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return null; // a notification: nothing to send back
  try {
    if (method === 'initialize')
      return ok(id, {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'one-focus', title: 'One Focus', version: deps.version || '0' },
        instructions: INSTRUCTIONS,
      });
    if (method === 'ping') return ok(id, {});
    if (method === 'tools/list') return ok(id, { tools: TOOLS });
    if (method !== 'tools/call') return fail(id, -32601, 'Method not found: ' + method);

    const a = params.arguments || {};
    if (params.name === 'one_focus_backlog') return ok(id, text(describe(deps.view())));
    if (params.name === 'one_focus_add_task') {
      const title = String(a.title || '').trim().slice(0, 300);
      if (!title) return ok(id, text('A title is needed.', true));
      if (a.status && !STATUS.includes(a.status)) return ok(id, text('Unknown status: ' + a.status, true));
      const t = await deps.add({ title, status: a.status || (a.request ? 'needs_you' : 'queued'), request: a.request, link: a.link, top: !!a.top, group: a.group, due: a.due, details: a.details, prompt: a.prompt, when: a.run_when });
      const v = deps.view();
      const row = [...v.active, ...v.queued, ...v.evergreen].find((r) => r.task.id === t.id);
      const where = !row ? 'added' : row.lane === 'active' ? (row.turn === 'you' ? 'active, waiting on the user' : 'active, running') : row.lane;
      const full = (a.status === 'running' || a.status === 'needs_you' || a.request) && row && row.lane !== 'active';
      return ok(id, text(`Added "${t.title}" (id ${t.id}): ${where}.${full ? ' Every active slot is busy, so it is queued.' : ''}`));
    }
    if (params.name === 'one_focus_update_task') {
      const v = deps.view();
      const t = findTask(v.open, a.task);
      if (!t) return ok(id, text(`No open task matches "${a.task}". Use one_focus_backlog to see the ids.`, true));
      if (a.status && !STATUS.includes(a.status)) return ok(id, text('Unknown status: ' + a.status, true));
      await deps.update(t, { status: a.status, request: a.request, link: a.link, title: a.title, group: a.group, due: a.due, details: a.details, prompt: a.prompt, when: a.run_when });
      if (a.status === 'done') return ok(id, text(`Finished "${t.title}".`));
      const after = deps.view();
      const row = [...after.active, ...after.queued, ...after.evergreen].find((r) => r.task.id === t.id);
      const state = !row ? 'updated' : row.lane === 'active' ? (row.turn === 'you' ? `needs the user${row.ask ? ': ' + row.ask : ''}` : 'running') : row.lane;
      const refused = (a.status === 'running' || a.status === 'needs_you' || a.request) && row && row.lane !== 'active';
      return ok(id, text(`"${(a.title || t.title).trim()}" is now ${state}.${refused ? ' Every active slot is busy, so it stays ' + row.lane + '.' : ''}`));
    }
    return fail(id, -32602, 'Unknown tool: ' + params.name);
  } catch (e) {
    return ok(id, text('One Focus could not do that: ' + e.message, true));
  }
}

module.exports = { handle, findTask, describe, TOOLS, INSTRUCTIONS, PROTOCOL };
