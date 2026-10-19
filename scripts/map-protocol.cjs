// Extract the client contract from inert Acer JavaScript; never evaluate it.
// Run from the project root after inspect-asar.cjs.
const fs = require('node:fs');
const crypto = require('node:crypto');
const parser = require('../.tools/rea/node_modules/@babel/parser');
const file = 'analysis/extracted/selected/main.js';
const source = fs.readFileSync(file, 'utf8');
const ast = parser.parse(source, { sourceType: 'unambiguous' });
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, fn)); return; }
  if (node.type) fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (!['loc', 'extra', 'comments', 'tokens'].includes(key)) walk(value, fn);
  }
}
const adapters = [];
walk(ast, node => {
  if (node.type !== 'ClassDeclaration' ||
      !['PSSdkAdapter', 'SysMonitorAdaptor'].includes(node.id?.name)) return;
  const methods = [];
  for (const method of node.body.body) {
    if (method.type !== 'ClassMethod') continue;
    const calls = [];
    walk(method.body, n => {
      if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' ||
          n.callee.object.type !== 'ThisExpression' ||
          n.callee.property.name !== 'sendRequest') return;
      calls.push({
        start: n.start, end: n.end,
        packetExpression: source.slice(n.arguments[0].start, n.arguments[0].end),
        payloadExpression: source.slice(n.arguments[1].start, n.arguments[1].end),
      });
    });
    methods.push({ name: method.key.name, start: method.start, end: method.end, calls });
  }
  adapters.push({ name: node.id.name, start: node.start, end: node.end, methods });
});
if (adapters.length !== 2) throw new Error('Expected both Acer service adapters');
const packetIds = {};
// Recognize the TypeScript numeric enum pattern e[e.NAME=number]="NAME".
walk(ast, n => {
  if (n.type !== 'AssignmentExpression' || n.operator !== '=' ||
      n.left.type !== 'MemberExpression' || !n.left.computed ||
      n.left.property.type !== 'AssignmentExpression' ||
      n.right.type !== 'StringLiteral') return;
  const inner = n.left.property;
  if (inner.left.type !== 'MemberExpression' || inner.left.computed ||
      inner.right.type !== 'NumericLiteral' ||
      inner.left.property.name !== n.right.value) return;
  const belongs = ['INITIALIZATION', 'GET_MONITOR_DATA', 'GET_UPDATED_DATA',
    'GET_CONNECTED_DEVICE', 'GET_LIGHTING_EFFECT_CAPABILITY', 'SET_DEVICE_DATA'];
  if (belongs.includes(n.right.value)) packetIds[n.right.value] = {
    value: inner.right.value, start: n.start, end: n.end,
  };
});
if (Object.keys(packetIds).length !== 6) throw new Error('Incomplete packet ID inventory');
const result = {
  source: file, sha256: crypto.createHash('sha256').update(source).digest('hex'),
  offsetUnit: 'UTF-16 code units; zero-based; end exclusive',
  evidenceType: 'static client syntax, not captured service traffic',
  limitations: ['Expressions retain bundle-local identifiers; they are not evaluated.',
    'Response examples, live capabilities and WMI argument layouts remain unknown.',
    'Presence of a client method does not establish firmware support.'],
  packetIds, adapters,
};
fs.writeFileSync('analysis/protocol-map.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ adapters: adapters.map(a => ({ name: a.name,
  methods: a.methods.length, requestCallSites: a.methods.reduce((n, m) => n + m.calls.length, 0),
})), packetIds: Object.fromEntries(Object.entries(packetIds).map(([k, v]) => [k, v.value])) }));
