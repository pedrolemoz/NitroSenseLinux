// Static syntax inventory. No require/import from the supplied application is run.
const fs = require('node:fs');
const crypto = require('node:crypto');
const parser = require('../../.tools/rea/node_modules/@babel/parser');
const source = fs.readFileSync('analysis/extracted/selected/main.js', 'utf8');
const ast = parser.parse(source, { sourceType: 'unambiguous' });
const classes = [];
const nativeCalls = [];
const imports = [];
function visit(node, action) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => visit(n, action)); return; }
  if (node.type) action(node);
  for (const [key, value] of Object.entries(node)) {
    if (!['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) visit(value, action);
  }
}
function numericModuleOne(node, loader) {
  return node?.type === 'CallExpression' && node.callee.type === 'Identifier' &&
    node.callee.name === loader && node.arguments[0]?.type === 'NumericLiteral' &&
    node.arguments[0].value === 1;
}
visit(ast, node => {
  if (node.type === 'CallExpression' && node.callee.name === 'require' &&
      node.arguments[0]?.type === 'StringLiteral') imports.push(node.arguments[0].value);
  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') classes.push({
    name: node.id?.name,
    start: node.start,
    methods: node.body.body.filter(n => n.type === 'ClassMethod').map(n => ({
      name: n.key.name ?? n.key.value, kind: n.kind, start: n.start, end: n.end,
    })),
  });
  // This particular bundle has module 1 = require("xsense_native").
  // Treat aliases as candidates: this inventory does not prove lexical identity
  // under shadowing or prove that any call executes at runtime.
  if (node.type !== 'FunctionExpression' || node.params.length !== 3 ||
      node.params[2].type !== 'Identifier') return;
  const loader = node.params[2].name;
  const aliases = new Set();
  visit(node.body, n => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' &&
        numericModuleOne(n.init, loader)) aliases.add(n.id.name);
  });
  visit(node.body, n => {
    if (n.type !== 'MemberExpression' || n.computed || n.property.type !== 'Identifier') return;
    if (numericModuleOne(n.object, loader) ||
        (n.object.type === 'Identifier' && aliases.has(n.object.name))) {
      nativeCalls.push({ method: n.property.name, start: n.start, end: n.end });
    }
  });
});
const result = {
  source: 'main.js', sha256: crypto.createHash('sha256').update(source).digest('hex'),
  offsetUnit: 'JavaScript UTF-16 code units, zero-based, end exclusive',
  limitations: ['Static syntax candidates only; alias shadowing is not resolved.',
    'Module 1 identity was inspected in the supplied webpack bundle.',
    'No renderer or native binary behavior is established by this inventory.'],
  imports: [...new Set(imports)].sort(), classes,
  nativeMemberCandidates: [...new Map(nativeCalls.map(c => [c.start, c])).values()],
};
fs.writeFileSync('analysis/boundary-map.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ classes: classes.length,
  nativeMethods: [...new Set(nativeCalls.map(c => c.method))].sort(),
  sdk: classes.filter(c => /PSSdk|Scenario|Admin/.test(c.name)).map(c => ({
    name: c.name, methods: c.methods.map(m => m.name),
  })),
}, null, 2));
