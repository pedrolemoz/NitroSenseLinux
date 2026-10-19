// Inventory the shipped webpack factory table without evaluating any factory.
const fs = require('node:fs');
const crypto = require('node:crypto');
const parser = require('../../.tools/rea/node_modules/@babel/parser');
const source = fs.readFileSync('analysis/extracted/selected/main.js', 'utf8');
const ast = parser.parse(source, { sourceType: 'unambiguous' });
function walk(node, action) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, action)); return; }
  if (node.type) action(node);
  for (const [key, value] of Object.entries(node)) {
    if (!['loc', 'extra', 'comments', 'tokens'].includes(key)) walk(value, action);
  }
}
const tables = [];
walk(ast, n => {
  if (n.type === 'CallExpression' && n.arguments[0]?.type === 'ArrayExpression' &&
      n.arguments[0].elements.length > 30 &&
      n.arguments[0].elements.every(e => e?.type === 'FunctionExpression')) {
    tables.push(n.arguments[0]);
  }
});
if (tables.length !== 1) throw new Error('Expected one unambiguous webpack table');
const modules = tables[0].elements.map((factory, id) => {
  const loader = factory.params[2]?.name;
  const imports = [], requires = [];
  walk(factory.body, n => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier') return;
    const arg = n.arguments[0];
    if (loader && n.callee.name === loader && arg?.type === 'NumericLiteral') {
      imports.push({ moduleId: arg.value, start: n.start });
    }
    if (n.callee.name === 'require' && arg?.type === 'StringLiteral') {
      requires.push({ specifier: arg.value, start: n.start });
    }
  });
  return { id, start: factory.start, end: factory.end, imports, requires };
});
const entries = [];
walk(ast, n => {
  if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' &&
      n.left.object.name === '__webpack_require__' && n.left.property.name === 's' &&
      n.right.type === 'NumericLiteral') entries.push(n.right.value);
});
if (entries.length !== 1) throw new Error('Expected one bootstrap entry');
const paths = new Map([[entries[0], [entries[0]]]]);
const queue = [entries[0]];
for (let i = 0; i < queue.length; i++) {
  const id = queue[i];
  for (const imp of modules[id]?.imports || []) {
    if (!modules[imp.moduleId]) throw new Error('Module reference outside table');
    if (!paths.has(imp.moduleId)) {
      paths.set(imp.moduleId, [...paths.get(id), imp.moduleId]);
      queue.push(imp.moduleId);
    }
  }
}
const externalDependencies = modules.flatMap(m => m.requires.map(r => ({ ...r,
  factoryId: m.id, candidateImportPath: paths.get(m.id) || null,
})));
const result = {
  sha256: crypto.createHash('sha256').update(source).digest('hex'),
  offsetUnit: 'UTF-16 code units; zero-based', entryFactory: entries[0],
  limitations: ['All literal calls to a factory loader are included, even inside deferred methods.',
    'Paths are syntax candidates, not proof of startup execution or mandatory dependencies.',
    'Lexical shadowing and dynamic loader calls are not resolved.'],
  modules, externalDependencies,
};
fs.writeFileSync('analysis/startup-map.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ factories: modules.length, entry: entries[0],
  platformDependencies: externalDependencies.filter(d => /nodert|xsense|win-audio|powershell/.test(d.specifier)),
}, null, 2));
