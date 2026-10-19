// Usage: node legacy/scripts/summarize-ui-session.cjs <linux-ui-evidence-directory>
const fs = require('node:fs');
const path = require('node:path');
const { summarizeUiSessionFile } = require('../lib/ui-session.cjs');

async function main() {
  if (process.argv.length !== 3) throw new Error('Expected one UI evidence directory');
  const directory = path.resolve(process.argv[2]);
  let exitCode = null;
  try { exitCode = fs.readFileSync(path.join(directory, 'exit-code.txt'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(JSON.stringify(await summarizeUiSessionFile(path.join(directory, 'launch.log'), exitCode), null, 2));
}
main().catch(error => {
  // Avoid echoing filenames or file contents from unexpected input into reports.
  console.error(`UI summary failed (${error.code || 'invalid-input'}). Check the evidence directory and exit-code.txt.`);
  process.exitCode = 1;
});
